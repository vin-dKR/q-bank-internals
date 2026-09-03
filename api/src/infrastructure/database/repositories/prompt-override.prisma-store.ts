import type { PrismaClient } from '@prisma/client';
import type { PromptKey } from '@ingest/contracts';
import { PROMPT_KEYS } from '@ingest/contracts';
import type { PromptOverrideStore } from '../../../modules/prompts/index.js';

const KNOWN = new Set<string>(PROMPT_KEYS);

/** Prisma/Mongo {@link PromptOverrideStore}. Rows for retired keys are ignored, not surfaced. */
export class PrismaPromptOverrideStore implements PromptOverrideStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Partial<Record<PromptKey, string>>> {
    const rows = await this.prisma.promptOverride.findMany();
    const out: Partial<Record<PromptKey, string>> = {};
    for (const row of rows) {
      if (KNOWN.has(row.key)) out[row.key as PromptKey] = row.value;
    }
    return out;
  }

  async upsert(key: PromptKey, value: string): Promise<void> {
    await this.prisma.promptOverride.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async remove(key: PromptKey): Promise<void> {
    // deleteMany so removing a key with no stored override is a no-op (delete would throw).
    await this.prisma.promptOverride.deleteMany({ where: { key } });
  }
}
