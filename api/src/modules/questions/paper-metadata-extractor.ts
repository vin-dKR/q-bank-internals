import type { PaperMetadata } from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';

/** The AI-read paper fields plus the token spend the model reported producing them. */
export type PaperMetadataExtraction = {
  paper: PaperMetadata;
  usage: AiTokenUsage;
};

/**
 * PORT (§3) for "read the paper details off a header page": given ONE rendered page image (the PYQ
 * paper's first/header page, rasterized in the browser before upload), return the whole-paper
 * metadata printed on it (exam name/year/session/shift/paper code …). The companion to
 * {@link QuestionReExtractor} — a stateless one-shot vision read, used by the cut-upload "AI-fill"
 * button. Implemented with an OpenAI vision model in `infrastructure/ai`, with a null-object when no
 * API key is configured. Returns {@link AiTokenUsage} so the service records spend like the rest.
 */
export interface PaperMetadataExtractor {
  extract(input: { png: Buffer }): Promise<PaperMetadataExtraction>;
}
