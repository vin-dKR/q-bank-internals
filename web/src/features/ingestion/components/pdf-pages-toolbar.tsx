import { type JSX, useState } from 'react';
import {
  IconButton,
  IconFileText,
  IconGrid,
  IconList,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarHelp,
  ToolbarSpacer,
} from '../../../shared/ui/index.js';
import { ENTER_KEY, MOD_KEY, SHIFT_KEY, combo } from '../../../shared/lib/platform.js';
import type { PreviewView } from './pdf-previewer.js';

type PdfPagesToolbarProps = {
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** Live count of pending cut lines (undo with ⌘Z, clear with "Reset lines" in the mode bar). */
  cutCount: number;
  cutNoun: string;
  numPages: number;
  onGoToPage: (pageNumber: number) => void;
  /** Page selection (for dragging a batch onto a leaf, or bulk delete). */
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
};

/**
 * The single page bar for the Cut & upload workbench: view toggle, zoom, cut-line edit, a go-to-page
 * jump, and the selection actions — everything about *navigating and picking pages*, in one grouped
 * strip. Cutting/versioning lives in the mode bar above; this bar owns pages. A help popover lists
 * every keyboard + mouse shortcut in plain words so an operator never has to guess.
 */
export function PdfPagesToolbar({
  view,
  onViewChange,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  cutCount,
  cutNoun,
  numPages,
  onGoToPage,
  selectedCount,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
}: PdfPagesToolbarProps): JSX.Element {
  return (
    <Toolbar ariaLabel="Pages and view">
      <ToolbarGroup>
        <div className="segmented" role="group" aria-label="Page view">
          <button
            type="button"
            className={`segmented__item ${view === 'list' ? 'is-active' : ''}`}
            aria-pressed={view === 'list'}
            title="List view — the tall cut editor (L)"
            onClick={() => { onViewChange('list'); }}
          >
            <IconList /> List
          </button>
          <button
            type="button"
            className={`segmented__item ${view === 'grid' ? 'is-active' : ''}`}
            aria-pressed={view === 'grid'}
            title="Grid view — compact thumbnails to sweep & drag (G)"
            onClick={() => { onViewChange('grid'); }}
          >
            <IconGrid /> Grid
          </button>
        </div>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <IconButton icon={<IconZoomOut />} label="Zoom out" disabled={view === 'grid'} onClick={onZoomOut} />
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          title="Reset zoom"
          disabled={view === 'grid'}
          onClick={onZoomReset}
        >
          {zoomPercent}%
        </button>
        <IconButton icon={<IconZoomIn />} label="Zoom in" disabled={view === 'grid'} onClick={onZoomIn} />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <span className="tbar__count" title="Cut lines pending on the current page (⌘Z to undo)">
          {cutCount} {cutNoun}
        </span>
        <GoToPage numPages={numPages} onGoToPage={onGoToPage} />
      </ToolbarGroup>

      <ToolbarSpacer />

      <ToolbarGroup>
        <span className="tbar__count">
          {selectedCount > 0 ? `${String(selectedCount)} selected` : 'Shift-click a range'}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          title="Select every page (⌘A)"
          disabled={numPages === 0 || selectedCount === numPages}
          onClick={onSelectAll}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          title="Clear the selection (Esc)"
          disabled={selectedCount === 0}
          onClick={onClearSelection}
        >
          Deselect
        </button>
        <button
          type="button"
          className="btn btn--danger btn--xs"
          title="Delete every selected page — Del (Revert restores them)"
          disabled={selectedCount === 0 || selectedCount >= numPages}
          onClick={onDeleteSelected}
        >
          <IconTrash /> Delete{selectedCount > 0 ? ` ${String(selectedCount)}` : ''}
        </button>
      </ToolbarGroup>

      <ToolbarHelp>
        <ShortcutList />
      </ToolbarHelp>
    </Toolbar>
  );
}

/** A small numeric jump-to-page field: type a page and press Enter to scroll it into view. */
function GoToPage({ numPages, onGoToPage }: { numPages: number; onGoToPage: (n: number) => void }): JSX.Element {
  const [value, setValue] = useState('');
  const submit = (): void => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= numPages) {
      onGoToPage(n);
      setValue('');
    }
  };
  return (
    <label className="tbar__page" title="Jump to a page">
      <IconFileText />
      <input
        type="number"
        min={1}
        max={numPages}
        value={value}
        placeholder="Page…"
        onChange={(event) => { setValue(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); submit(); }
        }}
      />
    </label>
  );
}

type Shortcut = { keys: string[]; what: string };
// Modifier labels adapt to the OS (⌘ on mac, Ctrl on Windows/Linux); the handlers accept both.
const SHORTCUTS: Shortcut[] = [
  { keys: ['H', 'V', 'R'], what: 'Horizontal · Vertical · Reflow mode' },
  { keys: ['L', 'G'], what: 'List · Grid view' },
  { keys: [MOD_KEY, ENTER_KEY], what: 'Apply the current cut' },
  { keys: [MOD_KEY, 'Z'], what: `Undo cut  ·  ${combo(MOD_KEY, SHIFT_KEY, 'Z')} to redo` },
  { keys: ['Click'], what: 'Select a page' },
  { keys: [SHIFT_KEY, 'Click'], what: 'Select a range of pages' },
  { keys: [MOD_KEY, 'A'], what: 'Select all pages' },
  { keys: ['Esc'], what: 'Clear the selection' },
  { keys: ['Del'], what: 'Delete the selected pages' },
  { keys: ['Drag'], what: 'Drop a page onto a leaf’s Q / A / S' },
];

/** The full shortcut cheat-sheet shown in the toolbar's help popover. */
function ShortcutList(): JSX.Element {
  return (
    <div className="shortcuts">
      <p className="shortcuts__title">Shortcuts</p>
      <ul className="shortcuts__list">
        {SHORTCUTS.map((row) => (
          <li key={row.what} className="shortcuts__row">
            <span className="shortcuts__keys">
              {row.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
            <span className="shortcuts__what">{row.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
