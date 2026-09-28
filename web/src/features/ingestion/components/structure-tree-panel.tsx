import {
  type ChangeEvent,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  useRef,
  useState,
} from 'react';
import {
  type AnswerLayout,
  CBSE_CLASS_NAMES,
  type ChapterKind,
  shouldCollectClassName,
  PAPER_METADATA_FIELDS,
  type PaperMetadataKey,
} from '@ingest/contracts';
import {
  Combobox,
  EmptyState,
  IconButton,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconLayers,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconX,
  Spinner,
} from '../../../shared/ui/index.js';
import { saveBlob } from '../../../shared/lib/files.js';
import type { ChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { StructureTreeController } from '../hooks/use-structure-tree.js';
import { cascadeMetadata } from '../lib/metadata-cascade.js';
import { isPageDrag, readDraggedPages } from '../lib/page-dnd.js';
import { parsePageRange, pageRangeText } from '../lib/page-range.js';
import { parseConfig, serializeConfig, type ParsedConfig } from '../lib/structure-config.js';
import { type NodeLevel, type StructureNode, isLeaf } from '../types/structure-node.js';

type StructureTreePanelProps = {
  controller: StructureTreeController;
  vocabulary: ChapterVocabulary;
  /** Materialize the dragged pages and bind them to the leaf's kind (the page owns the working bytes). */
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  /** `${leafId}:${kind}` currently materializing, for a busy state on that one slot. */
  bindingSlot: string | null;
  /** Page count of the working document, so typed page ranges can be range-checked before binding. */
  maxPages: number;
  /** Load a parsed config into the tree (and re-bind its page assignments) — owned by the page. */
  onImport: (parsed: ParsedConfig) => void;
  /** Report a rejected config import (bad/unreadable file) so the page can toast it. */
  onImportError: (message: string) => void;
  /** Read the paper header (page 1) with AI and fill the paper-details form. Owned by the page. */
  onAiFillPaper: () => void;
  /** True while the AI-fill read is in flight, for the button's busy state. */
  aiFillingPaper: boolean;
};

const LEVEL_OPTIONS = ['Section', 'Part', 'Topic'] as const;
const SEPARATE_PART_KINDS: readonly ChapterKind[] = ['question', 'answer', 'solution'];
/** A grouped Answer + Solution source is a first-class companion, never two ambiguous sibling files. */
const COMBINED_PART_KINDS: readonly ChapterKind[] = ['question', 'companion'];
/** Inline-answer papers bind only the combined Question PDF — the answer travels with each question. */
const INLINE_PART_KINDS: readonly ChapterKind[] = ['question'];
const KIND_LABEL: Record<ChapterKind, string> = {
  question: 'Question',
  answer: 'Answer',
  solution: 'Solution',
  companion: 'Answer + solution',
};
/** Static per-kind class strings (Tailwind can't see dynamically built names). */
const KIND_TONE: Record<ChapterKind, { empty: string; filled: string; chip: string }> = {
  question: {
    empty: 'border-q/40 text-q hover:bg-q/5',
    filled: 'border-q/40 bg-q/5',
    chip: 'bg-q/10 text-q',
  },
  answer: {
    empty: 'border-a/40 text-a hover:bg-a/5',
    filled: 'border-a/40 bg-a/5',
    chip: 'bg-a/10 text-a',
  },
  solution: {
    empty: 'border-s/40 text-s hover:bg-s/5',
    filled: 'border-s/40 bg-s/5',
    chip: 'bg-s/10 text-s',
  },
  companion: {
    empty: 'border-brand/40 text-brand hover:bg-brand/5',
    filled: 'border-brand/40 bg-brand/5',
    chip: 'bg-brand/10 text-brand',
  },
};

/** Return exactly the source slots that make sense for the selected answer layout. */
function partKindsForLayout(layout: AnswerLayout): readonly ChapterKind[] {
  if (layout === 'inline') return INLINE_PART_KINDS;
  if (layout === 'combined') return COMBINED_PART_KINDS;
  return SEPARATE_PART_KINDS;
}

function toLevel(display: string): NodeLevel | null {
  const value = display.trim().toLowerCase();
  return value === 'section' || value === 'part' || value === 'topic' ? value : null;
}
function levelDisplay(level: NodeLevel | null): string {
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : '';
}
/** A filesystem-safe stem for the exported config, derived from the chapter (or module) name. */
function configFileName(chapter: string, module: string): string {
  const base = chapter.trim() || module.trim() || 'chapter';
  return `${base.replace(/[^\w.-]+/g, '-')}-structure.json`;
}

/**
 * The right pane: the durable structure tree an operator builds by hand. Chapter metadata at the top,
 * then a flexible `Section → Part → Topic` tree (every level optional). The layout-selected question
 * and supporting slices are dropped onto (or typed into) a leaf's slots; because the tree lives
 * outside the working document, editing the PDF on the left never disturbs anything here. The whole
 * structure can be exported/imported as JSON so a chapter's shape is reusable across documents.
 */
export function StructureTreePanel({
  controller,
  vocabulary,
  onBindPages,
  bindingSlot,
  maxPages,
  onImport,
  onImportError,
  onAiFillPaper,
  aiFillingPaper,
}: StructureTreePanelProps): JSX.Element {
  const { tree } = controller;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);
  // The paper-details panel only applies to previous-year-question uploads; it stays hidden for the
  // module/textbook sources, which carry no whole-paper provenance.
  const isPyq = tree.metadata.source.trim().toLowerCase() === 'pyq';
  const showClass = shouldCollectClassName(tree.metadata.exam, tree.metadata.module);

  const toggleCollapse = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportConfig = (): void => {
    const json = JSON.stringify(serializeConfig(tree), null, 2);
    saveBlob(
      new Blob([json], { type: 'application/json' }),
      configFileName(tree.metadata.chapter, tree.metadata.module),
    );
  };

  const importConfig = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const parsed = parseConfig(await file.text());
    if (!parsed) {
      onImportError('That file is not a valid structure config.');
      return;
    }
    onImport(parsed);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Chapter
        </h3>
        <MetaField
          label="Source"
          value={tree.metadata.source}
          options={vocabulary.sources}
          placeholder="pyq / module / textbook"
          onChange={(v) => {
            controller.setMetadata({ source: v });
          }}
        />
        {isPyq ? (
          // A PYQ paper spans subjects, chapters, and no single module. Its exam is set once in Paper
          // details below (it fills the exam name), and each section's subject is set on its node.
          <p className="text-[13px] text-ink-3">
            Previous-year paper: set the <strong>exam</strong> in Paper details below, and each
            section&rsquo;s
            <strong> subject</strong> on its node beside the question type.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetaField
              label="Module"
              value={tree.metadata.module}
              options={vocabulary.modules}
              placeholder="e.g. Allen / PW"
              onChange={(v) => {
                controller.setMetadata(cascadeMetadata('module', v, tree.metadata, vocabulary));
              }}
            />
            <MetaField
              label="Exam"
              value={tree.metadata.exam}
              options={vocabulary.exams}
              placeholder="e.g. JEE"
              onChange={(v) => {
                controller.setMetadata(cascadeMetadata('exam', v, tree.metadata, vocabulary));
              }}
            />
            {showClass ? (
              <MetaField
                label="Class"
                value={tree.metadata.className}
                options={CBSE_CLASS_NAMES}
                placeholder="Select class"
                onChange={(v) => {
                  controller.setMetadata({ className: v });
                }}
              />
            ) : null}
            <MetaField
              label="Subject"
              value={tree.metadata.subject}
              options={vocabulary.subjectsFor(tree.metadata.exam)}
              placeholder="e.g. Physics"
              onChange={(v) => {
                controller.setMetadata(cascadeMetadata('subject', v, tree.metadata, vocabulary));
              }}
            />
            <MetaField
              label="Chapter"
              value={tree.metadata.chapter}
              options={vocabulary.chaptersFor(tree.metadata.subject)}
              placeholder="e.g. Gravitation"
              onChange={(v) => {
                controller.setMetadata(cascadeMetadata('chapter', v, tree.metadata, vocabulary));
              }}
            />
          </div>
        )}
      </section>

      <AnswerLayoutSection controller={controller} />

      {isPyq ? (
        <PaperDetailsSection
          controller={controller}
          vocabulary={vocabulary}
          onAiFillPaper={onAiFillPaper}
          aiFillingPaper={aiFillingPaper}
          canAiFill={maxPages > 0}
        />
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            Structure
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={exportConfig}
              title="Download this chapter + structure as a reusable JSON config"
            >
              <IconDownload /> Export
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => {
                importInputRef.current?.click();
              }}
              title="Load a chapter + structure from a JSON config (replaces the current tree)"
            >
              Import
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => {
                controller.addNode(null, null);
              }}
            >
              <IconPlus /> Add node
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                void importConfig(event);
              }}
            />
          </div>
        </div>

        {controller.hasNodes ? (
          <>
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
                  maxPages={maxPages}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                />
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--ghost btn--xs self-start"
              onClick={() => {
                controller.addNode(null, null);
              }}
            >
              <IconPlus /> Add node
            </button>
          </>
        ) : (
          <EmptyState
            icon={<IconLayers />}
            title="No structure yet"
            body="Add a section, part, or topic — then bind the question and its answer source onto each leaf. A flat paper is just one node."
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  controller.addNode(null, null);
                }}
              >
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
      {/* Every metadata field is masters-controlled (or a fixed source enum): only managed values allowed. */}
      <Combobox
        value={value}
        options={options}
        placeholder={placeholder}
        onChange={onChange}
        allowCustom={false}
      />
    </label>
  );
}

