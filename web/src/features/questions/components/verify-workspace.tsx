import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DetectedFigure, ImageCrop, Question, ReExtractSource } from '@ingest/contracts';
import { DETECT_FIGURES_MAX_PAGES } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { useDocument } from '../../documents/index.js';
import { questionsApi } from '../api/questions.api.js';
import { questionsQueryKey, usePageCount, useQuestions, useUpdateQuestion } from '../hooks/use-questions.js';
import { useQuestionDrafts } from '../hooks/use-question-drafts.js';
import {
  type BoxRect,
  Button,
  type CanvasBox,
  type CanvasSize,
  CropCanvas,
  EmptyState,
  IconButton,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconLayers,
  IconRedo,
  IconSparkle,
  IconTrash,
  IconUndo,
  IconWarning,
  IconX,
  IconZoomIn,
  LoadingState,
  Spinner,
  ToolbarHelp,
} from '../../../shared/ui/index.js';
import {
  type CardBox,
  type CardDrawTarget,
  EditableQuestionCard,
} from './editable-question-card.js';
import { SourcePreviewPane } from './source-preview-pane.js';
import { useVerifySources } from '../hooks/use-verify-sources.js';

/** Which source PDFs sit beside the question page: question only, + answer, or + answer & solution. */
type ViewMode = 'question' | 'answer' | 'solution';

/** The view-toggle options. `needs` names the sibling document an option requires to be selectable. */
const VIEW_MODES: readonly { mode: ViewMode; label: string; needs: 'answer' | 'solution' | null }[] = [
  { mode: 'question', label: 'Question', needs: null },
  { mode: 'answer', label: '+ Answer', needs: 'answer' },
  { mode: 'solution', label: '+ Solution', needs: 'solution' },
];

/** Draggable split between the source page and the question panel — persisted width, clamped range. */
const PANEL_KEY = 'ingest:verifyPanelWidth';
const DEFAULT_PANEL = 460;
const MIN_PANEL = 340;
const MAX_PANEL = 760;

function readVerifyPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_KEY));
    return Number.isFinite(raw) && raw >= MIN_PANEL && raw <= MAX_PANEL ? raw : DEFAULT_PANEL;
  } catch {
    return DEFAULT_PANEL;
  }
}

function writeVerifyPanelWidth(width: number): void {
  try {
    localStorage.setItem(PANEL_KEY, String(width));
  } catch {
    // Storage unavailable (private mode) — the width just won't survive reload; nothing to recover.
    return;
  }
}

type Box = BoxRect & {
  id: string;
  questionId: string;
  type: 'question' | 'option';
  optionIndex: number;
  label: string;
  /** `ai` = an unconfirmed AI suggestion (marked, not yet saved); `manual` = drawn by the user. */
  source: 'manual' | 'ai';
  /** The verbatim "line above" the detector read for this figure, shown so the match can be eyeballed. */
  snippet?: string;
};

/** The question/option target a rubber-band draw on the canvas will crop into. */
type DrawTarget = { questionId: string; type: 'question' | 'option'; optionIndex: number };

/**
 * A one-shot crop into a non-canvas field (an explanation image, a match-the-column entry image).
 * Unlike a {@link DrawTarget}, this never becomes an editable box: the workspace arms a rubber-band on
 * the chosen source page, crops + uploads it, and resolves `resolve` with the image URL (or `null` when
 * the operator cancels / it's superseded) so the requesting card can drop the URL into its own field.
 */
type CropRequest = {
  questionId: string;
  /** Which page the crop is taken from: the question page (main canvas) or the sibling solution page. */
  source: 'question' | 'solution';
  resolve: (url: string | null) => void;
};

/** One in-flight auto-save per box; `again` re-runs it with the latest rect once the current pass ends. */
type SaveRun = { again: boolean; done: Promise<void> };

/**
 * A saved crop box remembered for its page in resolution-independent NATURAL image pixels, so it can
 * be redrawn at the same region on any fit when the operator navigates back to that page. Session-only
 * — the durable record is the attached image URL on the question; this just re-materialises the box.
 */
type SavedBoxSpec = {
  id: string;
  questionId: string;
  type: 'question' | 'option';
  optionIndex: number;
  label: string;
  source: 'manual' | 'ai';
  snippet?: string;
  /** Crop rect in natural image pixels. */
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  /** The image URL this saved crop attached to its question. */
  url: string;
};

/** Rebuild a display-pixel box from a natural-pixel spec against the page's current fitted size. */
function specToBox(spec: SavedBoxSpec, size: CanvasSize): Box {
  const sx = size.displayWidth / size.naturalWidth;
  const sy = size.displayHeight / size.naturalHeight;
  return {
    id: spec.id,
    questionId: spec.questionId,
    type: spec.type,
    optionIndex: spec.optionIndex,
    label: spec.label,
    source: spec.source,
    ...(spec.snippet !== undefined ? { snippet: spec.snippet } : {}),
    x: spec.nx * sx,
    y: spec.ny * sy,
    width: spec.nw * sx,
    height: spec.nh * sy,
  };
}

/** Capture a saved box as a natural-pixel spec so it survives a page's changing fitted size. */
function boxToSpec(box: Box, url: string, size: CanvasSize): SavedBoxSpec {
  const sx = size.naturalWidth / size.displayWidth;
  const sy = size.naturalHeight / size.displayHeight;
  return {
    id: box.id,
    questionId: box.questionId,
    type: box.type,
    optionIndex: box.optionIndex,
    label: box.label,
    source: box.source,
    ...(box.snippet !== undefined ? { snippet: box.snippet } : {}),
    nx: box.x * sx,
    ny: box.y * sy,
    nw: box.width * sx,
    nh: box.height * sy,
    url,
  };
}

/** Stable identity of a persisted crop for de-duping: its destination plus the image it attached. */
function cropKey(crop: { url: string; type: 'question' | 'option'; optionIndex: number }): string {
  return `${crop.type}:${String(crop.optionIndex)}:${crop.url}`;
}

/** The durable {@link ImageCrop} projection of a saved box spec — the rect stored on the question. */
function specToCrop(spec: SavedBoxSpec): ImageCrop {
  return {
    url: spec.url,
    type: spec.type,
    optionIndex: spec.optionIndex,
    nx: spec.nx,
    ny: spec.ny,
    nw: spec.nw,
    nh: spec.nh,
  };
}

/** Rebuild the session's natural-pixel specs for a question from the crops persisted on it. */
function cropsToSpecs(question: Question, number: number): SavedBoxSpec[] {
  return question.imageCrops.map((crop, index) => ({
    id: `persist_${question.id}_${crop.type}_${String(crop.optionIndex)}_${String(index)}`,
    questionId: question.id,
    type: crop.type,
    optionIndex: crop.optionIndex,
    label: `Q${String(number)}${crop.type === 'option' ? ` · option ${String(crop.optionIndex + 1)}` : ''}`,
    source: 'manual',
    nx: crop.nx,
    ny: crop.ny,
    nw: crop.nw,
    nh: crop.nh,
    url: crop.url,
  }));
}

/**
 * Add a crop to a question's persisted list keyed by its url, dropping any prior entry for the same
 * url and the one for a rect being replaced in place (a re-crop uploads a fresh url each time).
 */
function upsertCrop(
  existing: readonly ImageCrop[],
  crop: ImageCrop,
  replacedUrl: string | undefined,
): ImageCrop[] {
  const kept = existing.filter((c) => c.url !== crop.url && c.url !== replacedUrl);
  return [...kept, crop];
}

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

function hasQuestionImage(question: Question): boolean {
  return (question.questionImage ?? '').trim().length > 0;
}

/** Whether a figure's destination (the stem, or one option) already carries an image — the skip rule. */
function targetHasImage(
  question: Question,
  target: 'question' | 'option',
  optionIndex: number,
): boolean {
  return target === 'question'
    ? hasQuestionImage(question)
    : (question.optionImages[optionIndex] ?? '').trim().length > 0;
}

/** Progress of the whole-document run: pages detected, then figures cropped + attached. */
type AllPagesProgress = { phase: 'detect' | 'apply'; done: number; total: number };

/** Outcome of the whole-document run, shown once it finishes. */
type AllPagesSummary = {
  attached: number;
  skipped: number;
  pages: number;
  failed: number;
  /** Pages whose detection call failed (transient AI errors) — their figures were never detected. */
  failedPages: number;
};

