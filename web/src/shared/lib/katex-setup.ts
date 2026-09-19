import katex from 'katex';
import 'katex/contrib/mhchem'; // side effect: registers `\ce` (mhchem) on THIS katex instance

/**
 * Render math through the SAME katex instance mhchem patches, so chemistry `\ce{...}` renders.
 *
 * We deliberately do NOT use `react-katex`: it declares `katex` as a direct dependency, so Vite's
 * dep pre-bundling inlines a SEPARATE copy of katex into the react-katex chunk — mhchem then patches
 * one katex instance while react-katex renders through another, and `\ce` comes out as an "undefined
 * control sequence" error. Calling `katex.renderToString` here binds rendering to the one instance we
 * imported and extended, in both dev and production.
 *
 * Throws on malformed input (throwOnError), so callers keep their raw-source fallback.
 */
export function renderMathToHtml(value: string, displayMode: boolean): string {
  return katex.renderToString(value, { displayMode, throwOnError: true });
}
