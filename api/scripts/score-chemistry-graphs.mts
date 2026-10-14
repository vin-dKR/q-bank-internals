/** Offline scoring of saved benchmark results; never creates a model or database client. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { aliasChemistryGraphResults, ChemistryGraphGoldSchema, parseSavedChemistryGraphResults, scoreChemistryGraphs } from './chemistry-graph-benchmark.mjs';

const SelectionSchema = z.object({ selectedPages: z.array(z.object({ documentId: z.string(), pageNumber: z.number().int() })) });

async function main(): Promise<void> {
  const values = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !['--gold', '--results', '--output', '--origin', '--manifest', '--document-alias'].includes(key) || !value || value.startsWith('--')) throw new Error('Supply named gold, results, output, origin, and optional manifest/document-alias arguments.');
    values.set(key, value);
  }
  const goldPath = values.get('--gold');
  const resultPath = values.get('--results');
  const output = values.get('--output');
  const origin = values.get('--origin');
  if (!goldPath || !resultPath || !output || !origin) throw new Error('Supply --gold, --results, --output, and --origin.');
  const rawGold = await readFile(path.resolve(goldPath));
  const gold = ChemistryGraphGoldSchema.parse(JSON.parse(rawGold.toString('utf8')));
  const originalResults = parseSavedChemistryGraphResults(JSON.parse(await readFile(path.resolve(resultPath), 'utf8')));
  const aliases = new Map<string, string>();
  for (const alias of values.get('--document-alias')?.split(';') ?? []) {
    const [source, target, extra] = alias.split(':');
    if (!source || !target || extra !== undefined || !/^[A-Za-z0-9_-]+$/u.test(source) || !gold.sources[target] || aliases.has(source)) throw new Error('A document alias must identify one existing source and one frozen-gold document.');
    aliases.set(source, target);
  }
  const results = aliasChemistryGraphResults(originalResults, aliases);
  const manifestPath = values.get('--manifest');
  const selection = manifestPath ? SelectionSchema.parse(JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'))).selectedPages : null;
  const selectedGold = selection ? { ...gold, fields: gold.fields.filter((field) => selection.some((page) => page.documentId === field.documentId && page.pageNumber === field.page)) } : gold;
  const score = await scoreChemistryGraphs(selectedGold, results, { origin, goldHash: createHash('sha256').update(rawGold).digest('hex') });
  await writeFile(path.resolve(output), JSON.stringify({ ...score, documentAliases: Object.fromEntries(aliases), identityAliasOnly: true }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output: path.resolve(output), origin, production: score.production, auditCandidates: score.auditCandidates, development: score.development, holdout: score.holdout }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'Offline graph scoring failed.') + '\n');
  process.exitCode = 1;
});
