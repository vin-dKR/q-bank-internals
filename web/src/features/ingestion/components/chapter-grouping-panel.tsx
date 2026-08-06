import { type JSX } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import type { SplitPointsByPage } from '../types/split-point.js';
import {
  type ChapterGroup,
  type ChapterMetadataDraft,
  emptyMetadata,
} from '../types/chapter-group.js';
import { type PageKinds, type SliceTags, slicesForRange } from '../lib/build-chapter-pdfs.js';
import { ChapterMetadataForm } from './chapter-metadata-form.js';
import { SliceTagList } from './slice-tag-list.js';

type ChapterGroupingPanelProps = {
  groups: ChapterGroup[];
  onChange: (groups: ChapterGroup[]) => void;
  numPages: number;
  splitPoints: SplitPointsByPage;
  pageKinds?: PageKinds | undefined;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
};

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Define chapters as page ranges, tag their slices, and capture their Drive metadata. */
export function ChapterGroupingPanel({
  groups,
  onChange,
  numPages,
  splitPoints,
  pageKinds,
  hoveredSliceId,
  onHoverSlice,
}: ChapterGroupingPanelProps): JSX.Element {
  const update = (id: string, patch: Partial<ChapterGroup>): void => {
    onChange(groups.map((group) => (group.id === id ? { ...group, ...patch } : group)));
  };

  const updateMetadata = (id: string, patch: Partial<ChapterMetadataDraft>): void => {
    onChange(
      groups.map((group) =>
        group.id === id ? { ...group, metadata: { ...group.metadata, ...patch } } : group,
      ),
    );
  };

  const tagSlice = (id: string, sliceId: string, kind: ChapterKind): void => {
    onChange(
      groups.map((group) =>
        group.id === id ? { ...group, tags: { ...group.tags, [sliceId]: kind } } : group,
      ),
    );
  };

  const tagAll = (group: ChapterGroup, kind: ChapterKind): void => {
    const slices = slicesForRange({ from: group.from, to: group.to }, splitPoints);
    const tags: SliceTags = { ...group.tags };
    for (const slice of slices) {
      tags[slice.id] = kind;
    }
    update(group.id, { tags });
  };

  const addChapter = (): void => {
    const start = groups.length > 0 ? Math.min((groups[groups.length - 1]?.to ?? 0) + 1, numPages) : 1;
    onChange([
      ...groups,
      {
        id: makeId(),
        from: Math.max(1, start),
        to: Math.max(start, numPages),
        metadata: emptyMetadata(),
        tags: {},
      },
    ]);
  };

  const removeChapter = (id: string): void => {
    onChange(groups.filter((group) => group.id !== id));
  };

  return (
    <div className="stack">
      {groups.length === 0 ? (
        <p className="muted">No chapters yet. Add one, set its page range, and tag its slices.</p>
      ) : null}

      {groups.map((group, index) => (
        <div key={group.id} className="chapter-card">
          <div className="chapter-card__head">
            <strong>
              <span className="chip chip--chapter">Chapter {index + 1}</span>
            </strong>
            <button type="button" className="btn btn--ghost" onClick={() => { removeChapter(group.id); }}>
              Remove
            </button>
          </div>

          <div className="folder-select__row">
            <label className="field field--inline">
              <span>Pages</span>
              <input
                type="number"
                min={1}
                max={numPages || undefined}
                value={group.from}
                onChange={(event) => { update(group.id, { from: Number(event.target.value) }); }}
              />
            </label>
            <label className="field field--inline">
              <span>to</span>
              <input
                type="number"
                min={1}
                max={numPages || undefined}
                value={group.to}
                onChange={(event) => { update(group.id, { to: Number(event.target.value) }); }}
              />
            </label>
          </div>

          <ChapterMetadataForm
            value={group.metadata}
            onChange={(patch) => { updateMetadata(group.id, patch); }}
          />

          <div className="stack stack--tight">
            <div className="chapter-card__slices-head">
              <span className="muted">Slices</span>
              <div className="folder-select__row">
                <button type="button" className="btn btn--ghost btn--xs" onClick={() => { tagAll(group, 'question'); }}>
                  All → Question
                </button>
                <button type="button" className="btn btn--ghost btn--xs" onClick={() => { tagAll(group, 'answer'); }}>
                  All → Answer
                </button>
                <button type="button" className="btn btn--ghost btn--xs" onClick={() => { tagAll(group, 'solution'); }}>
                  All → Solution
                </button>
              </div>
            </div>
            <SliceTagList
              range={{ from: group.from, to: group.to }}
              splitPoints={splitPoints}
              tags={group.tags}
              pageKinds={pageKinds}
              hoveredSliceId={hoveredSliceId}
              onHoverSlice={onHoverSlice}
              onTag={(sliceId, kind) => { tagSlice(group.id, sliceId, kind); }}
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn" onClick={addChapter}>
        + Add chapter
      </button>
    </div>
  );
}
