import { type JSX } from 'react';
import {
  IconButton,
  IconRedo,
  IconUndo,
  IconZoomIn,
  IconZoomOut,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarHelp,
  ToolbarSpacer,
} from '../../../shared/ui/index.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';

type PdfToolbarProps = {
  controller: SplitPointsController;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

/** The cutter view/edit strip: zoom, undo/redo/clear, a live cut counter, and a help popover. */
export function PdfToolbar({
  controller,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: PdfToolbarProps): JSX.Element {
  return (
    <Toolbar ariaLabel="View and edit">
      <ToolbarGroup>
        <IconButton icon={<IconZoomOut />} label="Zoom out" onClick={onZoomOut} />
        <button type="button" className="btn btn--ghost btn--xs" title="Reset zoom" onClick={onZoomReset}>
          {zoomPercent}%
        </button>
        <IconButton icon={<IconZoomIn />} label="Zoom in" onClick={onZoomIn} />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <IconButton
          icon={<IconUndo />}
          label="Undo (⌘Z)"
          disabled={!controller.canUndo}
          onClick={controller.undo}
        />
        <IconButton
          icon={<IconRedo />}
          label="Redo (⌘⇧Z)"
          disabled={!controller.canRedo}
          onClick={controller.redo}
        />
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          title="Remove every cut"
          disabled={controller.totalSplits === 0}
          onClick={controller.clearAll}
        >
          Clear all
        </button>
      </ToolbarGroup>

      <ToolbarSpacer />

      <ToolbarGroup>
        <span className="tbar__count">{controller.totalSplits} cuts</span>
        <ToolbarHelp>
          <b>Left-click</b> a page to cut · <b>Right-click</b> to drop a guide · <b>Drag</b> a line to
          move it.
        </ToolbarHelp>
      </ToolbarGroup>
    </Toolbar>
  );
}
