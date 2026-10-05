import { repairCorruptedEscapes } from './latex-rules.js';
import { stripModelControlArtifacts } from '../../shared/text/model-control-sanitizer.js';

/**
 * Make a model's text safe to store on a live question. Three passes, in an order that matters:
 *
 * 1. Repair corrupted LaTeX escapes FIRST — a form feed before "rac" is a broken `\frac`, and stripping it as a
 *    control character would lose the command instead of restoring it.
 * 2. Remove complete terminal escape sequences and invisible formatting markers.
 * 3. Drop any remaining control character (the model's own emphasis markers, stray vertical tabs).
 */
export function cleanAiText(text: string): string {
  return stripModelControlArtifacts(repairCorruptedEscapes(text));
}

/** {@link cleanAiText} for a nullable field, keeping null as "the model decided nothing". */
export function cleanAiField(text: string | null): string | null {
  return text === null ? null : cleanAiText(text);
}
