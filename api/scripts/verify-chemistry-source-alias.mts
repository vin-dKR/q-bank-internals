/** Offline native-label ownership proof for an explicitly declared source-document alias. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { QuestionSchema } from '@ingest/contracts';
import { PdfToImgRasterizer } from '../src/infrastructure/pdf/pdf-to-img.rasterizer.js';
import { normalizePrintedQuestionLabel } from '../src/modules/extraction/question-identity.js';
import { ChemistryGraphGoldSchema } from './chemistry-graph-benchmark.mjs';

const QuestionsSchema = z.object({ data: z.object({ questions: z.array(QuestionSchema) }) });

async function main(): Promise<void> {
  const values = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !['--gold', '--questions', '--source-pdf', '--source-document', '--target-document', '--output'].includes(key) || !value || value.startsWith('--')) throw new Error('Supply explicit local gold/question/PDF paths, source and target document IDs, and an output path.');
    values.set(key, value);
  }
  const goldPath = values.get('--gold');
  const questionPath = values.get('--questions');
  const sourcePath = values.get('--source-pdf');
  const sourceId = values.get('--source-document');
  const targetId = values.get('--target-document');
  const output = values.get('--output');
  if (!goldPath || !questionPath || !sourcePath || !sourceId || !targetId || !output) throw new Error('All source-alias arguments are required.');
  const goldBytes = await readFile(path.resolve(goldPath));
  const questionBytes = await readFile(path.resolve(questionPath));
  const pdf = await readFile(path.resolve(sourcePath));
  const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  const gold = ChemistryGraphGoldSchema.parse(JSON.parse(goldBytes.toString('utf8')));
  const questions = QuestionsSchema.parse(JSON.parse(questionBytes.toString('utf8'))).data.questions;
  if (questions.some((question) => question.documentId !== sourceId)) throw new Error('The local snapshot contains records from another source document.');
  if (gold.sources[targetId]?.sha256 !== sha256(pdf)) throw new Error('The reference PDF bytes do not match the frozen graph gold.');
  const fields = gold.fields.filter((field) => field.documentId === targetId);
  if (!fields.length) throw new Error('The target document has no frozen graph fields.');
  const rasterizer = new PdfToImgRasterizer(3);
  const pages = new Map<number, Awaited<ReturnType<PdfToImgRasterizer['rasterizePage']>>>();
  for (const pageNumber of [...new Set(fields.map((field) => field.page))]) pages.set(pageNumber, await rasterizer.rasterizePage(pdf, pageNumber));
  const ownership = fields.map((field) => {
    const label = normalizePrintedQuestionLabel(field.printedLabel);
    const rows = questions.filter((question) => question.sourceRegion.page === field.page && normalizePrintedQuestionLabel(question.printedLabel) === label);
    const anchors = pages.get(field.page)?.layout?.questions.filter((anchor) => normalizePrintedQuestionLabel(anchor.printedLabel) === label) ?? [];
    const row = rows.length === 1 ? rows[0] : undefined;
    const anchor = anchors.length === 1 ? anchors[0] : undefined;
    if (!row || !anchor) throw new Error(`Source alias is ambiguous or missing at page${String(field.page)} ${field.printedLabel}.`);
    const [left, top, right, bottom] = row.sourceRegion.bbox;
    const [anchorLeft, anchorTop, anchorRight, anchorBottom] = anchor.anchorBox;
    const centerX = (anchorLeft + anchorRight) / 2;
    const centerY = (anchorTop + anchorBottom) / 2;
    const anchorInsideStoredRegion = centerX >= left - .005 && centerX <= right + .005 && centerY >= top - .005 && centerY <= bottom + .005;
    if (!anchorInsideStoredRegion) throw new Error(`The stored region does not own the native printed label at page${String(field.page)} ${field.printedLabel}.`);
    return {
      goldFieldId: field.id, sourceQuestionId: row.id, sourceDocumentId: sourceId, goldDocumentId: targetId,
      sourcePage: field.page, printedLabel: field.printedLabel, normalizedLabel: label,
      storedSectionName: row.sectionName, nativeSourceSection: anchor.sourceSection,
      storedSourceRegion: row.sourceRegion.bbox, nativeAnchorBox: anchor.anchorBox,
      anchorInsideStoredRegion,
    };
  });
  const provenance = {
    mode: 'offline-source-identity-alias-verification', generatedAt: new Date().toISOString(),
    sourceDocumentId: sourceId, targetGoldDocumentId: targetId, identityAliasOnly: true,
    sourceAssignment: 'Source page, complete printed label, and native label position within the stored source region. Stored topic labels are retained as metadata; they do not replace native source-section ownership.',
    goldSha256: sha256(goldBytes), sourceSnapshotSha256: sha256(questionBytes), referencePdfSha256: sha256(pdf),
    livePdfByteIdentityVerified: false,
    referenceMatchEvidence: 'The parent task verified that current source screenshots pages1/16/18 match this25-page reference PDF. This script independently verifies every benchmarked stored label/region against the reference PDF native anchors.',
    snapshotRows: questions.length, validatedFields: ownership.length, validatedMolecules: fields.reduce((sum, field) => sum + field.molecules.length, 0),
    newModelCalls: 0, networkCalls: 0, databaseWrites: false, ownership,
  };
  await writeFile(path.resolve(output), JSON.stringify(provenance, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output: path.resolve(output), alias: `${sourceId}:${targetId}`, rows: questions.length, validatedFields: ownership.length, validatedMolecules: provenance.validatedMolecules }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'Source identity verification failed.') + '\n');
  process.exitCode = 1;
});
