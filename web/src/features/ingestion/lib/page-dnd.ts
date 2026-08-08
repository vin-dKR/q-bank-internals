import type { DragEvent } from 'react';

/** Custom drag payload: the 1-based working-document pages being dragged from the editor to a leaf. */
export const PAGE_DND_MIME = 'application/x-ingest-pages';

/** Stamp the dragged page numbers onto a drag event (from a page handle in the PDF editor). */
export function setDraggedPages(event: DragEvent, pages: number[]): void {
  event.dataTransfer.setData(PAGE_DND_MIME, JSON.stringify(pages));
  event.dataTransfer.effectAllowed = 'copy';
}

/** Read the dragged page numbers on a drop, or null if the drag carries no page payload. */
export function readDraggedPages(event: DragEvent): number[] | null {
  const raw = event.dataTransfer.getData(PAGE_DND_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const nums = parsed.filter((n): n is number => typeof n === 'number');
    return nums.length === parsed.length && nums.length > 0 ? nums : null;
  } catch {
    return null;
  }
}

/** True when a drag carries our page payload — used to light up drop targets only for real page drags. */
export function isPageDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(PAGE_DND_MIME);
}
