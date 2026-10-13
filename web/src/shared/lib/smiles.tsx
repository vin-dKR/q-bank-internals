import { type JSX, useEffect, useRef, useState } from 'react';
import SmilesDrawer from 'smiles-drawer';

/**
 * Render a drawn chemical structure from a SMILES string as an inline 2-D diagram (SVG). Used for the
 * structures a paper draws — benzene rings, skeletal/organic structures — that `\ce` cannot depict.
 * The extraction AI emits these as `<smiles>…</smiles>` in the text (see `latex.tsx` / the chemistry
 * prompt); a malformed SMILES falls back to showing its raw source rather than an empty box.
 *
 * smiles-drawer parses + lays out per call and draws into a real SVG element, so this is a client-only,
 * effect-driven component (there is no server render of the structure).
 */
const drawer = new SmilesDrawer.SmiDrawer({ width: 220, height: 160, padding: 12 });

/**
 * Verify is a print-like, light surface. Use smiles-drawer's monochrome theme rather than the
 * browser/OS colour-scheme: an OS-level dark preference previously selected white bonds on this
 * white canvas. Monochrome diagrams also match the source-paper convention and keep every atom
 * label and bond equally legible.
 */
const VERIFY_STRUCTURE_THEME = 'oldschool';

export function SmilesStructure({ smiles }: { smiles: string }): JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);
  const normalizedSmiles = smiles.trim();

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.replaceChildren(); // clear any previous draw before redrawing this SMILES
    setFailed(false);
    if (!normalizedSmiles) {
      setFailed(true);
      return;
    }
    try {
      drawer.draw(normalizedSmiles, svg, VERIFY_STRUCTURE_THEME, undefined, () => {
        throw new Error('The molecular structure could not be drawn.');
      });
      setFailed(svg.childNodes.length === 0);
    } catch {
      setFailed(true);
    }
  }, [normalizedSmiles]);

  return (
    <span className="inline-block max-w-full align-middle">
      {/* Keep the drawing target mounted: editing invalid SMILES must be able to recover. */}
      <svg
        ref={ref}
        role="img"
        aria-label={`Chemical structure ${normalizedSmiles}`}
        className={failed ? 'hidden' : 'inline-block max-w-full align-middle [height:auto] [max-height:6.5rem] [width:auto]'}
      />
      {failed ? <span className="font-mono text-xs text-ink-3">{normalizedSmiles}</span> : null}
    </span>
  );
}
