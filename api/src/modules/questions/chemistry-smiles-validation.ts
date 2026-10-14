import { chemistryRenderedMolecules, type Passage, type Question } from '@ingest/contracts';
import type { SmilesValidator } from './smiles-validator.js';

/** Graph parsing protects review and publication; it never substitutes for source agreement. */
export async function chemistrySmilesIssues(
  question: Question,
  validator: SmilesValidator | null,
  passage?: Pick<Passage, 'text' | 'passageImage'> | null,
): Promise<string[]> {
  if (question.chemistry?.representation !== 'transcription') return [];
  const molecules = chemistryRenderedMolecules(question, passage);
  if (!molecules.length) return [];
  if (!validator) return ['The molecular graph validator is unavailable. Chemistry cannot be reviewed until validation is configured.'];
  const issues: string[] = [];
  for (const molecule of molecules) {
    const validation = await validator.validate(molecule.smiles);
    if (!validation.valid) issues.push(`${molecule.field}: ${validation.message}`);
  }
  return [...new Set(issues)];
}
