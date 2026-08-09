import { type JSX } from 'react';
import {
  IconButton,
  IconPlus,
  IconRedo,
  IconUndo,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarSpacer,
} from '../../../shared/ui/index.js';
import { ENTER_KEY, MOD_KEY, combo } from '../../../shared/lib/platform.js';
import type { CutMode, ReadingOrder } from '../types/cut-mode.js';

type ModeOption = {
  mode: CutMode;
  label: string;
  hint: string;
  disabled?: boolean;
};

const MODES: ModeOption[] = [
  { mode: 'horizontal', label: 'Horizontal', hint: 'Cut a page into stacked bands' },
  { mode: 'vertical', label: 'Vertical', hint: 'Cut a page into side-by-side columns' },
  { mode: 'reflow', label: 'Reflow', hint: 'Box a question and its spilled options; stack them onto one page' },
];

type PdfModeSelectorProps = {
  mode: CutMode;
  onModeChange: (mode: CutMode) => void;
  lineCount: number;
  onApply: () => void;
  onResetLines: () => void;
  onNewBlock: () => void;
  order: ReadingOrder;
  onOrderChange: (order: ReadingOrder) => void;
  applying: boolean;
  steps: string[];
  stepIndex: number;
  canRevert: boolean;
  canRedo: boolean;
  onRevert: () => void;
  onRedo: () => void;
};

/**
 * The cut-mode strip: pick a tool, apply the current lines (which refreshes the working PDF into a
 * new version), and walk the pipeline of applied versions with Revert / Redo.
 */
export function PdfModeSelector({
  mode,
  onModeChange,
  lineCount,
  onApply,
  onResetLines,
  onNewBlock,
  order,
  onOrderChange,
  applying,
  steps,
  stepIndex,
  canRevert,
  canRedo,
  onRevert,
  onRedo,
}: PdfModeSelectorProps): JSX.Element {
  const isReflow = mode === 'reflow';
  const applyLabel = isReflow ? 'Apply reflow' : `Apply ${mode} cut`;
  return (
    <Toolbar ariaLabel="Cut mode">
      <ToolbarGroup>
        <div className="segmented" role="tablist" aria-label="Cut mode">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="tab"
              aria-selected={mode === option.mode}
              className={`segmented__item ${mode === option.mode ? 'is-active' : ''}`}
              title={option.hint}
              disabled={option.disabled}
              onClick={() => { onModeChange(option.mode); }}
            >
              {option.label}
              {option.disabled ? <span className="segmented__soon">soon</span> : null}
            </button>
          ))}
        </div>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        {isReflow ? (
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            disabled={applying}
            onClick={onNewBlock}
            title="Start a new block — crops you draw next join this question"
          >
            <IconPlus /> New block
          </button>
        ) : (
          <label className="tbar__order" title="Order the split cells become pages">
            Order
            <select
              value={order}
              onChange={(event) => { onOrderChange(event.target.value as ReadingOrder); }}
            >
              <option value="column">Column-major</option>
              <option value="row">Row-major</option>
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={lineCount === 0 || applying}
          onClick={onApply}
          title={isReflow ? `Stack each block onto one page (${combo(MOD_KEY, ENTER_KEY)})` : `Split the pages along the current lines into a new PDF (${combo(MOD_KEY, ENTER_KEY)})`}
        >
          {applying ? 'Applying…' : applyLabel}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={lineCount === 0 || applying}
          onClick={onResetLines}
          title={isReflow ? 'Clear the crops you have drawn' : 'Clear the lines you have drawn on the current PDF'}
        >
          {isReflow ? 'Reset crops' : 'Reset lines'}
        </button>
      </ToolbarGroup>

      <ToolbarSpacer />

      <ToolbarGroup>
        <IconButton
          icon={<IconUndo />}
          label="Revert to the previous PDF version"
          disabled={!canRevert || applying}
          onClick={onRevert}
        />
        <span className="tbar__count" title={steps.join(' → ')}>
          step {stepIndex + 1}/{steps.length || 1}
          {steps[stepIndex] ? ` · ${steps[stepIndex]}` : ''}
        </span>
        <IconButton
          icon={<IconRedo />}
          label="Redo to the next PDF version"
          disabled={!canRedo || applying}
          onClick={onRedo}
        />
      </ToolbarGroup>
    </Toolbar>
  );
}
