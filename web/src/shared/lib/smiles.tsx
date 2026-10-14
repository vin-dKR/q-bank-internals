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
const MAX_STRUCTURE_WIDTH = 220;
const MAX_STRUCTURE_HEIGHT = 120;
const drawer = new SmilesDrawer.SmiDrawer({ width: MAX_STRUCTURE_WIDTH, height: MAX_STRUCTURE_HEIGHT, padding: 12 });

/**
 * Verify is a print-like, light surface. Use smiles-drawer's monochrome theme rather than the
 * browser/OS colour-scheme: an OS-level dark preference previously selected white bonds on this
 * white canvas. Monochrome diagrams also match the source-paper convention and keep every atom
 * label and bond equally legible.
 */
const VERIFY_STRUCTURE_THEME = 'oldschool';

/** The drawer measures an inline SVG before it has intrinsic bounds, which can produce 0px styles. */
export function sizeSmilesSvg(svg: SVGSVGElement): void {
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.[2];
  const height = viewBox?.[3];
  if (viewBox?.length !== 4 || width === undefined || height === undefined ||
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The molecular drawing has no usable geometry.');
  }
  const scale = Math.min(MAX_STRUCTURE_WIDTH / width, MAX_STRUCTURE_HEIGHT / height);
  const displayedWidth = Math.max(1, Math.round(width * scale));
  const displayedHeight = Math.max(1, Math.round(height * scale));
  svg.setAttribute('width', String(displayedWidth));
  svg.setAttribute('height', String(displayedHeight));
  svg.style.width = `${String(displayedWidth)}px`;
  svg.style.height = 'auto';
}

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
      sizeSmilesSvg(svg);
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
        width={MAX_STRUCTURE_WIDTH}
        height={MAX_STRUCTURE_HEIGHT}
        role="img"
        aria-label={`Chemical structure ${normalizedSmiles}`}
        className={failed ? 'hidden' : 'inline-block max-w-full align-middle'}
      />
      {failed ? <span className="font-mono text-xs text-ink-3">{normalizedSmiles}</span> : null}
    </span>
  );
}
