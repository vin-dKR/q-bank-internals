import type { SmilesValidator } from '../../modules/questions/index.js';
import { validateSmilesGraph } from './chemistry-audit.js';

/** Share the same sanitizing graph engine used by extraction rather than a weaker display parser. */
export class RdkitSmilesValidator implements SmilesValidator {
  async validate(smiles: string): Promise<{ valid: true } | { valid: false; message: string }> {
    const result = await validateSmilesGraph(smiles);
    return result.ok ? { valid: true } : { valid: false, message: result.diagnostic.message };
  }
}