const ANSWER_LAYOUTS: readonly { value: AnswerLayout; label: string; hint: string }[] = [
  {
    value: 'separate',
    label: 'Grouped separately',
    hint: 'Answer key on a last page or a sibling answer/solution PDF — bind it to the Answer/Solution slots.',
  },
  {
    value: 'combined',
    label: 'One companion PDF',
    hint: 'Questions are separate; one grouped Answer + Solution PDF is uploaded beside them — bind it to the companion slot.',
  },
  {
    value: 'inline',
    label: 'Inline with each question',
    hint: 'Each question is followed by its own answer (and any explanation) in one combined PDF — only bind the Question slot; extraction reads the answer beside each question.',
  },
];

/**
 * The answer-layout chooser — universal across every source (module / textbook / pyq). It decides how
 * extraction reads answers (separate siblings, one grouped companion, or inline beside each question)
 * and selects the matching drop-slots. Sits above the structure so the operator sets it before binding
 * pages.
 */
function AnswerLayoutSection({ controller }: { controller: StructureTreeController }): JSX.Element {
  const { metadata } = controller.tree;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
        Answer layout
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        {ANSWER_LAYOUTS.map((option) => {
          const active = metadata.answerLayout === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`rounded-lg border p-2 text-left text-[12px] transition-colors ${active ? 'border-brand bg-brand/5 text-ink' : 'border-line text-ink-2 hover:bg-surface-2'}`}
              aria-pressed={active}
              onClick={() => {
                controller.setMetadata({ answerLayout: option.value });
              }}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className="mt-0.5 block text-ink-3">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type PaperDetailsSectionProps = {
  controller: StructureTreeController;
  vocabulary: ChapterVocabulary;
  onAiFillPaper: () => void;
  aiFillingPaper: boolean;
  /** Whether a working document with pages is loaded — the AI-fill needs a page to read. */
  canAiFill: boolean;
};

/**
 * The PYQ paper-details panel: the whole-paper provenance (exam name/year/session/shift/paper code …)
 * plus the answer-layout choice. Shown only for the `pyq` source. The 14 fields are AI-fillable from
 * the paper's header page and hand-editable; the layout toggle decides whether extraction expects a
 * separate answer key or reads each question's inline answer (and whether Verify shows an answer pane).
 */
function PaperDetailsSection({
  controller,
  vocabulary,
  onAiFillPaper,
  aiFillingPaper,
  canAiFill,
}: PaperDetailsSectionProps): JSX.Element {
  const { metadata } = controller.tree;
  const [collapsed, setCollapsed] = useState(false);
  const showClass = shouldCollectClassName(metadata.exam, metadata.module);
  const setPaperField = (key: PaperMetadataKey, value: string): void => {
    controller.setMetadata({
      paper: { ...metadata.paper, [key]: value },
      // The exam name here is the paper's exam — it also fills the document's main exam, since a PYQ
      // paper files under it (there is no separate Exam field in the chapter form for PYQ).
      ...(key === 'pyqExamName'
        ? {
            exam: value,
            // Do not carry a grade from a prior CBSE paper into a different exam.
            ...(!shouldCollectClassName(value, metadata.module) ? { className: '' } : {}),
          }
        : {}),
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-3"
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed((open) => !open);
          }}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronDown />}
          Paper details
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={!canAiFill || aiFillingPaper}
          onClick={onAiFillPaper}
          title={
            canAiFill
              ? 'Read the exam, year, date, shift … off the paper’s first page'
              : 'Load a PDF first'
          }
        >
          {aiFillingPaper ? (
            <>
              <Spinner /> Reading…
            </>
          ) : (
            <>
              <IconSparkle /> AI-fill from paper
            </>
          )}
        </button>
      </div>

      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {PAPER_METADATA_FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="field">
                <span>{label}</span>
                {key === 'pyqExamName' ? (
                  // The exam name is a dropdown of known exams (it also sets the document's main exam).
                  <Combobox
                    value={metadata.paper[key]}
                    options={vocabulary.exams}
                    placeholder={`e.g. ${placeholder}`}
                    onChange={(value) => {
                      setPaperField(key, value);
                    }}
                    allowCustom={false}
                  />
                ) : (
                  <input
                    className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
                    value={metadata.paper[key]}
                    placeholder={`e.g. ${placeholder}`}
                    onChange={(event) => {
                      setPaperField(key, event.target.value);
                    }}
                  />
                )}
              </label>
            ))}
            {showClass ? (
              <label className="field">
                <span>Class</span>
                <Combobox
                  value={metadata.className}
                  options={CBSE_CLASS_NAMES}
                  placeholder="Select class"
                  onChange={(value) => {
                    controller.setMetadata({ className: value });
                  }}
                  allowCustom={false}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

type TreeNodeRowProps = {
  node: StructureNode;
  depth: number;
  controller: StructureTreeController;
  vocabulary: ChapterVocabulary;
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  bindingSlot: string | null;
  maxPages: number;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
};

function TreeNodeRow({
  node,
  depth,
  controller,
  vocabulary,
  onBindPages,
  bindingSlot,
  maxPages,
  collapsed,
  onToggleCollapse,
}: TreeNodeRowProps): JSX.Element {
  const leaf = isLeaf(node);
  // The question type is chosen only on the leaf (the last node in a branch) — never on an
  // organizing parent. Each leaf carries its own type; there is no inheritance to configure.
  const showQuestionType = leaf;
  const hasBindings = node.bindings !== undefined && Object.keys(node.bindings).length > 0;
  const collapsible = node.children.length > 0 || hasBindings;
  const isCollapsed = collapsed.has(node.id);
  const partKinds = partKindsForLayout(controller.tree.metadata.answerLayout);
  const slotColumns =
    partKinds.length === 1 ? 'grid-cols-1' : partKinds.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  // A PYQ-source chapter defaults every leaf's PYQ toggle ON (the operator can still uncheck a leaf) —
  // an explicit choice wins, so `node.pyq` (once set) is honoured over the source default.
  const pyqSource = controller.tree.metadata.source.trim().toLowerCase() === 'pyq';
  const nodePyq = node.pyq ?? pyqSource;

  return (
    <li className="rounded-lg border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        {collapsible ? (
          <IconButton
            icon={isCollapsed ? <IconChevronRight /> : <IconChevronDown />}
            label={isCollapsed ? 'Expand node' : 'Collapse node'}
            size="sm"
            onClick={() => {
              onToggleCollapse(node.id);
            }}
          />
        ) : (
          <span className="w-7 flex-none" aria-hidden />
        )}
        <div className="w-[104px] flex-none">
          <Combobox
            value={levelDisplay(node.level)}
            options={LEVEL_OPTIONS}
            allowCustom={false}
            placeholder="Level"
            onChange={(display) => {
              controller.setNodeLevel(node.id, toLevel(display));
            }}
          />
        </div>
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          value={node.label}
          placeholder={node.level ? `${levelDisplay(node.level)} name` : 'Name'}
          onChange={(event) => {
            controller.renameNode(node.id, event.target.value);
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--xs flex-none"
          onClick={() => {
            controller.addNode(node.id, null);
          }}
        >
          <IconPlus /> Child
        </button>
        <IconButton
          icon={<IconCopy />}
          label="Duplicate node"
          size="sm"
          onClick={() => {
            controller.duplicateNode(node.id);
          }}
        />
        <IconButton
          icon={<IconTrash />}
          label="Remove node"
          variant="danger"
          size="sm"
          onClick={() => {
            controller.removeNode(node.id);
          }}
        />
      </div>

      {!isCollapsed && showQuestionType ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-[104px] flex-none text-[12px] font-medium text-ink-3">
              {nodePyq ? 'Type (optional)' : 'Question type'}
            </span>
            <div className="min-w-0 flex-1">
              {/* Optional for a PYQ segment — its questions are of mixed types, extracted generically.
                  Options come from the managed questionType master plus the two explicit supported
                  profiles that legacy bank taxonomy folds into Subjective. */}
              <Combobox
                value={node.questionType ?? ''}
                options={vocabulary.questionTypes}
                placeholder={
                  nodePyq ? 'optional — leave blank for mixed types' : 'e.g. Single Correct'
                }
                onChange={(value) => {
                  controller.setQuestionType(node.id, value);
                }}
                allowCustom={false}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[104px] flex-none text-[12px] font-medium text-ink-3">Subject</span>
            <div className="min-w-0 flex-1">
              {/* All subjects, unfiltered by exam — a PYQ paper's sections span subjects. */}
              <Combobox
                value={node.subject ?? ''}
                options={vocabulary.subjects}
                placeholder="e.g. Physics"
                onChange={(value) => {
                  controller.setNodeSubject(node.id, value);
                }}
                allowCustom={false}
              />
            </div>
          </div>
        </div>
      ) : null}

      {!isCollapsed && leaf ? (
        <label className="mt-2 flex w-fit items-center gap-2 text-[12px] font-medium text-ink-2">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={nodePyq}
            onChange={(event) => {
              controller.setNodePyq(node.id, event.target.checked);
            }}
          />
          <span>
            PYQ — previous-year questions (AI reads each question&rsquo;s source exam &amp; year)
          </span>
        </label>
      ) : null}

      {!isCollapsed && leaf ? (
        // The active layout is the source of truth: inline binds only Question; combined binds Question
        // plus one grouped Answer + Solution companion; separate keeps the historical three slots.
        <div className={`mt-2 grid gap-1.5 ${slotColumns}`}>
          {partKinds.map((kind) => (
            <BindingSlot
              key={kind}
              leafId={node.id}
              kind={kind}
              node={node}
              busy={bindingSlot === `${node.id}:${kind}`}
              maxPages={maxPages}
              onBindPages={onBindPages}
              onUnbind={() => {
                controller.unbindArtifact(node.id, kind);
              }}
            />
          ))}
        </div>
      ) : null}

      {!isCollapsed && node.children.length > 0 ? (
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
              maxPages={maxPages}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
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
  maxPages: number;
  onBindPages: (leafId: string, kind: ChapterKind, pages: number[]) => void;
  onUnbind: () => void;
};

function BindingSlot({
  leafId,
  kind,
  node,
  busy,
  maxPages,
  onBindPages,
  onUnbind,
}: BindingSlotProps): JSX.Element {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
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
  const commitPages = (pages: number[]): void => {
    setEditing(false);
    onBindPages(leafId, kind, pages);
  };

  if (artifact && !editing) {
    return (
      <div
        className={`flex flex-col gap-1 rounded-lg border p-1.5 ${tone.filled}`}
        onDoubleClick={() => {
          setEditing(true);
        }}
        title="Double-click to retype this slot's pages"
      >
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}
          >
            {KIND_LABEL[kind]}
          </span>
          <IconButton
            icon={<IconX />}
            label={`Unbind ${KIND_LABEL[kind]}`}
            size="sm"
            onClick={onUnbind}
          />
        </div>
        <span className="truncate text-[12px] text-ink-2" title={artifact.sourceLabel}>
          {artifact.sourceLabel}
        </span>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={`flex flex-col gap-1 rounded-lg border p-1.5 ${tone.filled}`}>
        <span
          className={`inline-flex items-center self-start rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}
        >
          {KIND_LABEL[kind]}
        </span>
        <PageRangeInput
          maxPages={maxPages}
          initial={artifact ? pageRangeText(artifact.pageNumbers) : ''}
          onCommit={commitPages}
          onCancel={() => {
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-slot-kind={kind}
      data-slot-leaf={leafId}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => {
        setOver(false);
      }}
      className={`flex min-h-[52px] flex-col items-stretch justify-center gap-1 rounded-lg border border-dashed p-1.5 text-center text-[12px] font-medium transition-colors ${tone.empty} ${over ? 'bg-surface-2 ring-2 ring-brand/30' : ''}`}
    >
      {busy ? (
        <span className="flex justify-center">
          <Spinner />
        </span>
      ) : (
        <>
          <span className="text-[11px] font-semibold uppercase tracking-wide">
            {KIND_LABEL[kind]}
          </span>
          <span className="text-ink-3">drop pages</span>
          <PageRangeInput maxPages={maxPages} onCommit={commitPages} />
        </>
      )}
    </div>
  );
}

type PageRangeInputProps = {
  maxPages: number;
  initial?: string;
  onCommit: (pages: number[]) => void;
  onCancel?: () => void;
};

/**
 * A tiny text field for typing a page range (`"3-5, 8"`) straight into a binding slot. Enter *or*
 * blurring commits; an unparseable value flags the field and holds instead of binding a wrong slice.
 * An empty field commits nothing, so clicking away from an untouched slot never flags it.
 */
function PageRangeInput({
  maxPages,
  initial = '',
  onCommit,
  onCancel,
}: PageRangeInputProps): JSX.Element {
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const committed = useRef(false);

  const commit = (): void => {
    if (committed.current || text.trim() === '') return;
    const pages = parsePageRange(text, maxPages);
    if (pages) {
      committed.current = true;
      onCommit(pages);
    } else {
      setInvalid(true);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  };

  return (
    <input
      type="text"
      value={text}
      autoFocus={initial.length > 0}
      placeholder="type pages"
      aria-label="Page range"
      aria-invalid={invalid}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      className={`w-full rounded-md border bg-surface px-1.5 py-1 text-center text-[12px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 ${invalid ? 'border-bad focus-visible:ring-bad/30' : 'border-line focus-visible:ring-brand/25'}`}
    />
  );
}
