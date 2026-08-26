import { RefinedLatexSchema } from '@ingest/contracts';
import { request } from './http-client.js';

/**
 * One-click AI "Fix LaTeX": returns `text` with its math wrapped in `\(...\)`, cleaned in place. The
 * single pure-text refine path (§6.4), shared by Verify's per-field fix and the published-bank
 * Questions-browse "AI fix" — both clean a field's text the same way, so there is one implementation.
 */
export async function refineLatex(text: string): Promise<string> {
  const result = await request('/questions/refine', {
    method: 'POST',
    body: { text },
    schema: RefinedLatexSchema,
  });
  return result.text;
}