function allPagesSummaryText(s: AllPagesSummary): string {
  if (s.attached === 0 && s.skipped === 0 && s.failed === 0 && s.failedPages === 0) {
    return 'No figures detected across the document.';
  }
  const parts = [
    `Attached ${String(s.attached)} figure${s.attached === 1 ? '' : 's'} across ${String(s.pages)} page${s.pages === 1 ? '' : 's'}.`,
  ];
  if (s.skipped > 0) parts.push(`${String(s.skipped)} skipped (already had an image).`);
  if (s.failed > 0) parts.push(`${String(s.failed)} failed — re-run or crop manually.`);
  if (s.failedPages > 0) {
    parts.push(
      `${String(s.failedPages)} page${s.failedPages === 1 ? '' : 's'} failed to detect — run again to retry.`,
    );
  }
  return parts.join(' ');
}

/** First ~10 words of a stem, stripped of LaTeX delimiters — enough to recognise the question. */
function firstLine(text: string): string {
  const clean = text.replace(/\\[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  return words.length > 10 ? `${words.slice(0, 10).join(' ')}…` : clean;
}

const THUMB_W = 108;
const THUMB_H = 80;

/**
 * The CSS that turns a plain element into a live window onto the page image showing exactly what a
 * crop box covers: the box region is contain-fit into a `viewW`×`viewH` viewport via a scaled
 * `background-image`. One place for the coordinate math so the small review thumbnail and the large
 * magnifier stay pixel-consistent; it tracks the box as it is drawn/dragged/resized (no canvas work).
 */
function cropWindowStyle(
  imageSrc: string,
  box: BoxRect,
  size: CanvasSize,
  viewW: number,
  viewH: number,
): CSSProperties {
  const scaleX = size.naturalWidth / size.displayWidth;
  const scaleY = size.naturalHeight / size.displayHeight;
  const bw = Math.max(1, box.width * scaleX);
  const bh = Math.max(1, box.height * scaleY);
  const k = Math.min(viewW / bw, viewH / bh);
  const offsetX = (viewW - bw * k) / 2 - box.x * scaleX * k;
  const offsetY = (viewH - bh * k) / 2 - box.y * scaleY * k;
  return {
    backgroundImage: `url("${imageSrc}")`,
    backgroundSize: `${String(size.naturalWidth * k)}px ${String(size.naturalHeight * k)}px`,
    backgroundPosition: `${String(offsetX)}px ${String(offsetY)}px`,
  };
}

/** A fixed-size preview of what a crop box covers, used in the AI-review list. */
function CropThumb({
  imageSrc,
  box,
  size,
}: {
  imageSrc: string;
  box: BoxRect;
  size: CanvasSize | null;
}): JSX.Element {
  if (!size || size.displayWidth === 0) return <div className="crop-thumb" />;
  return <div className="crop-thumb" style={cropWindowStyle(imageSrc, box, size, THUMB_W, THUMB_H)} />;
}

/**
 * CSS that fills an element of the crop's own aspect ratio with exactly the crop region (edge to
 * edge, no letterbox) by scaling the page `background-image` so the box maps onto `innerW`×`innerH`.
 */
function cropCoverStyle(
  imageSrc: string,
  box: BoxRect,
  size: CanvasSize,
  innerW: number,
): CSSProperties {
  const scaleX = size.naturalWidth / size.displayWidth;
  const scaleY = size.naturalHeight / size.displayHeight;
  const k = innerW / Math.max(1, box.width * scaleX);
  return {
    backgroundImage: `url("${imageSrc}")`,
    backgroundSize: `${String(size.naturalWidth * k)}px ${String(size.naturalHeight * k)}px`,
    backgroundPosition: `${String(-box.x * scaleX * k)}px ${String(-box.y * scaleY * k)}px`,
  };
}

/**
 * The magnifier panel: an Amazon-style live zoom of the crop currently being drawn or adjusted,
 * pinned beside the page (never over it). Rendered ONLY while a crop is active (the parent mounts it
 * on demand). The preview element takes the crop's own aspect ratio and is filled edge-to-edge with
 * the crop region, framed with an accent ring over a checkerboard backdrop so the cropped content is
 * clearly distinct from the border and the surrounding background. A caption shows the pixel size.
 */
function CropMagnifier({
  imageSrc,
  box,
  size,
}: {
  imageSrc: string;
  box: BoxRect;
  size: CanvasSize;
}): JSX.Element {
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const update = (): void => { setView({ width: el.clientWidth, height: el.clientHeight }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  const scaleX = size.naturalWidth / size.displayWidth;
  const scaleY = size.naturalHeight / size.displayHeight;
  const naturalW = Math.max(1, box.width * scaleX);
  const naturalH = Math.max(1, box.height * scaleY);
  const aspect = naturalW / naturalH;

  // Fit a box of the crop's aspect ratio inside the measured view (leave a little breathing room).
  const availW = Math.max(0, view.width - 16);
  const availH = Math.max(0, view.height - 16);
  let innerW = availW;
  let innerH = availW / aspect;
  if (innerH > availH) { innerH = availH; innerW = availH * aspect; }

  const ready = view.width > 0 && innerW > 0.5 && innerH > 0.5;
  return (
    <div className="verify__magnifier">
      <div className="verify__magnifier-head">
        <span className="flex items-center gap-1.5"><IconZoomIn /> Live crop preview</span>
        <span className="verify__magnifier-dims">{String(Math.round(naturalW))} × {String(Math.round(naturalH))} px</span>
      </div>
      <div ref={viewRef} className="verify__magnifier-view">
        {ready ? (
          <div
            className="verify__magnifier-crop"
            style={{ width: innerW, height: innerH, ...cropCoverStyle(imageSrc, box, size, innerW) }}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Verify crop workspace: left is the source page with crop regions; right is an editable card per
 * question. Crops save themselves — no per-crop "crop and save" click:
 *  - Manual — arm a target from its card (Add region), rubber-band draw the region, and the crop
 *    uploads + attaches on release. The box stays on the page in the "saved" style.
 *  - AI — "Auto-detect figures" drops MARKED boxes for review. Nothing is saved until you Confirm
 *    each (or Confirm all); Discard drops a suggestion without ever touching the database.
 *  - Adjust — every box (manual or AI) can be moved and resized by its edges/corners at any time.
 *    Releasing an adjusted saved box re-crops and replaces its attached image automatically (one save
 *    per release; overlapping releases coalesce). Right-click removes a box — for a saved box that
 *    also detaches its image, which is the undo path.
 *
 * `autoRun` (session `?auto=1`) runs the detection once on arrival — it still only marks for review.
 *
 * Text edits are LOCAL-FIRST ({@link useQuestionDrafts}): cards edit per-question drafts, dirty
 * questions carry an indicator, and only they are pushed — per card via Update, or all at once via
 * the panel's Update all. Image crops/uploads stay immediate against the freshest server data.
 */
export function VerifyWorkspace({
  documentId,
  autoRun = false,
  sessionBar = null,
  initialPage,
  focusQuestionId,
}: {
  documentId: string;
  autoRun?: boolean;
  /** The unit picker + publish controls, rendered pinned to the top of the right panel. */
  sessionBar?: ReactNode;
  /** Page to open on (a searched question's source page); defaults to the first page. */
  initialPage?: number;
  /** A question to scroll to and briefly ring once loaded — the one a bank search opened. */
  focusQuestionId?: string;
}): JSX.Element {
  const questions = useQuestions(documentId);
  const pageCount = usePageCount(documentId);
  const document = useDocument(documentId);
  const { mutateAsync: patchQuestion } = useUpdateQuestion();
  const queryClient = useQueryClient();
  // Local-first text editing: every card edit lands in a draft here; only dirty questions are pushed.
  const drafts = useQuestionDrafts(documentId, questions.data, {
    questionType: document.data?.questionType ?? null,
    sectionName: document.data?.sectionName ?? null,
    pyqExam: document.data?.pyqExam ?? null,
    pyqYear: document.data?.pyqYear ?? null,
  });

  const [page, setPage] = useState(initialPage ?? 1);
  // The sibling answer/solution sources for this unit, resolved for the page currently on screen so
  // both the preview panes and the answer/explanation re-read target this topic's pages in them.
  const sources = useVerifySources(document.data, page);
  // An inline-answer paper carries each question's answer beside it in the one question PDF — there is
  // no separate answer/solution PDF to show, so the side-by-side answer/solution views are dropped.
  const inlineAnswers = document.data?.answerLayout === 'inline';
  const viewModes = inlineAnswers ? VIEW_MODES.filter((option) => option.mode === 'question') : VIEW_MODES;
  const [viewMode, setViewMode] = useState<ViewMode>('question');
  const answerSource: ReExtractSource | undefined = sources.answer
    ? { documentId: sources.answer.document.id, page: sources.answer.defaultPage }
    : undefined;
  const solutionSource: ReExtractSource | undefined = sources.solution
    ? { documentId: sources.solution.document.id, page: sources.solution.defaultPage }
    : undefined;
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  // A pending one-shot field crop (explanation / match image); mirrored in a ref so the async draw +
  // upload path reads the live request without stale closures. Only one is armed at a time.
  const [cropRequest, setCropRequest] = useState<CropRequest | null>(null);
  const cropRequestRef = useRef<CropRequest | null>(null);
  /** boxId → the image URL its last successful save attached to the question. */
  const [savedUrls, setSavedUrls] = useState<ReadonlyMap<string, string>>(new Map());
  /** Boxes whose last auto-save failed — the card offers a manual Save retry for these. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  /** The live rubber-band rect while a new crop is being drawn — feeds the magnifier. */
  const [drawPreview, setDrawPreview] = useState<BoxRect | null>(null);
  /** The box currently being dragged/resized — feeds the magnifier while it is adjusted. */
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  /** A box briefly rung to draw the eye to it after "Edit crop" re-selected an already-drawn crop. */
  const [flashId, setFlashId] = useState<string | null>(null);

  // The scrolling question panel (scrolled back to the top on every page change) and the draggable
  // split between it and the source page.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number>(readVerifyPanelWidth);
  const panelWidthRef = useRef(panelWidth);
  const setPanel = useCallback((width: number): void => {
    const clamped = Math.min(MAX_PANEL, Math.max(MIN_PANEL, width));
    panelWidthRef.current = clamped;
    setPanelWidth(clamped);
  }, []);
  // Drag the splitter: moving the handle LEFT widens the question panel (grid columns are
  // page | resizer | panel), so subtract the pointer delta. The width persists on release.
  const onPanelResizeStart = useCallback((event: ReactMouseEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;
    const move = (moveEvent: MouseEvent): void => { setPanel(startWidth - (moveEvent.clientX - startX)); };
    const up = (): void => {
      writeVerifyPanelWidth(panelWidthRef.current);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.document.body.classList.remove('is-col-resizing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.document.body.classList.add('is-col-resizing');
  }, [setPanel]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ detected: number; placed: number; skipped: number } | null>(null);
  const [allProgress, setAllProgress] = useState<AllPagesProgress | null>(null);
  const [allSummary, setAllSummary] = useState<AllPagesSummary | null>(null);

  // Everything the async save pipeline reads goes through refs so a save started on one render
  // still sees the latest boxes/page when it actually runs.
  const boxesRef = useRef<Box[]>([]);
  const savedUrlsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const saveRuns = useRef(new Map<string, SaveRun>());

  // Saved crop boxes are per-page canvas overlays that goToPage wipes on navigation. Remember each
  // page's saved boxes (in natural pixels) here so returning to a page — or landing on one a whole-
  // document run just cropped — redraws its boxes. `pendingRestore` is the page a navigation asked to
  // restore, applied once that page's fitted size is known.
  const pageCache = useRef(new Map<number, SavedBoxSpec[]>());
  const pendingRestore = useRef<number | null>(null);
  // The visible page, mirrored so an async run (which can outlive a navigation) decides "is this page
  // on screen?" against where the operator actually is, not where the run started.
  const pageRef = useRef(1);

  // Questions are read straight from the query cache at write time — useUpdateQuestion writes each
  // mutation result back into that cache before mutateAsync resolves, so a save that follows another
  // save (or a card edit) of the same question always sees the post-patch record, never a stale one.
  const readQuestion = useCallback(
    (questionId: string): Question | undefined =>
      queryClient
        .getQueryData<Question[]>(questionsQueryKey(documentId))
        ?.find((q) => q.id === questionId),
    [queryClient, documentId],
  );

  // Read-modify-write PATCHes of one question must never interleave (two concurrent saves would both
  // read the same image list and the second PATCH would drop the first crop), so writes queue per
  // question. `requestSave` only serialises per BOX — this is the cross-box guard.
  const questionWrites = useRef(new Map<string, Promise<void>>());
  const enqueueQuestionWrite = (questionId: string, write: () => Promise<void>): Promise<void> => {
    const tail = questionWrites.current.get(questionId) ?? Promise.resolve();
    const run = tail.then(write);
    const settled = run.catch(() => undefined);
    questionWrites.current.set(questionId, settled);
    void settled.then(() => {
      if (questionWrites.current.get(questionId) === settled) questionWrites.current.delete(questionId);
    });
    return run;
  };

  /** The single mutation point for boxes: keeps the ref in sync so async code never reads stale state. */
  const applyBoxes = useCallback((updater: (prev: Box[]) => Box[]): void => {
    boxesRef.current = updater(boxesRef.current);
    setBoxes(boxesRef.current);
  }, []);
  /** Same ref-first discipline for the saved-URL map, read by release/reconcile handlers mid-flight. */
  const applySavedUrls = useCallback(
    (updater: (prev: ReadonlyMap<string, string>) => ReadonlyMap<string, string>): void => {
      savedUrlsRef.current = updater(savedUrlsRef.current);
      setSavedUrls(savedUrlsRef.current);
    },
    [],
  );

  // The fitted page size can change when the column resizes; keep drawn boxes aligned by rescaling
  // their (display-pixel) coordinates by the same ratio, so a crop still points at the same region.
  const sizeRef = useRef<CanvasSize | null>(null);
  const handleSize = useCallback((next: CanvasSize): void => {
    const prev = sizeRef.current;
    if (prev && prev.displayWidth > 0 && next.displayWidth > 0 &&
      (prev.displayWidth !== next.displayWidth || prev.displayHeight !== next.displayHeight)) {
      const rx = next.displayWidth / prev.displayWidth;
      const ry = next.displayHeight / prev.displayHeight;
      applyBoxes((bs) => bs.map((b) => ({ ...b, x: b.x * rx, y: b.y * ry, width: b.width * rx, height: b.height * ry })));
    }
    sizeRef.current = next;
    setSize(next);
  }, [applyBoxes]);

  const past = useRef<Box[][]>([]);
  const future = useRef<Box[][]>([]);
  const [, forceHistory] = useState(0);
  const commit = (updater: (prev: Box[]) => Box[]): void => {
    past.current = [...past.current, boxesRef.current];
    future.current = [];
    applyBoxes(updater);
    forceHistory((n) => n + 1);
  };
  // Undo/redo move region geometry only — they never attach or detach images. A saved box whose rect
  // they change is re-saved so the attached image always matches what is drawn on the page.
  const undo = (): void => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [boxesRef.current, ...future.current];
    const before = boxesRef.current;
    applyBoxes(() => prev);
    forceHistory((n) => n + 1);
    resaveChangedRects(before, prev);
  };
  const redo = (): void => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, boxesRef.current];
    const before = boxesRef.current;
    applyBoxes(() => next);
    forceHistory((n) => n + 1);
    resaveChangedRects(before, next);
  };

  const imageSrc = questionsApi.pageImageUrl(documentId, page);
  const imageSrcRef = useRef(imageSrc);
  imageSrcRef.current = imageSrc;
  pageRef.current = page;

  const onThisPage = useMemo(
    () => (questions.data ?? []).filter((q) => q.sourceRegion.page === page),
    [questions.data, page],
  );
  // The number each question DISPLAYS is the printed number read from the sheet. The list arrives
  // in PDF reading order from the API, so for the rare question without a readable number the
  // fallback is its ordinal in that full order — never a per-page array index.
  const questionNumberById = useMemo(() => {
    const map = new Map<string, number>();
    (questions.data ?? []).forEach((q, index) => map.set(q.id, q.questionNumber ?? index + 1));
    return map;
  }, [questions.data]);
  const questionById = useMemo(() => {
    const map = new Map<string, Question>();
    (questions.data ?? []).forEach((q) => map.set(q.id, q));
    return map;
  }, [questions.data]);

  // Question numbers the extractor appears to have skipped: gaps in the min..max run of the numbers it
  // read across the whole document. Surfaced so a missing question is visible instead of silently
  // absent. Suppressed for comprehension (its sub-questions collapse into one card, so their numbers
  // legitimately disappear and would read as false gaps) and for garbled numbering (a stray large
  // number that would paint the whole range as missing).
  const missingNumbers = useMemo<number[]>(() => {
    const data = questions.data ?? [];
    if (data.some((q) => q.questionType === 'comprehension')) return [];
    const present = new Set<number>();
    for (const q of data) if (q.questionNumber !== null) present.add(q.questionNumber);
    if (present.size < 2) return [];
    const nums = [...present];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max - min + 1 > present.size * 2) return [];
    const missing: number[] = [];
    for (let n = min; n <= max; n += 1) if (!present.has(n)) missing.push(n);
    return missing;
  }, [questions.data]);

  // Scroll to + briefly ring the question card a pending crop was mapped to, so the operator can
  // confirm by eye which extracted question the picture belongs to.
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusQuestion = (questionId: string): void => {
    cardRefs.current.get(questionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(questionId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => { setHighlightId(null); }, 1800);
  };
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // Briefly ring a canvas box so an "Edit crop" click that re-selected an already-present box is
  // acknowledged (the box was invisible in a wall of similar regions otherwise).
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashBox = (id: string): void => {
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => { setFlashId(null); }, 1400);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  /** Snapshot the current page's saved boxes (natural pixels) so navigating back to it redraws them. */
  const cacheCurrentPage = (pageNumber: number): void => {
    const s = sizeRef.current;
    if (!s || s.displayWidth === 0) return;
    const specs = boxesRef.current
      .filter((b) => savedUrlsRef.current.has(b.id))
      .map((b) => boxToSpec(b, savedUrlsRef.current.get(b.id) as string, s));
    pageCache.current.set(pageNumber, specs);
  };

  const goToPage = (next: number): void => {
    cacheCurrentPage(page);
    applyBoxes(() => []);
    past.current = [];
    future.current = [];
    applySavedUrls(() => new Map());
    setFailed(new Set());
    setDrawTarget(null);
    setAiResult(null);
    setAiError(null);
    pendingRestore.current = next;
    setPage(next);
    // Land on the first question of the new page, not wherever the previous page was scrolled to.
    // rAF so the scroll runs after the new page's cards have rendered.
    requestAnimationFrame(() => { panelRef.current?.scrollTo({ top: 0 }); });
  };

  // A bank search opens the workspace on the focused question's source page; once its card renders,
  // scroll to and briefly ring it so the operator sees exactly which question they came to fix. If
  // its page somehow differs from where we opened, navigate there first. Runs once.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!focusQuestionId || focusedOnce.current) return;
    const target = (questions.data ?? []).find((q) => q.id === focusQuestionId);
    if (!target) return;
    if (target.sourceRegion.page !== pageRef.current) {
      goToPage(target.sourceRegion.page);
      return;
    }
    focusedOnce.current = true;
    focusQuestion(focusQuestionId);
  }, [focusQuestionId, questions.data, page]);

  const markBusy = (id: string, on: boolean): void => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /** Remove one attached crop url from a question (the raw write — callers run it on the queue). */
  const detachUrl = async (box: Box, url: string): Promise<void> => {
    const question = readQuestion(box.questionId);
    if (!question) return;
    const imageCrops = question.imageCrops.filter((c) => c.url !== url);
    if (box.type === 'question') {
      const urls = splitUrls(question.questionImage);
      if (!urls.includes(url)) return;
      const kept = urls.filter((u) => u !== url);
      await patchQuestion({
        id: question.id,
        patch: { questionImage: kept.length > 0 ? kept.join(',') : null, imageCrops },
      });
    } else if ((question.optionImages[box.optionIndex] ?? '') === url) {
      const optionImages = [...question.optionImages];
      optionImages[box.optionIndex] = '';
      await patchQuestion({ id: question.id, patch: { optionImages, imageCrops } });
    }
  };

  /**
   * Attach an uploaded crop to its question — runs on the question's write queue. Re-checks that the
   * box still exists (right-click delete is the undo path and may land while the upload or the PATCH
   * itself is in flight): a deleted box's crop is never attached, and one deleted mid-PATCH is
   * detached straight back off.
   */
  const attachCrop = async (box: Box, url: string, natural: BoxRect): Promise<void> => {
    if (!boxesRef.current.some((b) => b.id === box.id)) return;
    const question = readQuestion(box.questionId);
    if (!question) return;
    const previousUrl = savedUrlsRef.current.get(box.id);
    // Persist the crop rect (natural pixels) alongside its url so the box reappears on any device.
    const imageCrops = upsertCrop(
      question.imageCrops,
      { url, type: box.type, optionIndex: box.optionIndex, nx: natural.x, ny: natural.y, nw: natural.width, nh: natural.height },
      previousUrl,
    );
    if (box.type === 'question') {
      const urls = splitUrls(question.questionImage);
      const at = previousUrl ? urls.indexOf(previousUrl) : -1;
      if (at >= 0) urls[at] = url;
      else urls.push(url);
      await patchQuestion({
        id: question.id,
        patch: { isQuestionImage: true, questionImage: urls.join(','), imageCrops },
      });
    } else {
      const optionImages = [...question.optionImages];
      while (optionImages.length <= box.optionIndex) optionImages.push('');
      optionImages[box.optionIndex] = url;
      await patchQuestion({ id: question.id, patch: { isOptionImage: true, optionImages, imageCrops } });
    }
    if (!boxesRef.current.some((b) => b.id === box.id)) {
      await detachUrl(box, url);
      return;
    }
    applySavedUrls((prev) => new Map(prev).set(box.id, url));
  };

  // --- The auto-save pipeline: crop the box's current rect, upload, attach, remember the URL. ---
  // Reads everything through refs at execution time, so a queued save always crops the latest rect.
  const saveBoxOnce = async (boxId: string): Promise<void> => {
    const box = boxesRef.current.find((b) => b.id === boxId);
    const pageSize = sizeRef.current;
    if (!box || !readQuestion(box.questionId) || !pageSize || pageSize.displayWidth === 0) return;
    setError(null);
    setFailed((prev) => {
      if (!prev.has(boxId)) return prev;
      const next = new Set(prev);
      next.delete(boxId);
      return next;
    });
    markBusy(boxId, true);
    try {
      const scaleX = pageSize.naturalWidth / pageSize.displayWidth;
      const scaleY = pageSize.naturalHeight / pageSize.displayHeight;
      const natural: BoxRect = {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      };
      const blob = await getCroppedBlob(imageSrcRef.current, natural);
      // Fresh storage key per save: the store upserts by key and serves cached URLs, so re-using a
      // key on re-crop would keep the stale image visible everywhere. A new key = a new URL.
      const { url } = await questionsApi.uploadImage(box.questionId, `${boxId}_${String(Date.now())}`, blob);
      await enqueueQuestionWrite(box.questionId, () => attachCrop(box, url, natural));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setFailed((prev) => new Set(prev).add(boxId));
    } finally {
      markBusy(boxId, false);
    }
  };

  // While the whole-document run is in flight every crop/confirm save is paused: a save landing
  // mid-run would be clobbered by the run's own patches (and vice versa).
  const runActive = allProgress !== null;
  /** Async-safe mirror of `runActive`, set by detectAllPages itself so mid-run saves block immediately. */
  const runActiveRef = useRef(false);

  /**
   * Save a box, serialised per box: at most one upload in flight, and adjustments made while one is
   * running coalesce into a single follow-up save of the final rect (the "debounce on release").
   */
  const requestSave = (boxId: string): Promise<void> => {
    if (runActiveRef.current) return Promise.resolve();
    const running = saveRuns.current.get(boxId);
    if (running) {
      running.again = true;
      return running.done;
    }
    const run: SaveRun = { again: false, done: Promise.resolve() };
    saveRuns.current.set(boxId, run);
    run.done = (async () => {
      try {
        do {
          run.again = false;
          await saveBoxOnce(boxId);
          // Read `again` back through the map: a release during the upload set it on this object.
        } while (saveRuns.current.get(boxId)?.again ?? false);
      } finally {
        saveRuns.current.delete(boxId);
      }
    })();
    return run.done;
  };

  const resaveChangedRects = (before: Box[], after: Box[]): void => {
    const beforeById = new Map(before.map((b) => [b.id, b]));
    for (const box of after) {
      if (!savedUrlsRef.current.has(box.id)) continue;
      const was = beforeById.get(box.id);
      if (was && (was.x !== box.x || was.y !== box.y || was.width !== box.width || was.height !== box.height)) {
        void requestSave(box.id);
      }
    }
  };

  /** Detach a saved box's image from its question — the undo half of "right-click removes the box". */
  const detachSaved = async (box: Box, url: string): Promise<void> => {
    try {
      await enqueueQuestionWrite(box.questionId, () => detachUrl(box, url));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const updateBox = (id: string, rect: Partial<BoxRect>): void => {
    applyBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...rect } : b)));
  };
  const deleteBox = (id: string): void => {
    const box = boxesRef.current.find((b) => b.id === id);
    const url = savedUrlsRef.current.get(id);
    commit((prev) => prev.filter((b) => b.id !== id));
    if (box && url) {
      applySavedUrls((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      void detachSaved(box, url);
    }
  };

  // When set, the next drawn crop REPLACES this already-attached image url in place rather than
  // appending a new one — the "Edit crop" fallback used when no box/spec survives to reopen.
  const replaceUrl = useRef<string | null>(null);

  /**
   * Bring a saved crop back onto the canvas as an adjustable box so the operator can move/resize it
   * (it re-saves on release). Three cases, best first:
   *  1. Its box is still on the current page's canvas — just ring it; it is already adjustable.
   *  2. A natural-pixel spec for it is remembered (this session) — restore the exact rect, navigating
   *     to its page first if it lives on another one.
   *  3. Nothing survives (e.g. after a reload) — arm a re-draw that REPLACES this exact image url.
   */
  const editCrop = (
    questionId: string,
    type: 'question' | 'option',
    optionIndex: number,
    url: string,
  ): void => {
    const onCanvas = boxesRef.current.find((b) => savedUrlsRef.current.get(b.id) === url);
    if (onCanvas) {
      flashBox(onCanvas.id);
      return;
    }
    for (const [pageNumber, specs] of pageCache.current) {
      const spec = specs.find((s) => s.url === url);
      if (!spec) continue;
      if (pageNumber === page) {
        if (size && size.displayWidth > 0) {
          const box = specToBox(spec, size);
          applyBoxes((prev) => [...prev, box]);
          applySavedUrls((prev) => new Map(prev).set(spec.id, spec.url));
          flashBox(box.id);
        }
      } else {
        // goToPage restores every cached spec for the target page (this one included) once it fits.
        goToPage(pageNumber);
      }
      return;
    }
    // No box, no spec: arm a fresh draw whose crop replaces this url in place.
    replaceUrl.current = url;
    setDrawTarget({ questionId, type, optionIndex });
  };

  // --- Draw-to-save (manual flow): arm a target from its card, rubber-band draw, auto-save. ---
  const toggleDrawTarget = (question: Question, type: 'question' | 'option', optionIndex = 0): void => {
    replaceUrl.current = null;
    cancelCropRequest(); // a box draw and a field crop can't be armed together
    setDrawTarget((prev) =>
      prev && prev.questionId === question.id && prev.type === type && prev.optionIndex === optionIndex
        ? null
        : { questionId: question.id, type, optionIndex },
    );
  };
  const handleDraw = (rect: BoxRect): void => {
    if (!drawTarget) return;
    const question = questionById.get(drawTarget.questionId);
    if (!question) return;
    const number = questionNumberById.get(question.id);
    const id = `${question.id}_${drawTarget.type}_${String(drawTarget.optionIndex)}_${String(Date.now())}`;
    commit((prev) => [
      ...prev,
      {
        id,
        questionId: question.id,
        type: drawTarget.type,
        optionIndex: drawTarget.optionIndex,
        source: 'manual',
        label: `Q${String(number ?? '?')}${drawTarget.type === 'option' ? ` · option ${String(drawTarget.optionIndex + 1)}` : ''}`,
        ...rect,
      },
    ]);
    // Seed the box's saved-url so the save REPLACES the edited image in place (attachCrop keys the
    // replacement off the box's previous url) instead of attaching a second figure.
    const replacing = replaceUrl.current;
    replaceUrl.current = null;
    if (replacing !== null) applySavedUrls((prev) => new Map(prev).set(id, replacing));
    setDrawTarget(null);
    void requestSave(id);
  };
  const drawLabel = useMemo(() => {
    if (!drawTarget) return null;
    const number = questionNumberById.get(drawTarget.questionId);
    const base = `Q${String(number ?? '?')}`;
    return drawTarget.type === 'option' ? `${base} · option ${String(drawTarget.optionIndex + 1)}` : `${base} figure`;
  }, [drawTarget, questionNumberById]);

  // Esc cancels an armed draw without touching anything else.
  useEffect(() => {
    if (!drawTarget) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawTarget(null);
    };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); };
  }, [drawTarget]);

  // --- One-shot field crops (explanation image, match-the-column entry image). ---
  // A card asks for a crop; the workspace arms a rubber-band on the right source page (the question
  // canvas, or the solution preview pane) and resolves with the uploaded image URL once the operator
  // draws — reusing the crop + upload primitives without touching the editable-box pipeline, since
  // these destinations are plain URL fields rather than canvas boxes.
  const clearCropRequest = (): void => {
    cropRequestRef.current = null;
    setCropRequest(null);
  };
  const cancelCropRequest = (): void => {
    cropRequestRef.current?.resolve(null);
    clearCropRequest();
  };
  const requestCrop = useCallback(
    (questionId: string, source: 'question' | 'solution'): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        cropRequestRef.current?.resolve(null); // supersede any prior pending request
        setDrawTarget(null); // the editable-box draw and a field crop can't be armed at once
        replaceUrl.current = null;
        if (source === 'solution') setViewMode('solution'); // reveal the solution pane to crop from
        const req: CropRequest = { questionId, source, resolve };
        cropRequestRef.current = req;
        setCropRequest(req);
      }),
    [],
  );
  // Crop `imageUrl` at `natural` (natural px), upload it against the pending request's question, and
  // resolve the request with the new URL. Any failure resolves null so the caller's button just resets.
  const fulfilCrop = async (imageUrl: string, natural: BoxRect): Promise<void> => {
    const req = cropRequestRef.current;
    if (!req) return;
    clearCropRequest();
    try {
      const blob = await getCroppedBlob(imageUrl, natural);
      const { url } = await questionsApi.uploadImage(req.questionId, `crop_${String(Date.now())}`, blob);
      req.resolve(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      req.resolve(null);
    }
  };
  // The main canvas' draw handler serves a pending question-source crop first, else the box pipeline.
  // (A solution-source request is fulfilled from the preview pane, so it falls through to handleDraw
  // here — but handleDraw no-ops without a drawTarget, and none is armed while a crop request is.)
  const handleCanvasDraw = (rect: BoxRect): void => {
    const req = cropRequestRef.current;
    if (req && req.source === 'question') {
      const pageSize = sizeRef.current;
      if (!pageSize || pageSize.displayWidth === 0) { cancelCropRequest(); return; }
      const scaleX = pageSize.naturalWidth / pageSize.displayWidth;
      const scaleY = pageSize.naturalHeight / pageSize.displayHeight;
      void fulfilCrop(imageSrcRef.current, {
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      });
      return;
    }
    handleDraw(rect);
  };

  // Esc also cancels a pending field crop.
  useEffect(() => {
    if (!cropRequest) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelCropRequest();
    };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); };
  }, [cropRequest]);

  // --- Adjust-to-resave: one history entry per grab, one (coalesced) save per release. ---
  const grabbed = useRef<Box[] | null>(null);
  const handleBoxGrab = (id: string): void => {
    grabbed.current = boxesRef.current;
    setActiveBoxId(id);
  };
  const handleBoxRelease = (id: string, moved: boolean): void => {
    setActiveBoxId(null);
    if (moved && grabbed.current) {
      past.current = [...past.current, grabbed.current];
      future.current = [];
      forceHistory((n) => n + 1);
    }
    grabbed.current = null;
    if (!moved) return;
    // Saved boxes re-crop on release; a box whose save failed (or is mid-flight) retries the same way
    // — this now covers AI boxes too, since they auto-save on detection instead of waiting for Confirm.
    if (savedUrlsRef.current.has(id) || failed.has(id) || saveRuns.current.has(id)) {
      void requestSave(id);
    }
  };

  // A saved image removed from its card (Remove under the thumbnail) orphans its box on the canvas —
  // drop such boxes so the page never shows a "saved" region whose crop is no longer attached.
  useEffect(() => {
    const data = questions.data;
    if (!data) return;
    const byId = new Map(data.map((q) => [q.id, q]));
    const stillAttached = (box: Box): boolean => {
      const url = savedUrlsRef.current.get(box.id);
      if (!url || saveRuns.current.has(box.id)) return true;
      const question = byId.get(box.questionId);
      if (!question) return false;
      return box.type === 'question'
        ? splitUrls(question.questionImage).includes(url)
        : (question.optionImages[box.optionIndex] ?? '') === url;
    };
    if (boxesRef.current.some((b) => !stillAttached(b))) {
      applyBoxes((prev) => prev.filter(stillAttached));
    }
  }, [questions.data, applyBoxes]);

  // Seed each page's saved-box cache from the crops persisted on its questions, so every saved crop
  // returns as an adjustable box on first load / a fresh device — not just a flat thumbnail. Runs once
  // the questions arrive; dedupes against specs already cached this session (url + type + option), then
  // asks the restore effect below to redraw the page currently on screen (nothing else is drawn yet on
  // first load). Other pages redraw when navigation lands on them via `goToPage`.
  const seededPersisted = useRef(false);
  const [restoreTick, setRestoreTick] = useState(0);
  useEffect(() => {
    const data = questions.data;
    if (seededPersisted.current || !data || data.length === 0) return;
    seededPersisted.current = true;
    data.forEach((question, index) => {
      const specs = cropsToSpecs(question, question.questionNumber ?? index + 1);
      if (specs.length === 0) return;
      const pageNumber = question.sourceRegion.page;
      const existing = pageCache.current.get(pageNumber) ?? [];
      const seen = new Set(existing.map(cropKey));
      const added = specs.filter((spec) => !seen.has(cropKey(spec)));
      if (added.length > 0) pageCache.current.set(pageNumber, [...existing, ...added]);
    });
    pendingRestore.current = pageRef.current;
    setRestoreTick((n) => n + 1);
  }, [questions.data]);

  // Redraw a page's cached saved boxes when navigation (or the seed above) lands on it — once the
  // fitted size is known so the natural-pixel specs map to the right display region. Only fires for the
  // page a navigation asked to restore, so it never clobbers live work on a page already being edited.
  useEffect(() => {
    if (pendingRestore.current !== page) return;
    if (!size || size.displayWidth === 0 || size.naturalWidth === 0) return;
    pendingRestore.current = null;
    const specs = pageCache.current.get(page) ?? [];
    if (specs.length === 0) return;
    applyBoxes(() => specs.map((spec) => specToBox(spec, size)));
    applySavedUrls(() => new Map(specs.map((spec) => [spec.id, spec.url])));
  }, [page, size, restoreTick, applyBoxes, applySavedUrls]);

  // --- AI detection: detect the current page's figures and attach each one immediately. ---
  // Same contract as the all-pages run — no confirm step; every suggestion is cropped, uploaded and
  // attached the moment it is placed, then stays as an editable (draggable/resizable) box.
  const detectCurrentPage = useCallback(async (): Promise<void> => {
    if (!size || size.displayWidth === 0) {
      setAiError('The page is still loading — try again in a moment.');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiResult(null);
    try {
      const { imageWidth, imageHeight, figures } = await questionsApi.detectFigures(documentId, page);
      const sx = size.displayWidth / imageWidth;
      const sy = size.displayHeight / imageHeight;
      let skipped = 0;
      const placed: Box[] = [];
      figures.forEach((figure, index) => {
        const question = questionById.get(figure.questionId);
        if (question && targetHasImage(question, figure.target, figure.optionIndex)) {
          skipped += 1;
          return;
        }
        const [x, y, w, h] = figure.bbox;
        placed.push({
          id: `${figure.questionId}_ai_${String(page)}_${String(index)}`,
          questionId: figure.questionId,
          type: figure.target,
          optionIndex: figure.optionIndex,
          source: 'ai',
          snippet: figure.snippet,
          label: `AI · Q${String(questionNumberById.get(figure.questionId) ?? '?')}${figure.target === 'option' ? ` · option ${String(figure.optionIndex + 1)}` : ''}`,
          x: x * sx,
          y: y * sy,
          width: w * sx,
          height: h * sy,
        });
      });
      // Replace any earlier unsaved AI suggestions on this page; saved + manual boxes stay.
      commit((prev) => [...prev.filter((b) => b.source !== 'ai' || savedUrlsRef.current.has(b.id)), ...placed]);
      setAiResult({ detected: figures.length, placed: placed.length, skipped });
      // Auto-save every fresh suggestion right away — no confirm step, exactly like the all-pages run.
      // `commit` updated boxesRef synchronously above, so each save crops the box just placed; a box
      // whose save fails stays on the page and can be retried by nudging it (or from the retry list).
      for (const box of placed) void requestSave(box.id);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiBusy(false);
    }
    // commit/questionNumberById are stable enough; guarded single-run via effect below for autoRun.
  }, [documentId, page, size, questionById, questionNumberById]);

  // --- Whole-document detection (detect + attach across ALL pages in one run). ---
  /**
   * Detect figures on every page that has extracted questions (chunked to the contract's page cap),
   * then crop, upload, and attach every suggestion in one shot — skipping targets that already carry
   * an image. Detection failures are partial, never fatal: a failed page (or a whole failed chunk)
   * is only counted into the summary while every successfully detected figure still gets applied —
   * the vision tokens for those pages are already spent. The apply patches are built from a fresh
   * read of the questions (not the snapshot captured when the run started), and saves are grouped
   * per question so one patch carries all of its new images; patches built from stale data would
   * clobber one another's optionImages. Afterwards the operator only reviews and touches up,
   * instead of driving the document page by page.
   */
  const detectAllPages = useCallback(async (): Promise<void> => {
    const pagesWithQuestions = [
      ...new Set((questions.data ?? []).map((q) => q.sourceRegion.page)),
    ].sort((a, b) => a - b);
    if (pagesWithQuestions.length === 0 || runActiveRef.current) return;
    runActiveRef.current = true;
    setAiError(null);
    setAiResult(null);
    setAllSummary(null);
    setAllProgress({ phase: 'detect', done: 0, total: pagesWithQuestions.length });
    try {
      const detected: { page: number; figure: DetectedFigure }[] = [];
      const failedPages = new Set<number>();
      let firstFailure: string | null = null;
      for (let start = 0; start < pagesWithQuestions.length; start += DETECT_FIGURES_MAX_PAGES) {
        const chunk = pagesWithQuestions.slice(start, start + DETECT_FIGURES_MAX_PAGES);
        try {
          const { pages: results } = await questionsApi.detectFiguresBatch(documentId, chunk);
          for (const result of results) {
            if (!result.ok) {
              failedPages.add(result.page);
              firstFailure ??= result.error;
              continue;
            }
            for (const figure of result.figures) detected.push({ page: result.page, figure });
          }
        } catch (caught) {
          // One chunk's request failing must not discard the other chunks' detections.
          for (const failedPage of chunk) failedPages.add(failedPage);
          firstFailure ??= caught instanceof Error ? caught.message : String(caught);
        }
        setAllProgress({
          phase: 'detect',
          done: Math.min(start + chunk.length, pagesWithQuestions.length),
          total: pagesWithQuestions.length,
        });
      }

      // Re-read the questions before building patches: detection can take minutes and a patch built
      // from the run-start snapshot would silently erase anything saved in the meantime.
      const freshQuestions = await questionsApi.listByDocument(documentId);
      const freshById = new Map(freshQuestions.map((q) => [q.id, q]));

      let skipped = 0;
      const byQuestion = new Map<string, { page: number; figure: DetectedFigure }[]>();
      for (const entry of detected) {
        const question = freshById.get(entry.figure.questionId);
        if (!question) continue;
        if (targetHasImage(question, entry.figure.target, entry.figure.optionIndex)) {
          skipped += 1;
          continue;
        }
        const group = byQuestion.get(question.id) ?? [];
        group.push(entry);
        byQuestion.set(question.id, group);
      }

      const total = [...byQuestion.values()].reduce((n, group) => n + group.length, 0);
      let done = 0;
      let attached = 0;
      let failed = 0;
      const touchedPages = new Set<number>();
      // Saved-box specs (natural pixels) for every attached figure, grouped by the page it sits on, so
      // navigation can redraw the boxes this run cropped. Only committed once a question's patch lands.
      const cachedByPage = new Map<number, SavedBoxSpec[]>();
      let specSeq = 0;
      setAllProgress({ phase: 'apply', done, total });
      for (const [questionId, group] of byQuestion) {
        const question = freshById.get(questionId);
        if (!question) continue;
        const stemUrls = splitUrls(question.questionImage);
        const optionImages = [...question.optionImages];
        let touchedStem = false;
        let touchedOption = false;
        let attachedHere = 0;
        const pagesHere = new Set<number>();
        const specsHere: { sourcePage: number; spec: SavedBoxSpec }[] = [];
        for (const { page: sourcePage, figure } of group) {
          try {
            const [x, y, w, h] = figure.bbox;
            const blob = await getCroppedBlob(questionsApi.pageImageUrl(documentId, sourcePage), {
              x, y, width: w, height: h,
            });
            const name = `${questionId}_${figure.target}_${String(figure.optionIndex)}_${String(Date.now())}`;
            const { url } = await questionsApi.uploadImage(questionId, name, blob);
            if (figure.target === 'question') {
              stemUrls.push(url);
              touchedStem = true;
            } else {
              while (optionImages.length <= figure.optionIndex) optionImages.push('');
              optionImages[figure.optionIndex] = url;
              touchedOption = true;
            }
            specsHere.push({
              sourcePage,
              spec: {
                id: `all_${questionId}_${figure.target}_${String(figure.optionIndex)}_${String(specSeq++)}`,
                questionId,
                type: figure.target,
                optionIndex: figure.optionIndex,
                label: `Q${String(questionNumberById.get(questionId) ?? '?')}${figure.target === 'option' ? ` · option ${String(figure.optionIndex + 1)}` : ''}`,
                source: 'ai',
                snippet: figure.snippet,
                nx: x,
                ny: y,
                nw: w,
                nh: h,
                url,
              },
            });
            attachedHere += 1;
            pagesHere.add(sourcePage);
          } catch (caught) {
            failed += 1;
            firstFailure ??= caught instanceof Error ? caught.message : String(caught);
          }
          done += 1;
          setAllProgress({ phase: 'apply', done, total });
        }
        if (attachedHere === 0) continue;
        try {
          await enqueueQuestionWrite(questionId, async () => {
            await patchQuestion({
              id: questionId,
              patch: {
                ...(touchedStem ? { isQuestionImage: true, questionImage: stemUrls.join(',') } : {}),
                ...(touchedOption ? { isOptionImage: true, optionImages } : {}),
                imageCrops: [...question.imageCrops, ...specsHere.map(({ spec }) => specToCrop(spec))],
              },
            });
          });
          attached += attachedHere;
          for (const touched of pagesHere) touchedPages.add(touched);
          // Patch landed — the crops are attached, so their boxes can now be redrawn per page.
          for (const { sourcePage, spec } of specsHere) {
            const list = cachedByPage.get(sourcePage) ?? [];
            list.push(spec);
            cachedByPage.set(sourcePage, list);
          }
        } catch (caught) {
          failed += attachedHere;
          firstFailure ??= caught instanceof Error ? caught.message : String(caught);
        }
      }

      // Stash each page's new boxes for restore-on-navigation; the current page gets them live now so
      // the run's result is visible on the canvas without leaving and coming back.
      const currentSize = sizeRef.current;
      for (const [pg, specs] of cachedByPage) {
        if (pg === pageRef.current && currentSize && currentSize.displayWidth > 0) {
          applyBoxes((prev) => [...prev, ...specs.map((spec) => specToBox(spec, currentSize))]);
          applySavedUrls((prev) => {
            const nextMap = new Map(prev);
            for (const spec of specs) nextMap.set(spec.id, spec.url);
            return nextMap;
          });
        } else {
          const existing = pageCache.current.get(pg) ?? [];
          pageCache.current.set(pg, [...existing, ...specs]);
        }
      }

      setAllSummary({ attached, skipped, pages: touchedPages.size, failed, failedPages: failedPages.size });
      setError(firstFailure);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      runActiveRef.current = false;
      setAllProgress(null);
    }
  }, [documentId, questions.data, patchQuestion, questionNumberById, applyBoxes, applySavedUrls]);

  // Auto-detect once on arrival when the session pushed us here with ?auto=1 (still only marks).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoRun && !autoStarted.current && size && questions.isSuccess && questions.data.length > 0) {
      autoStarted.current = true;
      void detectCurrentPage();
    }
  }, [autoRun, size, questions.isSuccess, questions.data, detectCurrentPage]);

  // AI boxes auto-save the moment they are detected (see detectCurrentPage). `pendingAi` is any AI box
  // not yet saved — normally just briefly, while its save is in flight; `aiRetry` narrows that to ones
  // whose save actually FAILED, which is all the review panel surfaces now (a retry, not a confirm).
  const pendingAi = boxes.filter((b) => b.source === 'ai' && !savedUrls.has(b.id));
  const aiRetry = pendingAi.filter((b) => failed.has(b.id));
  const retryBox = (boxId: string): void => { void requestSave(boxId); };
  const retryAll = async (): Promise<void> => {
    if (runActive) return;
    // Saves of the same question are serialised on its write queue and each one re-reads the fresh
    // record, so several crops into one question can never clobber one another's option/stem image.
    for (const box of aiRetry) {
      await requestSave(box.id);
    }
  };
  const dismissFailed = (): void => {
    commit((prev) => prev.filter((b) => b.source !== 'ai' || savedUrlsRef.current.has(b.id) || !failed.has(b.id)));
  };

  const canvasBoxes: CanvasBox[] = boxes.map((b) => ({
    id: b.id,
    label: b.label,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    variant: savedUrls.has(b.id) ? 'saved' : b.source,
    busy: busy.has(b.id),
    flash: flashId === b.id,
  }));
  // What the magnifier zooms into: a crop being drawn takes priority, else the box being adjusted.
  const magnifierBox: BoxRect | null =
    drawPreview ?? (activeBoxId ? boxes.find((b) => b.id === activeBoxId) ?? null : null);
  // The main canvas is armed either for a box draw (drawLabel) or for a question-source field crop.
  const cropDrawLabel =
    cropRequest && cropRequest.source === 'question'
      ? `Crop image · Q${String(questionNumberById.get(cropRequest.questionId) ?? '?')}`
      : null;
  const activeDrawLabel = drawLabel ?? cropDrawLabel;
  // Cards list only the not-yet-saved manual regions (saving or needing a retry); a saved region's
  // presence in the card is its attached image, and adjustments happen on the canvas box itself.
  const cardBoxesFor = (questionId: string): CardBox[] =>
    boxes
      .filter((b) => b.questionId === questionId && b.source === 'manual' && !savedUrls.has(b.id))
      .map((b) => ({ id: b.id, type: b.type, optionIndex: b.optionIndex, label: b.label, saving: busy.has(b.id) }));
  const cardDrawTargetFor = (questionId: string): CardDrawTarget | null =>
    drawTarget && drawTarget.questionId === questionId
      ? { type: drawTarget.type, optionIndex: drawTarget.optionIndex }
      : null;

  if (questions.isPending) {
    return (
      <div className="card">
        <LoadingState label="Loading questions…" />
      </div>
    );
  }
  if (questions.isError) {
    return (
      <div className="card">
        <p className="error">Could not load questions.</p>
      </div>
    );
  }
  if (questions.data.length === 0) {
    return (
      <EmptyState
        icon={<IconFileText />}
        title="No questions extracted yet"
        body="Run extraction on this document from its session, then come back to verify."
      />
    );
  }

  const totalPages = pageCount.data ?? 1;

  return (
    <div className="verify" style={{ '--verify-panel-w': `${String(panelWidth)}px` } as CSSProperties}>
      <div className="verify__canvas">
        <div className="verify__rail" role="toolbar" aria-label="Source page tools">
          <div className="verify__rail-group">
            <IconButton
              icon={<IconChevronLeft />}
              label="Previous page"
              disabled={page <= 1}
              onClick={() => { goToPage(page - 1); }}
            />
            <span className="verify__rail-count">
              {page}<br />/ {totalPages}
            </span>
            <IconButton
              icon={<IconChevronRight />}
              label="Next page"
              disabled={page >= totalPages}
              onClick={() => { goToPage(page + 1); }}
            />
          </div>

          <span className="verify__rail-divider" aria-hidden="true" />

          <div className="verify__rail-group">
            <IconButton icon={<IconUndo />} label="Undo" disabled={past.current.length === 0} onClick={undo} />
            <IconButton icon={<IconRedo />} label="Redo" disabled={future.current.length === 0} onClick={redo} />
            <IconButton
              icon={<IconTrash />}
              label="Remove every box on this page (saved crops stay attached)"
              disabled={boxes.length === 0}
              onClick={() => { commit(() => []); }}
            />
          </div>

          <span className="verify__rail-divider" aria-hidden="true" />

          <div className="verify__rail-group">
            <IconButton
              icon={aiBusy ? <Spinner /> : <IconSparkle />}
              label="Auto-detect figures on this page"
              disabled={aiBusy || allProgress !== null || !size}
              onClick={() => { void detectCurrentPage(); }}
            />
            <IconButton
              icon={allProgress ? <Spinner /> : <IconLayers />}
              label="Detect figures across all pages"
              disabled={aiBusy || allProgress !== null}
              onClick={() => { void detectAllPages(); }}
            />
          </div>

          <span className="verify__rail-spacer" />

          <ToolbarHelp>
            <b>Add region</b> on a question, then draw — the crop uploads and attaches by itself.
            <b> Drag</b> a box or its <b>handles</b> to adjust; a saved (green) box re-saves on
            release. <b>Right-click</b> removes a box — a saved box&rsquo;s image is detached too.
            <b> Auto-detect</b> finds figures on this page and attaches each one automatically —
            adjust or remove any box afterwards, just like a manual crop.
            <b> Detect all pages</b> detects and attaches figures across the whole document in one
            run, skipping targets that already have an image — review the cards afterwards.
          </ToolbarHelp>
        </div>

        <div className="verify__stage">
          <CropCanvas
            imageSrc={imageSrc}
            boxes={canvasBoxes}
            onUpdateBox={updateBox}
            onDeleteBox={deleteBox}
            onSize={handleSize}
            draw={activeDrawLabel !== null ? { label: activeDrawLabel } : null}
            onDraw={handleCanvasDraw}
            onDrawProgress={setDrawPreview}
            onDrawCancel={() => { setDrawTarget(null); cancelCropRequest(); }}
            onBoxGrab={handleBoxGrab}
            onBoxRelease={handleBoxRelease}
          />
        </div>

        {viewMode !== 'question' && sources.answer ? (
          <SourcePreviewPane
            title="Answer"
            tone="answer"
            documentId={sources.answer.document.id}
            fileName={sources.answer.document.fileName}
            defaultPage={sources.answer.defaultPage}
          />
        ) : null}
        {viewMode === 'solution' && sources.solution ? (
          <SourcePreviewPane
            title="Solution"
            tone="solution"
            documentId={sources.solution.document.id}
            fileName={sources.solution.document.fileName}
            defaultPage={sources.solution.defaultPage}
            crop={{
              armed: cropRequest?.source === 'solution',
              onCrop: (imageUrl, natural) => { void fulfilCrop(imageUrl, natural); },
              onCancel: cancelCropRequest,
            }}
          />
        ) : null}
      </div>

      <div
        className="verify__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the source page and question panel"
        title="Drag to resize · double-click to reset"
        onMouseDown={onPanelResizeStart}
        onDoubleClick={() => { setPanel(DEFAULT_PANEL); writeVerifyPanelWidth(DEFAULT_PANEL); }}
      >
        <span className="verify__grip" aria-hidden="true" />
      </div>

      <div className="verify__panel" ref={panelRef}>
        <div className="verify__pinned">
          <div className="verify__session">
            {sessionBar ? <div className="verify__session-row">{sessionBar}</div> : null}
            <div className="verify__session-row" hidden={viewModes.length <= 1}>
              <span className="text-sm text-ink-2">View</span>
              <div className="segmented ml-auto" role="tablist" aria-label="Source view">
                {viewModes.map((option) => {
                  const missing =
                    (option.needs === 'answer' && !sources.answer) ||
                    (option.needs === 'solution' && !sources.solution);
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === option.mode}
                      className={`segmented__item ${viewMode === option.mode ? 'is-active' : ''}`}
                      title={missing ? `No ${option.needs ?? ''} PDF attached to this unit` : undefined}
                      disabled={missing}
                      onClick={() => { setViewMode(option.mode); }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="verify__session-row">
              <span className="text-sm text-ink-2">
                {drafts.dirtyIds.size > 0
                  ? `${String(drafts.dirtyIds.size)} question(s) with unsaved edits`
                  : 'All edits saved'}
              </span>
              <Button
                size="xs"
                className="ml-auto flex-none"
                disabled={drafts.dirtyIds.size === 0 || drafts.isSaving}
                onClick={() => { void drafts.save([...drafts.dirtyIds]); }}
              >
                {drafts.isSaving
                  ? <><Spinner /> Saving…</>
                  : `Update all${drafts.dirtyIds.size > 0 ? ` (${String(drafts.dirtyIds.size)})` : ''}`}
              </Button>
            </div>
            {missingNumbers.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md bg-warn-soft p-2 text-[13px] text-warn">
                <IconWarning />
                <span>
                  {missingNumbers.length === 1 ? 'Question' : 'Questions'} possibly missing from extraction:{' '}
                  <strong>{missingNumbers.join(', ')}</strong>. Re-run extraction on this file, or add them by hand.
                </span>
              </div>
            ) : null}
          </div>
          {magnifierBox && size && size.displayWidth > 0 ? (
            <CropMagnifier imageSrc={imageSrc} box={magnifierBox} size={size} />
          ) : null}
          {/* AI crops auto-save; this panel only appears for ones whose save FAILED, pinned to the top
              so each can be retried or dismissed without hunting for it on the page. */}
          {aiRetry.length > 0 ? (
            <div className="card verify__ai-review">
              <div className="card__head">
                <h2 className="card__title">
                  {aiRetry.length} AI crop{aiRetry.length === 1 ? '' : 's'} failed to save
                </h2>
                <div className="row">
                  <Button size="xs" disabled={runActive} onClick={() => { void retryAll(); }}>
                    <IconCheck /> Retry all
                  </Button>
                  <Button variant="ghost" size="xs" onClick={dismissFailed}>
                    <IconX /> Dismiss all
                  </Button>
                </div>
              </div>
              <ul className="ai-review__list verify__ai-review-list">
                {aiRetry.map((b) => {
                  const matched = questionById.get(b.questionId);
                  const stemLine = matched ? firstLine(matched.stem) : null;
                  return (
                    <li key={b.id} className="ai-review__item">
                      <CropThumb imageSrc={imageSrc} box={b} size={size} />
                      <button
                        type="button"
                        className="ai-review__match"
                        onClick={() => { focusQuestion(b.questionId); }}
                        title="Show the matched question"
                      >
                        <span className="ai-review__label">
                          <IconSparkle />
                          Q{questionNumberById.get(b.questionId) ?? '?'}
                          {b.type === 'option' ? ` · option ${String(b.optionIndex + 1)}` : ''}
                        </span>
                        {stemLine ? <span className="ai-review__stem">{stemLine}</span> : null}
                        {b.snippet?.trim() ? (
                          <span className="ai-review__snippet">reads: “{b.snippet.trim()}”</span>
                        ) : null}
                      </button>
                      <div className="row">
                        <Button size="xs" disabled={busy.has(b.id) || runActive} onClick={() => { retryBox(b.id); }}>
                          {busy.has(b.id) ? 'Saving…' : <><IconCheck /> Retry</>}
                        </Button>
                        <IconButton
                          icon={<IconX />}
                          label="Discard this crop"
                          size="sm"
                          onClick={() => { deleteBox(b.id); }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        {aiError ? <p className="error">{aiError}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {allProgress ? (
          <p className="note">
            <Spinner />{' '}
            {allProgress.phase === 'detect'
              ? `Detecting figures — ${String(allProgress.done)}/${String(allProgress.total)} pages…`
              : `Attaching crops — ${String(allProgress.done)}/${String(allProgress.total)} figures…`}
          </p>
        ) : null}
        {!allProgress && allSummary ? <p className="note">{allPagesSummaryText(allSummary)}</p> : null}
        {!aiBusy && pendingAi.length === 0 && aiResult ? (
          <p className="note">
            {aiResult.placed === 0 && aiResult.detected === 0
              ? 'No figures detected on this page.'
              : aiResult.skipped > 0
                ? `Detected ${String(aiResult.detected)} figure(s); ${String(aiResult.skipped)} already have an image and were skipped.`
                : `Detected ${String(aiResult.detected)} figure(s).`}
          </p>
        ) : null}

        {onThisPage.length === 0 ? (
          <EmptyState
            icon={<IconFileText />}
            title="No questions on this page"
            body="Use the page arrows above the source page to move to a page with extracted questions."
          />
        ) : (
          onThisPage.map((question, index) => (
            <div
              key={question.id}
              ref={(el) => {
                if (el) cardRefs.current.set(question.id, el);
                else cardRefs.current.delete(question.id);
              }}
              className={highlightId === question.id ? 'q-card-wrap is-highlighted' : 'q-card-wrap'}
            >
              <EditableQuestionCard
                question={question}
                number={questionNumberById.get(question.id) ?? index + 1}
                draft={drafts.draftFor(question)}
                dirty={drafts.dirtyIds.has(question.id)}
                saving={drafts.savingIds.has(question.id)}
                boxes={cardBoxesFor(question.id)}
                drawTarget={cardDrawTargetFor(question.id)}
                cropDisabled={runActive}
                answerSource={answerSource}
                solutionSource={solutionSource}
                onDraftUpdate={(updater) => { drafts.updateDraft(question.id, updater); }}
                onSave={() => { void drafts.save([question.id]); }}
                onRequestCrop={requestCrop}
                onDrawRegion={toggleDrawTarget}
                onSaveBox={(boxId) => { void requestSave(boxId); }}
                onDeleteBox={deleteBox}
                onEditCrop={(type, optionIndex, url) => { editCrop(question.id, type, optionIndex, url); }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
