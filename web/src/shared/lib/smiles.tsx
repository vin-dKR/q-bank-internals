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

/** Match the app's active theme so the structure's bonds/atoms stay legible on light and dark surfaces. */
function currentTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function SmilesStructure({ smiles }: { smiles: string }): JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.replaceChildren(); // clear any previous draw before redrawing this SMILES
    setFailed(false);
    try {
      drawer.draw(smiles, svg, currentTheme(), undefined, () => { setFailed(true); });
    } catch {
      setFailed(true);
    }
  }, [smiles]);

  if (failed) return <span className="font-mono text-xs text-ink-3">{smiles}</span>;
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={`Chemical structure ${smiles}`}
      className="inline-block max-w-full align-middle [height:auto] [max-height:6.5rem] [width:auto]"
    />
  );
}
