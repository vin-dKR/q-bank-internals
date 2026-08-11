/**
 * The active cutting tool. Only one mode is live at a time; it decides what a plain click on the
 * page overlay draws and which transform "Apply" runs. `none` is the passive default — it draws no
 * overlay and has nothing to apply, so the rendered text stays selectable and copyable.
 */
export type CutMode = 'none' | 'horizontal' | 'vertical' | 'reflow';

/**
 * The order cells become pages when a page is cut on both axes. `column` reads the left column
 * top→bottom then the next (two-column question papers); `row` reads left→right across each band.
 */
export type ReadingOrder = 'column' | 'row';

/** Modes that cut a page into a grid of real pages via {@link applyGridSplit}. */
export const GRID_MODES: readonly CutMode[] = ['horizontal', 'vertical'];

/** The line orientation a plain click draws in a given mode. */
export function orientationForMode(mode: CutMode): 'horizontal' | 'vertical' {
  return mode === 'vertical' ? 'vertical' : 'horizontal';
}
