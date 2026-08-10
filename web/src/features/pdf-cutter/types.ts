/** A cut line (`horizontal`) or a visual guide (`vertical`); `position` is a 0–1 fraction of the page. */
export type SplitOrientation = 'horizontal' | 'vertical';

export type SplitPoint = {
  id: string;
  page: number;
  position: number;
  orientation: SplitOrientation;
};
