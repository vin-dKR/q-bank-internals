import { type JSX } from 'react';
import type { SplitPointsController } from '../hooks/use-split-points.js';

type PdfToolbarProps = {
  controller: SplitPointsController;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

/** The cutter tool strip: zoom, undo/redo, clear, and a live cut counter + interaction legend. */
export function PdfToolbar({
  controller,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: PdfToolbarProps): JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button type="button" className="btn btn--ghost btn--icon" title="Zoom out" onClick={onZoomOut}>
          −
        </button>
        <button type="button" className="btn btn--ghost" title="Reset zoom" onClick={onZoomReset}>
          {zoomPercent}%
        </button>
        <button type="button" className="btn btn--ghost btn--icon" title="Zoom in" onClick={onZoomIn}>
          +
        </button>
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--ghost"
          title="Undo (⌘Z)"
          disabled={!controller.canUndo}
          onClick={controller.undo}
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          title="Redo (⌘⇧Z)"
          disabled={!controller.canRedo}
          onClick={controller.redo}
        >
          ↷ Redo
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          title="Remove every cut"
          disabled={controller.totalSplits === 0}
          onClick={controller.clearAll}
        >
          Clear all
        </button>
      </div>

      <div className="toolbar__group toolbar__group--end">
        <span className="chip chip--count">{controller.totalSplits} cuts</span>
        <span className="toolbar__legend muted">
          <b>Left-click</b> = cut · <b>Right-click</b> = guide · <b>Drag</b> a line to move
        </span>
      </div>
    </div>
  );
}
