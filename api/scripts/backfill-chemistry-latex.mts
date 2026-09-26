/**
 * One-off backfill: repair the mhchem `\ce{…}` JSON-escape corruption (U+001C, dropped `\(` `\)`) in
 * already-extracted rows, using the SAME sanitizer the extraction path now applies. Idempotent — clean
 * rows pass through unchanged, and only changed rows are written.
 *
 *   npx tsx scripts/backfill-chemistry-latex.mts            # DRY RUN — report counts only
 *   npx tsx scripts/backfill-chemistry-latex.mts --apply    # write the repairs
 *   npx tsx scripts/backfill-chemistry-latex.mts --apply --document <id>   # limit to one document
 */
/// <reference types="node" />
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { sanitizeExtractedLatex } from '../src/infrastructure/ai/latex-sanitizer.js';

const APPLY = process.argv.includes('--apply');
const docFlag = process.argv.indexOf('--document');
const documentId = docFlag !== -1 ? process.argv[docFlag + 1] : undefined;

const prisma = new PrismaClient();

/** Sanitize the title + entry bodies inside a stored match table (leaves labels/keys/images intact). */
function fixMatch(match: unknown): { value: unknown; changed: boolean } {
  if (!match || typeof match !== 'object') return { value: match, changed: false };
  const before = JSON.stringify(match);
  const m = match as { columns?: unknown };
  if (Array.isArray(m.columns)) {
    for (const col of m.columns as { title?: unknown; entries?: unknown }[]) {
      if (typeof col.title === 'string') col.title = sanitizeExtractedLatex(col.title);
      if (Array.isArray(col.entries)) {
        for (const e of col.entries as { body?: unknown }[]) {
          if (typeof e.body === 'string') e.body = sanitizeExtractedLatex(e.body);
        }
      }
    }
  }
  return { value: match, changed: JSON.stringify(match) !== before };
}

async function main(): Promise<void> {
  const where = documentId ? { documentId } : {};
  const questions = await prisma.question.findMany({ where });
  let qChanged = 0;
  for (const q of questions) {
    // The DB field is `stem` (the contract maps it to `questionText` on the wire).
    const stem = sanitizeExtractedLatex(q.stem);
    const options = q.options.map((o) => ({ ...o, body: sanitizeExtractedLatex(o.body) }));
    const answer = sanitizeExtractedLatex(q.answer);
    const explanation = q.explanation == null ? null : sanitizeExtractedLatex(q.explanation);
    const match = fixMatch(q.match);

    const changed =
      stem !== q.stem ||
      answer !== q.answer ||
      explanation !== q.explanation ||
      options.some((o, i) => o.body !== q.options[i]?.body) ||
      match.changed;
    if (!changed) continue;
    qChanged += 1;
    if (APPLY) {
      await prisma.question.update({
        where: { id: q.id },
        data: { stem, options, answer, explanation, match: match.value as object },
      });
    }
  }

  const passages = await prisma.passage.findMany({ where });
  let pChanged = 0;
  for (const p of passages) {
    const text = sanitizeExtractedLatex(p.text);
    if (text === p.text) continue;
    pChanged += 1;
    if (APPLY) await prisma.passage.update({ where: { id: p.id }, data: { text } });
  }

  console.log(
    `${APPLY ? 'APPLIED' : 'DRY-RUN'}${documentId ? ` (document ${documentId})` : ''}: ` +
      `questions repaired ${qChanged}/${questions.length}, passages repaired ${pChanged}/${passages.length}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
