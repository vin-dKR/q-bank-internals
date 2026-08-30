import { EMPTY_PAPER_METADATA, PAPER_METADATA_FIELDS, type PaperMetadata } from '@ingest/contracts';

/**
 * Prisma's composite-type shape for {@link PaperMetadata}: every field is nullable (Mongo stores an
 * absent field as null), whereas the contract type keeps all fields as plain strings. These two
 * mappers are the one place that null ↔ '' bridge happens, shared by the Document and Question repos
 * so the conversion is written once (§6).
 */
export type PaperMetadataRow = { [K in keyof PaperMetadata]?: string | null };

/** Row → contract: a stored paper becomes a full 14-field object, absent fields defaulting to ''. */
export function toContractPaper(row: PaperMetadataRow | null | undefined): PaperMetadata | null {
  if (!row) return null;
  const paper: PaperMetadata = { ...EMPTY_PAPER_METADATA };
  for (const { key } of PAPER_METADATA_FIELDS) paper[key] = row[key] ?? '';
  return paper;
}

/** Contract → row: a paper is written field-for-field (null stays null → no composite is stored). */
export function toPrismaPaper(paper: PaperMetadata | null | undefined): PaperMetadataRow | null {
  if (!paper) return null;
  const row: PaperMetadataRow = {};
  for (const { key } of PAPER_METADATA_FIELDS) row[key] = paper[key];
  return row;
}
