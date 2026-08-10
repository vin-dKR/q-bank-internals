import { type DragEvent, type JSX, useState } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import { Combobox, EmptyState, IconButton, IconLayers, IconPlus, IconTrash, IconX, Spinner } from '../../../shared/ui/index.js';
import type { ChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { StructureTreeController } from '../hooks/use-structure-tree.js';
import { isPageDrag, readDraggedPages } from '../lib/page-dnd.js';
import { type NodeLevel, type StructureNode, isLeaf } from '../types/structure-node.js';

type StructureTreePanelProps = {
  controller: StructureTreeController;
  vocabulary: ChapterVocabulary;
  /** Materialize the dragged pages and bind them to the leaf's kind (the page owns the working bytes). */
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  /** `${leafId}:${kind}` currently materializing, for a busy state on that one slot. */
  bindingSlot: string | null;
};

const LEVEL_OPTIONS = ['Section', 'Part', 'Topic'] as const;
const PART_KINDS: readonly ChapterKind[] = ['question', 'answer', 'solution'];
const KIND_LABEL: Record<ChapterKind, string> = {
  question: 'Question',
  answer: 'Answer',
  solution: 'Solution',
};
/** Static per-kind class strings (Tailwind can't see dynamically built names). */
const KIND_TONE: Record<ChapterKind, { empty: string; filled: string; chip: string }> = {
  question: { empty: 'border-q/40 text-q hover:bg-q/5', filled: 'border-q/40 bg-q/5', chip: 'bg-q/10 text-q' },
  answer: { empty: 'border-a/40 text-a hover:bg-a/5', filled: 'border-a/40 bg-a/5', chip: 'bg-a/10 text-a' },
  solution: { empty: 'border-s/40 text-s hover:bg-s/5', filled: 'border-s/40 bg-s/5', chip: 'bg-s/10 text-s' },
};

function toLevel(display: string): NodeLevel | null {
  const value = display.trim().toLowerCase();
  return value === 'section' || value === 'part' || value === 'topic' ? value : null;
}
function levelDisplay(level: NodeLevel | null): string {
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : '';
}

/**
 * The right pane: the durable structure tree an operator builds by hand. Chapter metadata at the top,
 * then a flexible `Section → Part → Topic` tree (every level optional). Question/answer/solution
 * slices are dropped onto a leaf's three slots; because the tree lives outside the working document,
 * editing the PDF on the left never disturbs anything here.
 */
export function StructureTreePanel({
  controller,
  vocabulary,
  onBindPages,
  bindingSlot,
}: StructureTreePanelProps): JSX.Element {
  const { tree } = controller;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Chapter</h3>
        <MetaField label="Source" value={tree.metadata.source} options={vocabulary.sources} placeholder="pyq / module / textbook" onChange={(v) => { controller.setMetadata({ source: v }); }} />
        <div className="grid grid-cols-2 gap-2">
          <MetaField label="Exam" value={tree.metadata.exam} options={vocabulary.exams} placeholder="e.g. JEE" onChange={(v) => { controller.setMetadata({ exam: v }); }} />
          <MetaField label="Subject" value={tree.metadata.subject} options={vocabulary.subjects} placeholder="e.g. Physics" onChange={(v) => { controller.setMetadata({ subject: v }); }} />
          <MetaField label="Module" value={tree.metadata.module} options={vocabulary.modules} placeholder="e.g. Resonance" onChange={(v) => { controller.setMetadata({ module: v }); }} />
          <MetaField label="Chapter" value={tree.metadata.chapter} options={vocabulary.chapters} placeholder="e.g. Gravitation" onChange={(v) => { controller.setMetadata({ chapter: v }); }} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Structure</h3>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={() => { controller.addNode(null, null); }}
          >
            <IconPlus /> Add node
          </button>
        </div>

        {controller.hasNodes ? (
          <ul className="flex flex-col gap-1.5">
            {tree.nodes.map((node) => (
              <TreeNodeRow
                key={node.id}
                node={node}
                depth={0}
                controller={controller}
                vocabulary={vocabulary}
                onBindPages={onBindPages}
                bindingSlot={bindingSlot}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<IconLayers />}
            title="No structure yet"
            body="Add a section, part, or topic — then drop the question, answer, and solution slices onto each leaf. A flat paper is just one node."
            action={
              <button type="button" className="btn btn--primary" onClick={() => { controller.addNode(null, null); }}>
                <IconPlus /> Add first node
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}

type MetaFieldProps = {
  label: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  onChange: (value: string) => void;
};

function MetaField({ label, value, options, placeholder, onChange }: MetaFieldProps): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <Combobox value={value} options={options} placeholder={placeholder} onChange={onChange} />
    </label>
  );
}

type TreeNodeRowProps = {
  node: StructureNode;
  depth: number;
  controller: StructureTreeController;
  vocabulary: ChapterVocabulary;
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  bindingSlot: string | null;
};

function TreeNodeRow({ node, depth, controller, vocabulary, onBindPages, bindingSlot }: TreeNodeRowProps): JSX.Element {
  const leaf = isLeaf(node);
  const showQuestionType = leaf || node.level === 'part';

  return (
    <li className="rounded-lg border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        <div className="w-[104px] flex-none">
          <Combobox
            value={levelDisplay(node.level)}
            options={LEVEL_OPTIONS}
            allowCustom={false}
            placeholder="Level"
            onChange={(display) => { controller.setNodeLevel(node.id, toLevel(display)); }}
          />
        </div>
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          value={node.label}
          placeholder={node.level ? `${levelDisplay(node.level)} name` : 'Name'}
          onChange={(event) => { controller.renameNode(node.id, event.target.value); }}
        />
        <button type="button" className="btn btn--ghost btn--xs flex-none" onClick={() => { controller.addNode(node.id, null); }}>
          <IconPlus /> Child
        </button>
        <IconButton icon={<IconTrash />} label="Remove node" variant="danger" size="sm" onClick={() => { controller.removeNode(node.id); }} />
      </div>

      {showQuestionType ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[12px] font-medium text-ink-3">Question type</span>
          <div className="min-w-0 flex-1">
            <Combobox
              value={node.questionType ?? ''}
              options={vocabulary.questionTypes}
              placeholder={node.level === 'part' ? 'inherited by topics below' : 'e.g. single_correct'}
              onChange={(value) => { controller.setQuestionType(node.id, value); }}
            />
          </div>
        </div>
      ) : null}

      {leaf ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {PART_KINDS.map((kind) => (
            <BindingSlot
              key={kind}
              leafId={node.id}
              kind={kind}
              node={node}
              busy={bindingSlot === `${node.id}:${kind}`}
              onBindPages={onBindPages}
              onUnbind={() => { controller.unbindArtifact(node.id, kind); }}
            />
          ))}
        </div>
      ) : null}

      {node.children.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1.5 border-l border-line pl-2">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              controller={controller}
              vocabulary={vocabulary}
              onBindPages={onBindPages}
              bindingSlot={bindingSlot}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type BindingSlotProps = {
  leafId: string;
  kind: ChapterKind;
  node: StructureNode;
  busy: boolean;
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  onUnbind: () => void;
};

function BindingSlot({ leafId, kind, node, busy, onBindPages, onUnbind }: BindingSlotProps): JSX.Element {
  const [over, setOver] = useState(false);
  const artifact = node.bindings?.[kind];
  const tone = KIND_TONE[kind];

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    const pages = readDraggedPages(event);
    if (pages && pages.length > 0) onBindPages(leafId, kind, pages);
  };
  const onDragOver = (event: DragEvent): void => {
    if (!isPageDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  if (artifact) {
    return (
      <div className={`flex flex-col gap-1 rounded-lg border p-1.5 ${tone.filled}`}>
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}>{KIND_LABEL[kind]}</span>
          <IconButton icon={<IconX />} label={`Unbind ${KIND_LABEL[kind]}`} size="sm" onClick={onUnbind} />
        </div>
        <span className="truncate text-[12px] text-ink-2" title={artifact.sourceLabel}>{artifact.sourceLabel}</span>
      </div>
    );
  }

  return (
    <div
      data-slot-kind={kind}
      data-slot-leaf={leafId}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => { setOver(false); }}
      className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-1.5 text-center text-[12px] font-medium transition-colors ${tone.empty} ${over ? 'bg-surface-2 ring-2 ring-brand/30' : ''}`}
    >
      {busy ? <Spinner /> : <><span className="text-[11px] font-semibold uppercase tracking-wide">{KIND_LABEL[kind]}</span><span className="text-ink-3">drop pages</span></>}
    </div>
  );
}
