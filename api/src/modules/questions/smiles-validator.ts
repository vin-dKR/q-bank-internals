/** Parses molecular text; source fidelity is evaluated separately by the extraction benchmark. */
export interface SmilesValidator {
  validate(smiles: string): Promise<{ valid: true } | { valid: false; message: string }>;
}
