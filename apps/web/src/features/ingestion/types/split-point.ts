export type SplitOrientation = 'horizontal' | 'vertical';

/** A cut line on a page, positioned as a 0–1 fraction of the page height (h) or width (v). */
export type SplitPoint = {
  id: string;
  position: number;
  orientation: SplitOrientation;
};

/** Split lines keyed by 1-based page number. */
export type SplitPointsByPage = Record<number, SplitPoint[]>;
