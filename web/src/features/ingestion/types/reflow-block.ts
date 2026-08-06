/** A cropped rectangle of one page, as 0–1 fractions from the top-left. Page is 1-based. */
export type CropRect = {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * One reflow block — a question and the fragments that belong with it (e.g. its options that spilled
 * onto the next page). Every crop in a block is stacked, in order, onto a single output page so the
 * question is complete for extraction.
 */
export type ReflowBlock = {
  id: string;
  crops: CropRect[];
};

/** A stable, distinct hue per block index, shared by the on-page boxes and the blocks panel. */
export function blockColor(index: number): string {
  return `hsl(${String((index * 47) % 360)} 85% 45%)`;
}
