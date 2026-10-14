/** A successful text read can still contain an unresolved molecular transcription. */
export function chemistryReadWarning(read: {
  chemistryIssues?: readonly string[] | undefined;
  molecularAudits?: readonly { status: string }[] | undefined;
}): string | null {
  const message = read.chemistryIssues?.find((issue) => issue.trim());
  if (message) return `${message} Compare the SMILES drawing with the source before accepting it.`;
  const unresolved = read.molecularAudits?.filter((audit) => audit.status === 'unresolved').length ?? 0;
  return unresolved > 0 ? `${String(unresolved)} molecular transcription(s) remain unresolved. Compare them with the source before accepting.` : null;
}
