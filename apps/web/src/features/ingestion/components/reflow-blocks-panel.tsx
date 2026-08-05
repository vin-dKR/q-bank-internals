import { type JSX } from 'react';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import { blockColor } from '../types/reflow-block.js';

type ReflowBlocksPanelProps = {
  controller: ReflowController;
};

/**
 * The reflow blocks list: one row per block, in the order they become output pages. Click to make a
 * block active (crops you draw next join it), reorder with ↑ / ↓, or delete. Mirrors the standalone
 * PDF_CM "cards" panel.
 */
export function ReflowBlocksPanel({ controller }: ReflowBlocksPanelProps): JSX.Element {
  const { blocks, activeId, newBlock, setActive, moveBlock, removeBlock } = controller;

  return (
    <div className="reflow-panel stack">
      <div className="reflow-panel__head">
        <h2>Reflow blocks</h2>
        <button type="button" className="btn btn--ghost" onClick={newBlock}>
          + New block
        </button>
      </div>

      {blocks.length === 0 ? (
        <p className="muted">Drag a box around a question, then another around its spilled options — they stack onto one page.</p>
      ) : (
        <ul className="reflow-panel__list">
          {blocks.map((block, index) => {
            const pages = [...new Set(block.crops.map((c) => c.page))].sort((a, b) => a - b).join(', ');
            return (
              <li
                key={block.id}
                className={`reflow-panel__item ${block.id === activeId ? 'is-active' : ''}`}
                style={{ ['--block-color' as string]: blockColor(index) }}
                onClick={() => { setActive(block.id); }}
              >
                <span className="reflow-panel__swatch" />
                <div className="reflow-panel__body">
                  <span className="reflow-panel__title">Block {index + 1}</span>
                  <span className="muted">
                    {block.crops.length} crop{block.crops.length === 1 ? '' : 's'}
                    {pages ? ` · page ${pages}` : ''}
                    {block.crops.length > 1 ? ' · stacked' : ''}
                  </span>
                </div>
                <div className="reflow-panel__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon"
                    title="Move up"
                    disabled={index === 0}
                    onClick={(e) => { e.stopPropagation(); moveBlock(block.id, -1); }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon"
                    title="Move down"
                    disabled={index === blocks.length - 1}
                    onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 1); }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon"
                    title="Delete block"
                    onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
