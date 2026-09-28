import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DetectFiguresSource, DetectedFigure, ImageCrop, Question, QuestionListResponse, ReExtractedGroup, ReExtractSource } from '@ingest/contracts';
import { DETECT_FIGURES_MAX_PAGES } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { useDocument } from '../../documents/index.js';
import { questionsApi } from '../api/questions.api.js';
import { questionsQueryKey, useDeleteQuestion, useGroupQuestions, usePageCount, usePassages, usePublishIssues, useQuestions, useUngroupPassage, useUpdatePassage, useUpdateQuestion } from '../hooks/use-questions.js';
import { useQuestionDrafts } from '../hooks/use-question-drafts.js';
import { usePassageDrafts } from '../hooks/use-passage-drafts.js';
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
  useToast,
  useConfirm,
} from '../../../shared/ui/index.js';
import {
  type CardBox,
  type CardDrawTarget,
  EditableQuestionCard,
} from './editable-question-card.js';
import { ComprehensionGroupPanel } from './comprehension-group.js';
import { SourcePreviewPane, type SourcePreviewMagnifier } from './source-preview-pane.js';
import { useVerifySources } from '../hooks/use-verify-sources.js';
import type { VerifySibling } from '../lib/verify-sources.js';
import { PublishIssueActions } from './publish-issue-actions.js';

/** Which source PDFs sit beside the question page: question only, + answer, or + answer & solution. */
type ViewMode = 'question' | 'answer' | 'solution';
/** Destinations whose crop boundary is drawn on the main question-PDF canvas. */
type CanvasCropTarget = 'question' | 'option' | 'answer' | 'solution';

/** Last page an operator deliberately opened in one supporting source, scoped to its question page. */
type SourcePageState = { context: string; page: number };

function sourcePageContext(source: VerifySibling, questionPage: number): string {
  return `${source.document.id}:${String(questionPage)}:${String(source.defaultPage)}`;
}

/** The view-toggle options. `needs` names the sibling document an option requires to be selectable. */
const VIEW_MODES: readonly { mode: ViewMode; label: string; needs: 'answer' | 'solution' | null }[] = [
  { mode: 'question', label: 'Question', needs: null },
  { mode: 'answer', label: 'Answer', needs: 'answer' },
  { mode: 'solution', label: 'Solution', needs: 'solution' },
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
  /** The question-PDF page that owns this canvas box; it may follow the question's source page. */
  sourcePage: number;
  type: CanvasCropTarget;
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
  /** Which source page the crop is taken from: main question canvas, answer key, or solution. */
  source: 'question' | 'answer' | 'solution';
  /** Answer/solution destination when an inline paper draws it from the main question canvas. */
  target?: 'answer' | 'solution';
  sourceDocumentId?: string;
  resolve: (url: string | null) => void;
};

/** One question whose next drag on the question PDF should be sent for text transcription. */
type RegionTranscriptionTarget = {
  questionId: string;
  page: number;
  destination: 'stem' | 'answer' | 'solution';
  source?: ReExtractSource;
};

/** A durable Answer/Solution crop, paired with the question field it must replace on release. */
type SiblingPreviewCrop = {
  /** Stable pane-local identity; URLs change after a re-crop, so a replacement receives a new id. */
  id: string;
  questionId: string;
  crop: ImageCrop;
  page: number;
  label: string;
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
  /** Natural crop coordinates belong to this specific question-PDF page. */
  sourcePage: number;
  type: CanvasCropTarget;
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
    sourcePage: spec.sourcePage,
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
    sourcePage: box.sourcePage,
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
function cropKey(crop: { url: string; type: CanvasCropTarget; optionIndex: number }): string {
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
    sourcePage: spec.sourcePage,
  };
}

/** Rebuild the session's natural-pixel specs for a question from the crops persisted on it. */
function cropsToSpecs(
  question: Question,
  number: number,
  options: { documentId: string; inlineAnswers: boolean },
): SavedBoxSpec[] {
  // Main question/option crops always belong on this canvas. Answer/solution crops only do when
  // this document explicitly uses the inline layout and their provenance says they came from this
  // same source (or is legacy-inline with no sibling provenance). Sibling crops stay in their own
  // preview pane; rendering them here would put a valid boundary onto the wrong PDF.
  return question.imageCrops
    .filter((crop): crop is ImageCrop & { type: CanvasCropTarget } =>
      crop.type === 'question' ||
      crop.type === 'option' ||
      (options.inlineAnswers &&
        (crop.type === 'answer' || crop.type === 'solution') &&
        (crop.sourceDocumentId === undefined || crop.sourceDocumentId === options.documentId)),
    )
    .map((crop, index) => ({
    id: `persist_${question.id}_${crop.type}_${String(crop.optionIndex)}_${String(index)}`,
    questionId: question.id,
    sourcePage: crop.sourcePage ?? question.sourceRegion.page,
    type: crop.type,
    optionIndex: crop.optionIndex,
    label: `Q${String(number)}${
      crop.type === 'option'
        ? ` · option ${String(crop.optionIndex + 1)}`
        : crop.type === 'answer'
          ? ' · answer figure'
          : crop.type === 'solution'
            ? ' · explanation figure'
            : ''
    }`,
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

/** One Answer/Solution-page figure already matched to the question it belongs to. */
type SiblingDetectedFigure = {
  sourceDocumentId: string;
  sourcePage: number;
  figure: DetectedFigure & { target: 'answer' | 'solution' };
};

/** Result of persisting a set of detected sibling-source figures. */
type SiblingAttachResult = {
  attached: number;
  skipped: number;
  failed: number;
  sourcePages: ReadonlySet<string>;
  error: string | null;
};

/** How much two natural-pixel crop rectangles overlap, relative to their union. */
function cropOverlap(a: BoxRect, b: BoxRect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - x) * Math.max(0, bottom - y);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Re-running detection must not duplicate the same Answer/Solution figure while still allowing many. */
function hasSiblingFigureCrop(
  question: Question,
  entry: SiblingDetectedFigure,
): boolean {
  const [x, y, width, height] = entry.figure.bbox;
  const incoming: BoxRect = { x, y, width, height };
  return question.imageCrops.some((crop) =>
    crop.type === entry.figure.target &&
    crop.sourceDocumentId === entry.sourceDocumentId &&
    crop.sourcePage === entry.sourcePage &&
    cropOverlap(
      { x: crop.nx, y: crop.ny, width: crop.nw, height: crop.nh },
      incoming,
    ) >= 0.9,
  );
}

/**
 * Main-question figures normally remain one per destination, but a figure on a continuation page
 * is a second source region for the same stem. It must not be hidden merely because the question's
 * opening page already has a figure. Re-runs still skip the same continuation rectangle once its
 * provenance has been saved.
 */
function hasQuestionFigureCrop(
  question: Question,
  sourcePage: number,
  figure: DetectedFigure & { target: 'question' | 'option' },
): boolean {
  if (figure.target === 'option') return targetHasImage(question, figure.target, figure.optionIndex);
  // Preserve the existing single-stem behavior on the question's own page. The exception below is
  // deliberately narrow: only a later source page can add another question image.
  if (sourcePage === question.sourceRegion.page) return hasQuestionImage(question);
  const [x, y, width, height] = figure.bbox;
  const incoming: BoxRect = { x, y, width, height };
  return question.imageCrops.some((crop) =>
    crop.type === 'question' &&
    crop.sourcePage === sourcePage &&
    cropOverlap({ x: crop.nx, y: crop.ny, width: crop.nw, height: crop.nh }, incoming) >= 0.9,
  );
}

/**
 * Answer/explanation figures on an inline question PDF are allowed to be plural. Unlike the stem
 * skip rule, only the same saved source rectangle suppresses a re-run; a second distinct working
 * diagram belongs in the same field. Main-canvas inline crops deliberately carry no sibling source
 * id, which keeps a crop from an Answer/Solution PDF out of this comparison.
 */
function hasInlineFieldFigureCrop(
  question: Question,
  sourcePage: number,
  figure: DetectedFigure & { target: 'answer' | 'solution' },
): boolean {
  const [x, y, width, height] = figure.bbox;
  const incoming: BoxRect = { x, y, width, height };
  return question.imageCrops.some((crop) =>
    crop.type === figure.target &&
    crop.sourceDocumentId === undefined &&
    (crop.sourcePage ?? question.sourceRegion.page) === sourcePage &&
    cropOverlap({ x: crop.nx, y: crop.ny, width: crop.nw, height: crop.nh }, incoming) >= 0.9,
  );
}

function hasMainCanvasFigureCrop(
  question: Question,
  sourcePage: number,
  figure: DetectedFigure & { target: CanvasCropTarget },
): boolean {
  if (figure.target === 'answer' || figure.target === 'solution') {
    return hasInlineFieldFigureCrop(
      question,
      sourcePage,
      figure as DetectedFigure & { target: 'answer' | 'solution' },
    );
  }
  return hasQuestionFigureCrop(
    question,
    sourcePage,
    figure as DetectedFigure & { target: 'question' | 'option' },
  );
}

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
  label = 'Live crop preview',
}: {
  imageSrc: string;
  box: BoxRect;
  size: CanvasSize;
  label?: string;
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
        <span className="flex items-center gap-1.5"><IconZoomIn /> {label}</span>
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
  sessionBar?: ReactNode | ((hasUnsavedEdits: boolean, isSaving: boolean, onFocusQuestion: (questionId: string) => void) => ReactNode);
  /** Page to open on (a searched question's source page); defaults to the first page. */
  initialPage?: number;
  /** A question to scroll to and briefly ring once loaded — the one a bank search opened. */
  focusQuestionId?: string;
}): JSX.Element {
  const questions = useQuestions(documentId);
  const publishIssues = usePublishIssues(documentId);
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
  // Comprehension passages (BLA-125, v2) are a separate entity, edited once in the group panel.
  const passages = usePassages(documentId);
  const passageDrafts = usePassageDrafts(documentId, passages.data);
  // The shared passage figure saves immediately on crop (like question images), not through the draft.
  const passageImageUpdate = useUpdatePassage(documentId);
  // Auto-attach a detected shared-passage figure: crop the bbox off `sourcePage`, upload, and save it as
  // the passage image — unless the passage already has one. Shared by the single-page + whole-doc runs.
  const attachPassageFigure = useCallback(
    async (passageId: string, sourcePage: number, bbox: [number, number, number, number]): Promise<boolean> => {
      const existing = (passages.data ?? []).find((p) => p.id === passageId);
      if (existing?.passageImage) return false;
      const [x, y, w, h] = bbox;
      const blob = await getCroppedBlob(questionsApi.pageImageUrl(documentId, sourcePage), { x, y, width: w, height: h });
      const { url } = await questionsApi.uploadImage(passageId, `passage_${String(Date.now())}`, blob);
      await passageImageUpdate.mutateAsync({ id: passageId, patch: { passageImage: url } });
      return true;
    },
    [documentId, passages.data, passageImageUpdate],
  );
  // Manual grouping (BLA-125, v2): select standalone question cards → group them into a comprehension.
  const groupMutation = useGroupQuestions(documentId);
  const ungroupMutation = useUngroupPassage(documentId);
  const deleteQuestion = useDeleteQuestion(documentId);
  const [confirm, confirmDialog] = useConfirm();
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [documentId]);
  const toggleSelect = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [page, setPage] = useState(initialPage ?? 1);
  // A figure can continue onto the page after its question begins. Remember owners discovered by the
  // detector so that continuation page shows the real question card instead of an empty panel.
  const [continuationOwnersByPage, setContinuationOwnersByPage] = useState<ReadonlyMap<number, ReadonlySet<string>>>(
    () => new Map(),
  );
  useEffect(() => { setContinuationOwnersByPage(new Map()); }, [documentId]);
  const rememberContinuationOwners = useCallback((sourcePage: number, figures: readonly DetectedFigure[]): void => {
    const owners = figures
      .filter((figure) =>
        (figure.target === 'question' ||
          figure.target === 'option' ||
          figure.target === 'answer' ||
          figure.target === 'solution') &&
        figure.questionId.trim().length > 0,
      )
      .map((figure) => figure.questionId);
    if (owners.length === 0) return;
    setContinuationOwnersByPage((previous) => {
      const next = new Map(previous);
      const ids = new Set(next.get(sourcePage) ?? []);
      owners.forEach((id) => ids.add(id));
      next.set(sourcePage, ids);
      return next;
    });
  }, []);
  // The sibling answer/solution sources for this unit, resolved for the page currently on screen so
  // both the preview panes and the answer/explanation re-read target this topic's pages in them.
  const sources = useVerifySources(document.data, page);
  // An inline-answer paper carries each question's answer beside it in the one question PDF — there is
  // no separate answer/solution PDF to show, so the side-by-side answer/solution views are dropped.
  const inlineAnswers = document.data?.answerLayout === 'inline';
  // A `combined` layout deliberately resolves Answer and Solution to the SAME companion PDF. Keep
  // that fact explicit here: the two field destinations remain separate, but the screen must never
  // render two identical preview panes for one physical source.
  const companionSource = sources.answer && sources.solution &&
    sources.answer.document.kind === 'companion' &&
    sources.answer.document.id === sources.solution.document.id
    ? sources.answer
    : null;
  const viewModes = inlineAnswers ? VIEW_MODES.filter((option) => option.mode === 'question') : VIEW_MODES;
  // The source previews are independently selectable: teachers often need to compare a question to
  // its answer, its worked solution, or both. The set is deliberately never empty — one source must
  // remain visible at all times.
  const [visibleViews, setVisibleViews] = useState<ReadonlySet<ViewMode>>(() => new Set<ViewMode>(['question']));
  const [companionTarget, setCompanionTarget] = useState<'answer' | 'solution'>('answer');
  useEffect(() => { setCompanionTarget('answer'); }, [companionSource?.document.id]);
  const toggleView = useCallback((mode: ViewMode): void => {
    setVisibleViews((previous) => {
      const next = new Set(previous);
      if (next.has(mode)) {
        if (next.size === 1) return previous;
        next.delete(mode);
      } else {
        next.add(mode);
      }
      return next;
    });
  }, []);
  // SourcePreviewPane owns the visual cursor; this small map mirrors it so a field's re-extract
  // reads the page the operator is actually viewing, rather than always reopening range.from.
  const [sourcePages, setSourcePages] = useState<ReadonlyMap<string, SourcePageState>>(() => new Map());
  const sourcePageFor = useCallback((source: VerifySibling): number => {
    // A grouped companion is one physical pane even though Answer and Explanation have different
    // topic defaults. Both field re-extract buttons must therefore use the page currently open in
    // that shared pane, not silently fall back to separate range starts.
    const visibleSource = companionSource?.document.id === source.document.id ? companionSource : source;
    const state = sourcePages.get(visibleSource.document.id);
    return state?.context === sourcePageContext(visibleSource, page) ? state.page : visibleSource.defaultPage;
  }, [companionSource, page, sourcePages]);
  const rememberSourcePage = useCallback((source: VerifySibling, sourcePage: number): void => {
    const context = sourcePageContext(source, page);
    setSourcePages((previous) => {
      const current = previous.get(source.document.id);
      if (current?.context === context && current.page === sourcePage) return previous;
      const next = new Map(previous);
      next.set(source.document.id, { context, page: sourcePage });
      return next;
    });
  }, [page]);
  const reExtractSourceFor = useCallback((source: VerifySibling | null, target: 'answer' | 'solution'): ReExtractSource | undefined => {
    if (!source) return undefined;
    return {
      documentId: source.document.id,
      page: sourcePageFor(source),
      ...(source.document.kind === 'companion' ? { target } : {}),
    };
  }, [sourcePageFor]);
  const answerSource = reExtractSourceFor(sources.answer, 'answer');
  const solutionSource = reExtractSourceFor(sources.solution, 'solution');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  const [regionTranscriptionTarget, setRegionTranscriptionTarget] = useState<RegionTranscriptionTarget | null>(null);
  const regionTranscriptionTargetRef = useRef<RegionTranscriptionTarget | null>(null);
  const [regionTranscriptionBusy, setRegionTranscriptionBusy] = useState(false);
  useEffect(() => {
    regionTranscriptionTargetRef.current = null;
    setRegionTranscriptionTarget(null);
  }, [documentId]);
  useEffect(() => {
    if (
      !regionTranscriptionTarget ||
      (regionTranscriptionTarget.source && regionTranscriptionTarget.source.documentId !== documentId) ||
      page === regionTranscriptionTarget.page
    ) return;
    regionTranscriptionTargetRef.current = null;
    setRegionTranscriptionTarget(null);
  }, [documentId, page, regionTranscriptionTarget]);
  // A pending one-shot field crop (answer/explanation/match image); mirrored in a ref so the async draw +
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
  /** Live answer/solution drag forwarded by SourcePreviewPane into the same magnifier UI. */
  const [siblingMagnifier, setSiblingMagnifier] = useState<SourcePreviewMagnifier | null>(null);
  useEffect(() => { setSiblingMagnifier(null); }, [documentId]);

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
  const [aiResult, setAiResult] = useState<{
    detected: number;
    placed: number;
    skipped: number;
    sourceLabel?: 'Answer' | 'Solution';
  } | null>(null);
  const [siblingDetecting, setSiblingDetecting] = useState<ReadonlySet<'answer' | 'solution'>>(() => new Set());
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
      // getQueryData returns the RAW cached value (a QuestionListResponse), NOT a `select` slice — so
      // read `.questions` off it, never treat the cache as a bare Question[].
      queryClient
        .getQueryData<QuestionListResponse>(questionsQueryKey(documentId))
        ?.questions.find((q) => q.id === questionId),
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

  /**
   * Crop and attach already-mapped Answer/Solution figures. Each question is written once per batch,
   * so multiple detected figures never overwrite one another; repeated scans skip an almost-identical
   * source rectangle but retain genuinely separate figures on the same answer or solution.
   */
  const attachDetectedSiblingFigures = useCallback(
    async (
      entries: readonly SiblingDetectedFigure[],
      onProgress?: () => void,
    ): Promise<SiblingAttachResult> => {
      let attached = 0;
      let skipped = 0;
      let failed = 0;
      let firstError: string | null = null;
      const sourcePages = new Set<string>();
      const initial = await questionsApi.listByDocument(documentId);
      const initialById = new Map(initial.questions.map((question) => [question.id, question]));
      const byQuestion = new Map<string, SiblingDetectedFigure[]>();
      for (const entry of entries) {
        const group = byQuestion.get(entry.figure.questionId) ?? [];
        group.push(entry);
        byQuestion.set(entry.figure.questionId, group);
      }

      for (const [questionId, group] of byQuestion) {
        let preparedForPatch = 0;
        try {
          await enqueueQuestionWrite(questionId, async () => {
            const current = readQuestion(questionId) ?? initialById.get(questionId);
            if (!current) {
              skipped += group.length;
              group.forEach(() => { onProgress?.(); });
              return;
            }
            let answerImages = [...current.answerImages];
            let explanationImages = [...current.explanationImages];
            let imageCrops = [...current.imageCrops];
            let answerChanged = false;
            let solutionChanged = false;
            let attachedHere = 0;
            const pagesHere = new Set<string>();
            for (const entry of group) {
              if (hasSiblingFigureCrop({ ...current, answerImages, explanationImages, imageCrops }, entry)) {
                skipped += 1;
                onProgress?.();
                continue;
              }
              try {
                const [x, y, width, height] = entry.figure.bbox;
                const blob = await getCroppedBlob(
                  questionsApi.pageImageUrl(entry.sourceDocumentId, entry.sourcePage),
                  { x, y, width, height },
                );
                const { url } = await questionsApi.uploadImage(
                  questionId,
                  `${entry.figure.target}_${String(entry.sourcePage)}_${String(Math.round(x))}_${String(Math.round(y))}_${String(Date.now())}`,
                  blob,
                );
                const crop: ImageCrop = {
                  url,
                  type: entry.figure.target,
                  optionIndex: 0,
                  nx: x,
                  ny: y,
                  nw: width,
                  nh: height,
                  sourceDocumentId: entry.sourceDocumentId,
                  sourcePage: entry.sourcePage,
                };
                imageCrops = upsertCrop(imageCrops, crop, undefined);
                if (entry.figure.target === 'answer') {
                  answerImages = [...answerImages, url];
                  answerChanged = true;
                } else {
                  explanationImages = [...explanationImages, url];
                  solutionChanged = true;
                }
                pagesHere.add(`${entry.sourceDocumentId}:${String(entry.sourcePage)}`);
                attachedHere += 1;
              } catch (caught) {
                failed += 1;
                firstError ??= caught instanceof Error ? caught.message : String(caught);
              } finally {
                onProgress?.();
              }
            }
            if (attachedHere === 0) return;
            preparedForPatch = attachedHere;
            await patchQuestion({
              id: questionId,
              patch: {
                ...(answerChanged ? { answerImages } : {}),
                ...(solutionChanged ? { explanationImages } : {}),
                imageCrops,
              },
            });
            attached += attachedHere;
            pagesHere.forEach((sourcePage) => sourcePages.add(sourcePage));
          });
        } catch (caught) {
          // A patch failure means only the crops prepared for it were not attached. Individual crop
          // failures have already been counted inside the loop, so do not double-count them here.
          failed += preparedForPatch;
          firstError ??= caught instanceof Error ? caught.message : String(caught);
        }
      }
      return { attached, skipped, failed, sourcePages, error: firstError };
    },
    [documentId, patchQuestion, readQuestion],
  );

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
      const rescale = (bs: Box[]): Box[] =>
        bs.map((b) => ({ ...b, x: b.x * rx, y: b.y * ry, width: b.width * rx, height: b.height * ry }));
      applyBoxes(rescale);
      // Undo/redo snapshots use display pixels and must follow changes in zoom too.
      past.current = past.current.map(rescale);
      future.current = future.current.map(rescale);
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

  const continuationQuestionIds = useMemo(() => {
    const ids = new Set(continuationOwnersByPage.get(page) ?? []);
    // A persisted continuation crop still has to reveal its owner after a reload, when no in-memory
    // detector result remains. Legacy crops without sourcePage retain their original-page behaviour.
    for (const question of questions.data ?? []) {
      if (question.sourceRegion.page === page) continue;
      if (question.imageCrops.some((crop) =>
        (crop.type === 'question' ||
          crop.type === 'option' ||
          (inlineAnswers && (crop.type === 'answer' || crop.type === 'solution') && crop.sourceDocumentId === undefined)) &&
        crop.sourcePage === page,
      )) ids.add(question.id);
    }
    return ids;
  }, [continuationOwnersByPage, inlineAnswers, page, questions.data]);
  const onThisPage = useMemo(() => {
    const all = questions.data ?? [];
    const continued = all.filter((question) => continuationQuestionIds.has(question.id));
    const startedHere = all.filter((question) => question.sourceRegion.page === page);
    return [...continued, ...startedHere.filter((question) => !continuationQuestionIds.has(question.id))];
  }, [continuationQuestionIds, page, questions.data]);
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
  // Unlike a temporary crop request, these are durable sibling-PDF boundaries. Every answer/solution
  // figure with saved source metadata is projected into its own draggable box — several questions can
  // legitimately share one answer-key or solution page, so a single "first crop" is not sufficient.
  const answerPreviewCrops = useMemo<SiblingPreviewCrop[]>(() => {
    const source = sources.answer;
    if (!source) return [];
    return (questions.data ?? []).flatMap((question) =>
      question.imageCrops
        .filter((crop) =>
          crop.type === 'answer' &&
          question.answerImages.includes(crop.url) &&
          (!crop.sourceDocumentId || crop.sourceDocumentId === source.document.id),
        )
        .map((crop, index) => ({
          id: `answer:${question.id}:${crop.url}:${String(index)}`,
          questionId: question.id,
          crop,
          page: crop.sourcePage ?? source.defaultPage,
          label: `Q${String(questionNumberById.get(question.id) ?? '?')} · answer`,
        })),
    );
  }, [questions.data, questionNumberById, sources.answer]);
  const solutionPreviewCrops = useMemo<SiblingPreviewCrop[]>(() => {
    const source = sources.solution;
    if (!source) return [];
    return (questions.data ?? []).flatMap((question) =>
      question.imageCrops
        .filter((crop) =>
          crop.type === 'solution' &&
          question.explanationImages.includes(crop.url) &&
          (!crop.sourceDocumentId || crop.sourceDocumentId === source.document.id),
        )
        .map((crop, index) => ({
          id: `solution:${question.id}:${crop.url}:${String(index)}`,
          questionId: question.id,
          crop,
          page: crop.sourcePage ?? source.defaultPage,
          label: `Q${String(questionNumberById.get(question.id) ?? '?')} · solution`,
        })),
    );
  }, [questions.data, questionNumberById, sources.solution]);

  // Group this page's questions for rendering: consecutive rows sharing a non-null comprehension
  // passageId collapse under ONE passage header (BLA-125); everything else renders as a standalone card.
  // The list arrives in PDF reading order (groups already contiguous, ordered by groupOrder), so a
  // single walk preserves order.
  type RenderItem =
    | { kind: 'single'; question: Question }
    | { kind: 'group'; passageId: string; first: Question; questions: Question[] };
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    // Coalesce by passageId (not just consecutive rows): a manually-grouped, non-contiguous set must
    // still render as exactly ONE group card (unique key), anchored at its first member's position.
    const groupByPassage = new Map<string, Extract<RenderItem, { kind: 'group' }>>();
    for (const question of onThisPage) {
      const passageId = question.passageId;
      if (passageId === null) {
        items.push({ kind: 'single', question });
        continue;
      }
      const existing = groupByPassage.get(passageId);
      if (existing) {
        existing.questions.push(question);
        continue;
      }
      const group: Extract<RenderItem, { kind: 'group' }> = {
        kind: 'group',
        passageId,
        first: question,
        questions: [question],
      };
      groupByPassage.set(passageId, group);
      items.push(group);
    }
    return items;
  }, [onThisPage]);

  // The passage entity for each group, so the panel shows its text (draft) + shared image.
  const passageById = useMemo(
    () => new Map((passages.data ?? []).map((passage) => [passage.id, passage] as const)),
    [passages.data],
  );

  // Apply a whole-group re-read: the fresh passage onto the group's Passage draft (edited in one place),
  // and each sub-question's fields onto the card it was matched to. Non-empty reads win; an empty
  // answer/explanation is kept so a question paper that prints neither never wipes a good value.
  const applyGroupReExtract = useCallback(
    (passageId: string, groupQuestions: Question[], result: ReExtractedGroup): void => {
      passageDrafts.setText(passageId, result.passage);
      // A passage-only operation deliberately has no authority to replace any child field, even if an
      // older/misbehaving server returned them. This keeps the selected Verify scope non-destructive.
      if (result.mode === 'passage_only') return;
      const byId = new Map(result.subQuestions.map((sub) => [sub.questionId, sub]));
      for (const q of groupQuestions) {
        const sub = byId.get(q.id);
        if (!sub) continue;
        drafts.updateDraft(q.id, (prev) => {
          const next = { ...prev };
          if (sub.stem.trim() !== '') next.stem = sub.stem;
          if (sub.options.length > 0) next.options = sub.options;
          if (sub.answer.trim() !== '') next.answer = sub.answer;
          if (sub.explanation && sub.explanation.trim() !== '') next.explanation = sub.explanation;
          // A comprehension can contain a real matrix child. Apply only a validated returned table to
          // a draft that is still matrix-typed; never infer or overwrite the answer from its match key.
          if (prev.questionType === 'matrix' && sub.match !== null) next.match = sub.match;
          return next;
        });
      }
    },
    [drafts, passageDrafts],
  );

  // The selected questions in PDF reading order (so a manual group's groupOrder follows the sheet).
  const orderedSelection = useMemo(
    () => (questions.data ?? []).filter((q) => selectedIds.has(q.id)).map((q) => q.id),
    [questions.data, selectedIds],
  );
  const groupSelected = useCallback((): void => {
    // A comprehension can hold a SINGLE question (a lone passage-bound sub-question), so one selection
    // is enough to group — only an empty selection has nothing to do.
    if (orderedSelection.length < 1) return;
    groupMutation.mutate(orderedSelection, { onSuccess: () => { setSelectedIds(new Set()); } });
  }, [groupMutation, orderedSelection]);

  // Question numbers the extractor appears to have skipped: gaps in the min..max run of the numbers it
  // read across the whole document. Surfaced so a missing question is visible instead of silently
  // absent. Suppressed for comprehension (a shared-passage block's sub-questions are often numbered
  // irregularly — restarting per passage, or sharing one printed number — which would read as false
  // gaps) and for garbled numbering (a stray large number that would paint the whole range as missing).
  const missingNumbers = useMemo<number[]>(() => {
    const data = questions.data ?? [];
    if (data.some((q) => q.passageId !== null)) return [];
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

  // Scroll to + briefly ring the question card and its original source region, so a bank link (or an
  // AI crop review row) makes it immediately obvious which extracted question is in focus.
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [sourceHighlightId, setSourceHighlightId] = useState<string | null>(null);
  const pendingFocusId = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusQuestion = (questionId: string): void => {
    cardRefs.current.get(questionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(questionId);
    setSourceHighlightId(questionId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => { setHighlightId(null); }, 1800);
  };
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // Wait for the fitted page dimensions before starting this timer: an image can take a moment to
  // load after a direct bank link, and the source-region outline should remain visible *after* the
  // preview is actually ready rather than expiring while its spinner is still on screen.
  useEffect(() => {
    if (!sourceHighlightId || !size || size.displayWidth === 0) return undefined;
    const target = questionById.get(sourceHighlightId);
    if (!target || target.sourceRegion.page !== page) return undefined;
    const timer = setTimeout(() => {
      setSourceHighlightId((current) => (current === sourceHighlightId ? null : current));
    }, 2400);
    return () => { clearTimeout(timer); };
  }, [page, questionById, size, sourceHighlightId]);

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
    // A source-region focus must wait for the new page image to report fresh fitted dimensions; do not
    // project a direct-link bbox through the previous page's stale canvas size.
    sizeRef.current = null;
    setSize(null);
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

  // A LaTeX issue can belong to a question on another PDF page. Switch pages first, then focus the
  // card once the new page has rendered so the affected question is visible and highlighted.
  const focusQuestionInWorkspace = (questionId: string): void => {
    const target = questionById.get(questionId);
    if (!target) return;
    if (target.sourceRegion.page !== pageRef.current) {
      pendingFocusId.current = questionId;
      goToPage(target.sourceRegion.page);
      return;
    }
    focusQuestion(questionId);
  };
  useEffect(() => {
    const pendingId = pendingFocusId.current;
    if (!pendingId) return;
    const target = questionById.get(pendingId);
    if (!target || target.sourceRegion.page !== page) return;
    pendingFocusId.current = null;
    requestAnimationFrame(() => { focusQuestion(pendingId); });
  }, [page, questionById]);

  // A bank search or Questions-browse link opens the workspace on the focused question's source page;
  // once its card renders, scroll to and briefly ring both the card and the source region. If its page
  // differs from where we opened, navigate there first. One target can be focused once, while a later
  // link to a different target in the same mounted workspace still works.
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusQuestionId || focusedFor.current === focusQuestionId) return;
    const target = (questions.data ?? []).find((q) => q.id === focusQuestionId);
    if (!target) return;
    if (target.sourceRegion.page !== pageRef.current) {
      goToPage(target.sourceRegion.page);
      return;
    }
    focusedFor.current = focusQuestionId;
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
    } else if (box.type === 'option' && (question.optionImages[box.optionIndex] ?? '') === url) {
      const optionImages = [...question.optionImages];
      optionImages[box.optionIndex] = '';
      await patchQuestion({ id: question.id, patch: { optionImages, imageCrops } });
    } else if (box.type === 'answer' && question.answerImages.includes(url)) {
      await patchQuestion({
        id: question.id,
        patch: { answerImages: question.answerImages.filter((item) => item !== url), imageCrops },
      });
    } else if (box.type === 'solution' && question.explanationImages.includes(url)) {
      await patchQuestion({
        id: question.id,
        patch: { explanationImages: question.explanationImages.filter((item) => item !== url), imageCrops },
      });
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
      {
        url,
        type: box.type,
        optionIndex: box.optionIndex,
        nx: natural.x,
        ny: natural.y,
        nw: natural.width,
        nh: natural.height,
        sourcePage: box.sourcePage,
      },
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
    } else if (box.type === 'option') {
      const optionImages = [...question.optionImages];
      while (optionImages.length <= box.optionIndex) optionImages.push('');
      optionImages[box.optionIndex] = url;
      await patchQuestion({ id: question.id, patch: { isOptionImage: true, optionImages, imageCrops } });
    } else {
      const field = box.type === 'answer' ? 'answerImages' : 'explanationImages';
      const current = [...question[field]];
      const at = previousUrl ? current.indexOf(previousUrl) : -1;
      if (at >= 0) current[at] = url;
      else current.push(url);
      await patchQuestion({ id: question.id, patch: { [field]: current, imageCrops } });
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
      const blob = await getCroppedBlob(questionsApi.pageImageUrl(documentId, box.sourcePage), natural);
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

  /** Scan and attach figures from the Answer or Solution page currently open in its sibling pane. */
  const detectSiblingPage = useCallback(async (
    target: 'answer' | 'solution',
    sourceDocumentId: string,
    sourcePage: number,
  ): Promise<void> => {
    if (runActiveRef.current) return;
    setSiblingDetecting((previous) => new Set(previous).add(target));
    setAiError(null);
    setAiResult(null);
    try {
      const result = await questionsApi.detectFigures(documentId, sourcePage, {
        documentId: sourceDocumentId,
        target,
      });
      const entries: SiblingDetectedFigure[] = result.figures
        .filter((figure): figure is DetectedFigure & { target: 'answer' | 'solution' } =>
          figure.target === 'answer' || figure.target === 'solution',
        )
        .filter((figure) => figure.target === target)
        .map((figure) => ({ sourceDocumentId, sourcePage, figure }));
      const outcome = await attachDetectedSiblingFigures(entries);
      if (outcome.error) setAiError(outcome.error);
      setAiResult({
        detected: result.figures.length,
        placed: outcome.attached,
        skipped: outcome.skipped,
        sourceLabel: target === 'answer' ? 'Answer' : 'Solution',
      });
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSiblingDetecting((previous) => {
        const next = new Set(previous);
        next.delete(target);
        return next;
      });
    }
  }, [attachDetectedSiblingFigures, documentId]);

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

  // --- Draw-to-save (manual flow): arm a target from its card, rubber-band draw, auto-save. ---
  const toggleDrawTarget = (question: Question, type: 'question' | 'option', optionIndex = 0): void => {
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
        sourcePage: page,
        type: drawTarget.type,
        optionIndex: drawTarget.optionIndex,
        source: 'manual',
        label: `Q${String(number ?? '?')}${drawTarget.type === 'option' ? ` · option ${String(drawTarget.optionIndex + 1)}` : ''}`,
        ...rect,
      },
    ]);
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

  // --- One-shot field crops (answer/explanation image, match-the-column entry image). ---
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
    (questionId: string, source: 'question' | 'answer' | 'solution'): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        cropRequestRef.current?.resolve(null); // supersede any prior pending request
        setDrawTarget(null); // the editable-box draw and a field crop can't be armed at once
        const sibling = source === 'answer' ? sources.answer : source === 'solution' ? sources.solution : undefined;
        // The grouped companion has one pane for both destinations. Reflect the field the card asked
        // for in its compact picker, while `req.source` below still remains the durable destination.
        if (sibling && companionSource?.document.id === sibling.document.id && (source === 'answer' || source === 'solution')) {
          setCompanionTarget(source);
        }
        // An inline layout has no sibling pane: draw the answer/explanation directly on the question
        // canvas, but preserve its field destination independently from the canvas source.
        const inlineField = inlineAnswers && !sibling && (source === 'answer' || source === 'solution') ? source : undefined;
        if (!inlineField) setVisibleViews((previous) => new Set([...previous, source]));
        const req: CropRequest = {
          questionId,
          source: inlineField ? 'question' : source,
          ...(inlineField ? { target: inlineField } : {}),
          ...(sibling ? { sourceDocumentId: sibling.document.id } : {}),
          resolve,
        };
        cropRequestRef.current = req;
        setCropRequest(req);
      }),
    [companionSource?.document.id, inlineAnswers, sources.answer, sources.solution],
  );
  /** Put a just-drawn sibling figure in the card immediately, before upload latency is visible. */
  const addOptimisticSiblingImage = (questionId: string, source: 'answer' | 'solution', previewUrl: string): void => {
    const field = source === 'answer' ? 'answerImages' : 'explanationImages';
    queryClient.setQueryData<QuestionListResponse>(questionsQueryKey(documentId), (previous) =>
      previous
        ? {
            ...previous,
            questions: previous.questions.map((question) =>
              question.id === questionId && !question[field].includes(previewUrl)
                ? { ...question, [field]: [...question[field], previewUrl] }
                : question,
            ),
          }
        : previous,
    );
  };
  /** Roll back only the temporary browser URL if its background upload fails or the user removes it. */
  const removeOptimisticSiblingImage = (questionId: string, source: 'answer' | 'solution', previewUrl: string): void => {
    const field = source === 'answer' ? 'answerImages' : 'explanationImages';
    queryClient.setQueryData<QuestionListResponse>(questionsQueryKey(documentId), (previous) =>
      previous
        ? {
            ...previous,
            questions: previous.questions.map((question) =>
              question.id === questionId
                ? { ...question, [field]: question[field].filter((url) => url !== previewUrl) }
                : question,
            ),
          }
        : previous,
    );
  };
  /**
   * A manual answer/explanation crop from an inline question PDF is already durable after its
   * background write. Materialise its boundary on this same canvas straight away, instead of making
   * the operator reload before they can drag the crop they just made.
   */
  const rememberInlineFieldBox = (
    questionId: string,
    target: 'answer' | 'solution',
    url: string,
    natural: BoxRect,
    sourcePage: number,
  ): void => {
    const number = questionNumberById.get(questionId) ?? '?';
    const spec: SavedBoxSpec = {
      id: `inline_${questionId}_${target}_${String(Date.now())}`,
      questionId,
      sourcePage,
      type: target,
      optionIndex: 0,
      label: `Q${String(number)} · ${target === 'answer' ? 'answer' : 'explanation'} figure`,
      source: 'manual',
      nx: natural.x,
      ny: natural.y,
      nw: natural.width,
      nh: natural.height,
      url,
    };
    const existing = pageCache.current.get(sourcePage) ?? [];
    pageCache.current.set(sourcePage, [...existing, spec]);
    const canvasSize = sizeRef.current;
    if (pageRef.current !== sourcePage || !canvasSize || canvasSize.displayWidth === 0) return;
    applyBoxes((previous) => [...previous, specToBox(spec, canvasSize)]);
    applySavedUrls((previous) => new Map(previous).set(spec.id, url));
  };
  // Crop `imageUrl` at `natural` (natural px), upload it against the pending request's question, and
  // resolve the request with the new URL. Any failure resolves null so the caller's button just resets.
  const fulfilCrop = async (imageUrl: string, natural: BoxRect, sourcePage?: number): Promise<void> => {
    const req = cropRequestRef.current;
    if (!req) return;
    clearCropRequest();
    try {
      const blob = await getCroppedBlob(imageUrl, natural);
      const siblingSource = req.target ?? (req.source === 'answer' || req.source === 'solution' ? req.source : null);
      if (siblingSource !== null) {
        // The UI gets a browser-local image as soon as the crop encoder finishes (usually far sooner
        // than an upload + database round trip). The background job replaces it with the durable URL.
        const previewUrl = URL.createObjectURL(blob);
        addOptimisticSiblingImage(req.questionId, siblingSource, previewUrl);
        req.resolve(previewUrl);
        void (async (): Promise<void> => {
          try {
            const { url } = await questionsApi.uploadImage(req.questionId, `crop_${String(Date.now())}`, blob);
            await enqueueQuestionWrite(req.questionId, async () => {
              const latest = readQuestion(req.questionId);
              if (!latest) return;
              const field = siblingSource === 'answer' ? 'answerImages' : 'explanationImages';
              // The user may have removed the temporary thumbnail while its upload ran. In that case
              // do not revive it server-side.
              if (!latest[field].includes(previewUrl)) return;
              const media = latest[field].map((item) => (item === previewUrl ? url : item));
              const imageCrops = upsertCrop(latest.imageCrops, {
                url,
                type: siblingSource,
                optionIndex: 0,
                nx: natural.x,
                ny: natural.y,
                nw: natural.width,
                nh: natural.height,
                ...(req.sourceDocumentId ? { sourceDocumentId: req.sourceDocumentId } : {}),
                ...(sourcePage ? { sourcePage } : {}),
              }, undefined);
              await patchQuestion({ id: latest.id, patch: { [field]: media, imageCrops } });
              // An inline field was drawn on the main question canvas. Keep its durable crop box
              // on that exact page, whereas a sibling source is projected by SourcePreviewPane.
              if (req.source === 'question' && req.target) {
                rememberInlineFieldBox(
                  latest.id,
                  req.target,
                  url,
                  natural,
                  sourcePage ?? pageRef.current,
                );
              }
            });
          } catch (caught) {
            removeOptimisticSiblingImage(req.questionId, siblingSource, previewUrl);
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            URL.revokeObjectURL(previewUrl);
          }
        })();
        return;
      }
      const { url } = await questionsApi.uploadImage(req.questionId, `crop_${String(Date.now())}`, blob);
      req.resolve(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      req.resolve(null);
    }
  };

  /** Persist a drag on an already-visible Answer/Solution crop boundary. */
  const replacePreviewCrop = (
    questionId: string,
    source: 'answer' | 'solution',
    replacedUrl: string,
    sourceDocumentId: string,
    imageUrl: string,
    natural: BoxRect,
    sourcePage: number,
  ): Promise<string | null> => {
    // A direct boundary drag is an explicit new action. If a card happened to have a different
    // one-shot crop armed, settle that promise first so its button never remains in "Draw…" state.
    cropRequestRef.current?.resolve(null);
    clearCropRequest();
    return (async (): Promise<string | null> => {
      try {
        const blob = await getCroppedBlob(imageUrl, natural);
        const { url } = await questionsApi.uploadImage(questionId, `crop_${String(Date.now())}`, blob);
        // Persist the refreshed sibling crop AND replace precisely its paired media URL in ONE queued
        // write. That avoids a brief metadata/media mismatch and prevents two different boundaries on
        // the same question from clobbering one another.
        await enqueueQuestionWrite(questionId, async () => {
          const latest = readQuestion(questionId);
          if (!latest) return;
          const field = source === 'answer' ? 'answerImages' : 'explanationImages';
          const mediaIndex = latest[field].indexOf(replacedUrl);
          // A card may have removed the figure while its crop upload was in progress. Do not revive it.
          if (mediaIndex < 0) return;
          const media = [...latest[field]];
          media[mediaIndex] = url;
          const imageCrops = upsertCrop(latest.imageCrops, {
            url,
            type: source,
            optionIndex: 0,
            nx: natural.x,
            ny: natural.y,
            nw: natural.width,
            nh: natural.height,
            sourceDocumentId,
            sourcePage,
          }, replacedUrl);
          await patchQuestion({ id: latest.id, patch: { [field]: media, imageCrops } });
        });
        return url;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      }
    })();
  };

  // The main canvas' draw handler serves a pending question-source crop first, else the box pipeline.
  // (A solution-source request is fulfilled from the preview pane, so it falls through to handleDraw
  // here — but handleDraw no-ops without a drawTarget, and none is armed while a crop request is.)
  const transcribeSelectedRegion = (
    target: RegionTranscriptionTarget,
    bbox: [number, number, number, number],
    selectedPage: number,
  ): void => {
    regionTranscriptionTargetRef.current = null;
    setRegionTranscriptionTarget(null);
    if (selectedPage !== target.page) {
      toast.error('PDF page changed', 'Select the region again on the correct source page.');
      return;
    }
    setRegionTranscriptionBusy(true);
    toast.toast({ tone: 'info', title: 'Reading selected area…', description: 'The text will appear in the draft when the transcription finishes.' });
    void questionsApi.transcribeRegion(target.questionId, {
      documentId,
      page: target.page,
      bbox,
      destination: target.destination,
      ...(target.source ? { source: target.source } : {}),
    }).then(({ text }) => {
      const fieldKey = target.destination === 'solution'
        ? 'explanation'
        : target.destination;
      const currentQuestion = questionById.get(target.questionId);
      const currentText = currentQuestion ? drafts.draftFor(currentQuestion)[fieldKey] : '';
      const reviewedText = currentText.trim() ? `${currentText.trim()}\n${text}` : text;
      drafts.updateDraft(target.questionId, (previous) => ({
        ...previous,
        ...(target.destination === 'stem'
          ? { stem: previous.stem.trim() ? `${previous.stem.trim()}\n${text}` : text }
          : target.destination === 'answer'
            ? { answer: previous.answer.trim() ? `${previous.answer.trim()}\n${text}` : text }
              : { explanation: previous.explanation.trim() ? `${previous.explanation.trim()}\n${text}` : text }),
      }));
      void questionsApi.checkLatexField(fieldKey, reviewedText).then(({ issues }) => {
        const field = target.destination === 'stem' ? 'question' : target.destination;
        if (issues.length > 0) {
          toast.toast({
            tone: 'info',
            title: `${String(issues.length)} LaTeX issue(s) need review`,
            description: `Transcribed text was added to the ${field} draft. Review it, then Update to save; the source image is unchanged.`,
          });
        } else {
          toast.success(`Text added to the ${field} draft`, `LaTeX check passed. Review it, then select Update to save. The source image is unchanged.`);
        }
      }).catch(() => {
        const field = target.destination === 'stem' ? 'question' : target.destination;
        toast.success(`Text added to the ${field} draft`, 'Review it, then select Update to save. The source image is unchanged.');
      });
    }).catch((caught: unknown) => {
      toast.error('Could not read the selected area', caught instanceof Error ? caught.message : 'Your question was left unchanged.');
    }).finally(() => { setRegionTranscriptionBusy(false); });
  };

  const handleCanvasDraw = (rect: BoxRect): void => {
    const transcriptionTarget = regionTranscriptionTargetRef.current;
    if (transcriptionTarget) {
      const pageSize = sizeRef.current;
      if (!pageSize || pageSize.displayWidth === 0 || pageSize.displayHeight === 0) return;
      const bbox: [number, number, number, number] = [
        Math.max(0, rect.x / pageSize.displayWidth),
        Math.max(0, rect.y / pageSize.displayHeight),
        Math.min(1, (rect.x + rect.width) / pageSize.displayWidth),
        Math.min(1, (rect.y + rect.height) / pageSize.displayHeight),
      ];
      transcribeSelectedRegion(transcriptionTarget, bbox, page);
      return;
    }
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
      }, page);
      return;
    }
    handleDraw(rect);
  };

  const armRegionTranscription = (
    question: Question,
    destination: 'stem' | 'answer' | 'solution',
    source?: ReExtractSource,
  ): void => {
    cancelCropRequest();
    setDrawTarget(null);
    const target = {
      questionId: question.id,
      page: source?.page ?? question.sourceRegion.page,
      destination,
      ...(source ? { source } : {}),
    };
    regionTranscriptionTargetRef.current = target;
    setRegionTranscriptionTarget(target);
    const fromQuestionPage = !source || source.documentId === documentId;
    if (fromQuestionPage) {
      setVisibleViews((previous) => new Set([...previous, 'question']));
      if (page !== target.page) goToPage(target.page);
    } else {
      const view: ViewMode = destination === 'answer' ? 'answer' : 'solution';
      setVisibleViews((previous) => new Set([...previous, view]));
    }
    toast.toast({
      tone: 'info',
      title: `Select the ${destination === 'stem' ? 'question' : destination} area on the PDF`,
      description: 'Drag a box around the exact region. Press Escape to cancel.',
    });
  };

  const cancelRegionTranscription = (): void => {
    regionTranscriptionTargetRef.current = null;
    setRegionTranscriptionTarget(null);
  };

  const transcriptionForSource = (source: VerifySibling) => {
    const target = regionTranscriptionTarget;
    if (!target || (target.source?.documentId ?? documentId) !== source.document.id) return undefined;
    return {
      armed: !regionTranscriptionBusy && target.page === sourcePageFor(source),
      page: target.page,
      onSelect: (bbox: [number, number, number, number], selectedPage: number): void => {
        const activeTarget = regionTranscriptionTargetRef.current;
        if (activeTarget?.questionId === target.questionId) {
          transcribeSelectedRegion(activeTarget, bbox, selectedPage);
        }
      },
      onCancel: cancelRegionTranscription,
    };
  };

  // Esc also cancels a pending field crop.
  useEffect(() => {
    if (!cropRequest && !regionTranscriptionTarget) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancelCropRequest();
        regionTranscriptionTargetRef.current = null;
        setRegionTranscriptionTarget(null);
      }
    };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); };
  }, [cropRequest, regionTranscriptionTarget]);

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
      if (box.type === 'question') return splitUrls(question.questionImage).includes(url);
      if (box.type === 'option') return (question.optionImages[box.optionIndex] ?? '') === url;
      return box.type === 'answer'
        ? question.answerImages.includes(url)
        : question.explanationImages.includes(url);
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
      const specs = cropsToSpecs(question, question.questionNumber ?? index + 1, {
        documentId,
        inlineAnswers,
      });
      if (specs.length === 0) return;
      for (const spec of specs) {
        const pageNumber = spec.sourcePage;
        const existing = pageCache.current.get(pageNumber) ?? [];
        if (existing.some((item) => cropKey(item) === cropKey(spec))) continue;
        pageCache.current.set(pageNumber, [...existing, spec]);
      }
    });
    pendingRestore.current = pageRef.current;
    setRestoreTick((n) => n + 1);
  }, [documentId, inlineAnswers, questions.data]);

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
      rememberContinuationOwners(page, figures);
      const sx = size.displayWidth / imageWidth;
      const sy = size.displayHeight / imageHeight;
      let skipped = 0;
      // Shared-passage figures attach straight to the passage, not the question-box pipeline.
      for (const figure of figures) {
        if (figure.target !== 'passage' || figure.passageId === null) continue;
        try {
          await attachPassageFigure(figure.passageId, page, figure.bbox);
        } catch (caught) {
          setAiError(caught instanceof Error ? caught.message : String(caught));
        }
      }
      const placed: Box[] = [];
      figures
        .filter((f): f is DetectedFigure & { target: CanvasCropTarget } =>
          f.target === 'question' ||
          f.target === 'option' ||
          f.target === 'answer' ||
          f.target === 'solution',
        )
        .forEach((figure, index) => {
        const question = questionById.get(figure.questionId);
        if (question && hasMainCanvasFigureCrop(question, page, figure)) {
          skipped += 1;
          return;
        }
        const [x, y, w, h] = figure.bbox;
        placed.push({
          id: `${figure.questionId}_ai_${String(page)}_${String(index)}`,
          questionId: figure.questionId,
          sourcePage: page,
          type: figure.target,
          optionIndex: figure.optionIndex,
          source: 'ai',
          snippet: figure.snippet,
          label: `AI · Q${String(questionNumberById.get(figure.questionId) ?? '?')}${
            figure.target === 'option'
              ? ` · option ${String(figure.optionIndex + 1)}`
              : figure.target === 'answer'
                ? ' · answer figure'
                : figure.target === 'solution'
                  ? ' · explanation figure'
                  : ''
          }`,
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
  }, [documentId, page, size, questionById, questionNumberById, attachPassageFigure, rememberContinuationOwners]);

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
    const questionStartPages = [
      ...new Set((questions.data ?? []).map((question) => question.sourceRegion.page)),
    ].sort((a, b) => a - b);
    if (questionStartPages.length === 0 || runActiveRef.current) return;

    type DetectionPlan = {
      sourceDocumentId: string;
      sourceTarget: 'question' | 'answer' | 'solution';
      source?: DetectFiguresSource;
      pages: readonly number[];
    };
    type DetectedPageFigure = {
      sourceDocumentId: string;
      sourceTarget: DetectionPlan['sourceTarget'];
      page: number;
      figure: DetectedFigure;
    };

    runActiveRef.current = true;
    setAiError(null);
    setAiResult(null);
    setAllSummary(null);
    // Page counts for sibling PDFs are loaded after this turn begins. Mark the run active immediately
    // so a crop save cannot interleave with its grouped question patches during that short preflight.
    setAllProgress({ phase: 'detect', done: 0, total: 0 });
    try {
      const questionPageCount = pageCount.data ?? await questionsApi.pageCount(documentId);
      const questionPages = [
        ...new Set([
          ...questionStartPages,
          ...questionStartPages
            .filter((sourcePage) => sourcePage < questionPageCount)
            .map((sourcePage) => sourcePage + 1),
        ]),
      ].sort((a, b) => a - b);
      const plans: DetectionPlan[] = [{
        sourceDocumentId: documentId,
        sourceTarget: 'question',
        pages: questionPages,
      }];
      let preflightFailures = 0;
      let firstFailure: string | null = null;
      // A combined companion is ONE physical source. There is no safe way for a whole-document
      // vision pass to infer whether an arbitrary figure is answer evidence or explanation evidence,
      // so scan it once into the explicitly selected destination instead of duplicating every crop
      // into both fields.
      const siblingSources: readonly { target: 'answer' | 'solution'; documentId: string }[] = companionSource
        ? [{ target: companionTarget, documentId: companionSource.document.id }]
        : [
            ...(sources.answer ? [{ target: 'answer' as const, documentId: sources.answer.document.id }] : []),
            ...(sources.solution ? [{ target: 'solution' as const, documentId: sources.solution.document.id }] : []),
          ];
      for (const sibling of siblingSources) {
        try {
          const totalPages = await questionsApi.pageCount(sibling.documentId);
          const pages = Array.from({ length: totalPages }, (_unused, index) => index + 1);
          if (pages.length > 0) {
            plans.push({
              sourceDocumentId: sibling.documentId,
              sourceTarget: sibling.target,
              source: { documentId: sibling.documentId, target: sibling.target },
              pages,
            });
          }
        } catch (caught) {
          preflightFailures += 1;
          firstFailure ??= caught instanceof Error ? caught.message : String(caught);
        }
      }

      const totalDetectionPages = plans.reduce((total, plan) => total + plan.pages.length, 0);
      let detectedPages = 0;
      setAllProgress({ phase: 'detect', done: detectedPages, total: totalDetectionPages });
      const detected: DetectedPageFigure[] = [];
      const failedPages = new Set<string>();
      for (const plan of plans) {
        for (let start = 0; start < plan.pages.length; start += DETECT_FIGURES_MAX_PAGES) {
          const chunk = plan.pages.slice(start, start + DETECT_FIGURES_MAX_PAGES);
          try {
            const { pages: results } = await questionsApi.detectFiguresBatch(documentId, [...chunk], plan.source);
            for (const result of results) {
              const key = `${plan.sourceDocumentId}:${String(result.page)}`;
              if (!result.ok) {
                failedPages.add(key);
                firstFailure ??= result.error;
                continue;
              }
              if (plan.sourceTarget === 'question') rememberContinuationOwners(result.page, result.figures);
              for (const figure of result.figures) {
                detected.push({
                  sourceDocumentId: plan.sourceDocumentId,
                  sourceTarget: plan.sourceTarget,
                  page: result.page,
                  figure,
                });
              }
            }
          } catch (caught) {
            // One chunk's request failing must not discard the other chunks' detections.
            for (const failedPage of chunk) failedPages.add(`${plan.sourceDocumentId}:${String(failedPage)}`);
            firstFailure ??= caught instanceof Error ? caught.message : String(caught);
          }
          detectedPages += chunk.length;
          setAllProgress({ phase: 'detect', done: detectedPages, total: totalDetectionPages });
        }
      }

      // Re-read the questions before building patches: detection can take minutes and a patch built
      // from the run-start snapshot would silently erase anything saved in the meantime.
      const freshQuestions = (await questionsApi.listByDocument(documentId)).questions;
      const freshById = new Map(freshQuestions.map((question) => [question.id, question]));

      // Shared-passage figures only exist on the main question source. Dedup per passageId
      // (first-wins across pages), so one passage is attached at most once per run.
      const passageFirst = new Map<string, { page: number; bbox: [number, number, number, number] }>();
      for (const entry of detected) {
        if (entry.sourceTarget !== 'question' || entry.figure.target !== 'passage' || entry.figure.passageId === null) continue;
        if (!passageFirst.has(entry.figure.passageId)) {
          passageFirst.set(entry.figure.passageId, { page: entry.page, bbox: entry.figure.bbox });
        }
      }
      for (const [passageId, { page: sourcePage, bbox }] of passageFirst) {
        try {
          await attachPassageFigure(passageId, sourcePage, bbox);
        } catch (caught) {
          firstFailure ??= caught instanceof Error ? caught.message : String(caught);
        }
      }

      const questionDetected = detected.filter(
        (entry): entry is DetectedPageFigure & {
          sourceTarget: 'question';
          figure: DetectedFigure & { target: CanvasCropTarget };
        } =>
          entry.sourceTarget === 'question' &&
          (entry.figure.target === 'question' ||
            entry.figure.target === 'option' ||
            entry.figure.target === 'answer' ||
            entry.figure.target === 'solution'),
      );
      const siblingDetected = detected.filter(
        (entry): entry is DetectedPageFigure & {
          sourceTarget: 'answer' | 'solution';
          figure: DetectedFigure & { target: 'answer' | 'solution' };
        } =>
          (entry.sourceTarget === 'answer' || entry.sourceTarget === 'solution') &&
          (entry.figure.target === 'answer' || entry.figure.target === 'solution'),
      );

      let skipped = 0;
      const byQuestion = new Map<string, typeof questionDetected>();
      for (const entry of questionDetected) {
        const question = freshById.get(entry.figure.questionId);
        if (!question) continue;
        if (hasMainCanvasFigureCrop(question, entry.page, entry.figure)) {
          skipped += 1;
          continue;
        }
        const group = byQuestion.get(question.id) ?? [];
        group.push(entry);
        byQuestion.set(question.id, group);
      }

      const total = [...byQuestion.values()].reduce((count, group) => count + group.length, 0) + siblingDetected.length;
      let done = 0;
      let attached = 0;
      let failed = preflightFailures;
      // Key by source document + page. Main-page boxes can be restored locally; sibling source panes
      // re-render from their updated question crops instead.
      const touchedPages = new Set<string>();
      const cachedByPage = new Map<number, SavedBoxSpec[]>();
      let specSeq = 0;
      setAllProgress({ phase: 'apply', done, total });
      for (const [questionId, group] of byQuestion) {
        const question = freshById.get(questionId);
        if (!question) continue;
        const stemUrls = splitUrls(question.questionImage);
        const optionImages = [...question.optionImages];
        const answerImages = [...question.answerImages];
        const explanationImages = [...question.explanationImages];
        let touchedStem = false;
        let touchedOption = false;
        let touchedAnswer = false;
        let touchedSolution = false;
        let attachedHere = 0;
        const pagesHere = new Set<string>();
        const specsHere: { sourcePage: number; spec: SavedBoxSpec }[] = [];
        for (const { page: sourcePage, sourceDocumentId, figure } of group) {
          try {
            const [x, y, w, h] = figure.bbox;
            const blob = await getCroppedBlob(questionsApi.pageImageUrl(sourceDocumentId, sourcePage), {
              x, y, width: w, height: h,
            });
            const name = `${questionId}_${figure.target}_${String(figure.optionIndex)}_${String(Math.round(x))}_${String(Math.round(y))}_${String(Date.now())}`;
            const { url } = await questionsApi.uploadImage(questionId, name, blob);
            if (figure.target === 'question') {
              stemUrls.push(url);
              touchedStem = true;
            } else if (figure.target === 'option') {
              while (optionImages.length <= figure.optionIndex) optionImages.push('');
              optionImages[figure.optionIndex] = url;
              touchedOption = true;
            } else if (figure.target === 'answer') {
              answerImages.push(url);
              touchedAnswer = true;
            } else {
              explanationImages.push(url);
              touchedSolution = true;
            }
            specsHere.push({
              sourcePage,
              spec: {
                id: `all_${questionId}_${figure.target}_${String(figure.optionIndex)}_${String(specSeq++)}`,
                questionId,
                sourcePage,
                type: figure.target,
                optionIndex: figure.optionIndex,
                label: `Q${String(questionNumberById.get(questionId) ?? '?')}${
                  figure.target === 'option'
                    ? ` · option ${String(figure.optionIndex + 1)}`
                    : figure.target === 'answer'
                      ? ' · answer figure'
                      : figure.target === 'solution'
                        ? ' · explanation figure'
                        : ''
                }`,
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
            pagesHere.add(`${sourceDocumentId}:${String(sourcePage)}`);
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
                ...(touchedAnswer ? { answerImages } : {}),
                ...(touchedSolution ? { explanationImages } : {}),
                imageCrops: [...question.imageCrops, ...specsHere.map(({ spec }) => specToCrop(spec))],
              },
            });
          });
          attached += attachedHere;
          pagesHere.forEach((sourcePage) => touchedPages.add(sourcePage));
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

      const siblingResult = await attachDetectedSiblingFigures(
        siblingDetected.map((entry) => ({
          sourceDocumentId: entry.sourceDocumentId,
          sourcePage: entry.page,
          figure: entry.figure,
        })),
        () => {
          done += 1;
          setAllProgress({ phase: 'apply', done, total });
        },
      );
      attached += siblingResult.attached;
      skipped += siblingResult.skipped;
      failed += siblingResult.failed;
      siblingResult.sourcePages.forEach((sourcePage) => touchedPages.add(sourcePage));
      firstFailure ??= siblingResult.error;

      // Stash each main-question page's new boxes for restore-on-navigation; the current page gets
      // them live now so the run's result is visible without leaving and coming back.
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
  }, [documentId, questions.data, pageCount.data, sources.answer, sources.solution, companionSource, companionTarget, patchQuestion, questionNumberById, applyBoxes, applySavedUrls, attachPassageFigure, attachDetectedSiblingFigures, rememberContinuationOwners]);

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
  }));
  // Published-bank navigation carries a question id, not display pixels. Project its persisted natural
  // source bbox into this page's fitted canvas only while the transient focus is active.
  const sourceFocus = (() => {
    if (!sourceHighlightId || !size || size.displayWidth === 0 || size.naturalWidth === 0) return null;
    const target = questionById.get(sourceHighlightId);
    if (!target || target.sourceRegion.page !== page) return null;
    const [x, y, width, height] = target.sourceRegion.bbox;
    return {
      rect: {
        x: x * (size.displayWidth / size.naturalWidth),
        y: y * (size.displayHeight / size.naturalHeight),
        width: width * (size.displayWidth / size.naturalWidth),
        height: height * (size.displayHeight / size.naturalHeight),
      },
      label: `Q${String(questionNumberById.get(target.id) ?? '?')}`,
    };
  })();
  // What the magnifier zooms into: a crop being drawn takes priority, else the box being adjusted.
  const magnifierBox: BoxRect | null =
    drawPreview ?? (activeBoxId ? boxes.find((b) => b.id === activeBoxId) ?? null : null);
  // Main-page crops take precedence while they are active; sibling previews publish the same shape
  // so Answer and Solution drawing/resizing uses this exact magnifier too.
  const activeMagnifier: SourcePreviewMagnifier | null = magnifierBox && size && size.displayWidth > 0
    ? { imageSrc, box: magnifierBox, size, label: 'Live crop preview' }
    : siblingMagnifier;
  // The main canvas is armed either for a box draw (drawLabel) or for a question-source field crop.
  const cropDrawLabel =
    cropRequest && cropRequest.source === 'question'
      ? `Crop image · Q${String(questionNumberById.get(cropRequest.questionId) ?? '?')}`
      : null;
  const mainPageTranscriptionTarget = regionTranscriptionTarget &&
    (!regionTranscriptionTarget.source || regionTranscriptionTarget.source.documentId === documentId)
    ? regionTranscriptionTarget
    : null;
  const activeDrawLabel = drawLabel ?? cropDrawLabel ?? (mainPageTranscriptionTarget ? 'Select text to transcribe' : null);
  // Cards list only the not-yet-saved manual regions (saving or needing a retry); a saved region's
  // presence in the card is its attached image, and adjustments happen on the canvas box itself.
  const cardBoxesFor = (questionId: string): CardBox[] =>
    boxes
      .filter((b): b is Box & { type: 'question' | 'option' } =>
        b.questionId === questionId &&
        b.source === 'manual' &&
        !savedUrls.has(b.id) &&
        (b.type === 'question' || b.type === 'option'),
      )
      .map((b) => ({ id: b.id, type: b.type, optionIndex: b.optionIndex, label: b.label, saving: busy.has(b.id) }));
  const cardDrawTargetFor = (questionId: string): CardDrawTarget | null =>
    drawTarget && drawTarget.questionId === questionId
      ? { type: drawTarget.type, optionIndex: drawTarget.optionIndex }
      : null;

  // Delete one question after a danger confirm: the mutation drops the staged row, its published bank
  // copy, and refreshes the counts; drop it from any pending group selection too.
  const handleDeleteQuestion = useCallback(
    async (question: Question): Promise<void> => {
      const confirmed = await confirm({
        title: 'Delete this question?',
        body: 'It is removed from this unit. If it was already published, its copy in the main bank is removed too. This cannot be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!confirmed) return;
      setSelectedIds((prev) => {
        if (!prev.has(question.id)) return prev;
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
      deleteQuestion.mutate(question.id);
    },
    [confirm, deleteQuestion],
  );

  // One question's editable card, wrapped for scroll-to/ring — shared by the standalone and the
  // grouped (comprehension) render paths so a card looks identical either way.
  const renderCard = (question: Question, nested = false): JSX.Element => (
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
        number={questionNumberById.get(question.id) ?? 1}
        draft={drafts.draftFor(question)}
        dirty={drafts.dirtyIds.has(question.id)}
        saving={drafts.savingIds.has(question.id)}
        boxes={cardBoxesFor(question.id)}
        drawTarget={cardDrawTargetFor(question.id)}
        cropDisabled={runActive}
        nested={nested}
        {...(!nested ? { selection: { checked: selectedIds.has(question.id), onChange: () => { toggleSelect(question.id); } } } : {})}
        answerSource={answerSource}
        solutionSource={solutionSource}
        inlineAnswers={inlineAnswers}
        onDraftUpdate={(updater) => { drafts.updateDraft(question.id, updater); }}
        onSave={() => { void drafts.save([question.id]); }}
        onDelete={() => { void handleDeleteQuestion(question); }}
        onRequestCrop={requestCrop}
        onDrawRegion={toggleDrawTarget}
        onSaveBox={(boxId) => { void requestSave(boxId); }}
        onDeleteBox={deleteBox}
        onTranscribeRegion={armRegionTranscription}
        transcribingRegion={regionTranscriptionBusy || regionTranscriptionTarget !== null}
      />
    </div>
  );

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
          {visibleViews.has('question') ? (
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
              disabled={aiBusy || allProgress !== null || siblingDetecting.size > 0 || !size}
              onClick={() => { void detectCurrentPage(); }}
            />
            <IconButton
              icon={allProgress ? <Spinner /> : <IconLayers />}
              label="Detect figures across all pages"
              disabled={aiBusy || allProgress !== null || siblingDetecting.size > 0}
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
          ) : null}

        {visibleViews.has('question') ? (
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
            onDrawCancel={() => {
              setDrawTarget(null);
              cancelCropRequest();
              regionTranscriptionTargetRef.current = null;
              setRegionTranscriptionTarget(null);
            }}
            onBoxGrab={handleBoxGrab}
            onBoxRelease={handleBoxRelease}
            focus={sourceFocus}
          />
          </div>
        ) : null}

        {companionSource && (visibleViews.has('answer') || visibleViews.has('solution')) ? (
          <SourcePreviewPane
            title="Answer + Explanation"
            tone={companionTarget === 'answer' ? 'answer' : 'solution'}
            documentId={companionSource.document.id}
            fileName={companionSource.document.fileName}
            defaultPage={companionSource.defaultPage}
            transcription={transcriptionForSource(companionSource)}
            crop={{
              armed: cropRequest?.source === 'answer' || cropRequest?.source === 'solution',
              onCrop: (imageUrl, natural, sourcePage) => { void fulfilCrop(imageUrl, natural, sourcePage); },
              onCancel: cancelCropRequest,
              existingCrops: [...answerPreviewCrops, ...solutionPreviewCrops].map((item) => ({
                id: item.id,
                url: item.crop.url,
                rect: { x: item.crop.nx, y: item.crop.ny, width: item.crop.nw, height: item.crop.nh },
                page: item.page,
                label: item.label,
              })),
              onExistingCrop: (id, replacedUrl, imageUrl, natural, sourcePage) => {
                const target = [...answerPreviewCrops, ...solutionPreviewCrops].find((item) => item.id === id);
                const type = target?.crop.type;
                if (!target || (type !== 'answer' && type !== 'solution')) return null;
                return replacePreviewCrop(
                  target.questionId,
                  type,
                  replacedUrl,
                  companionSource.document.id,
                  imageUrl,
                  natural,
                  sourcePage,
                );
              },
            }}
            detection={{
              busy: aiBusy || allProgress !== null || siblingDetecting.size > 0,
              label: `Auto-detect ${companionTarget === 'answer' ? 'answer' : 'explanation'} figures on this page`,
              onDetect: (sourcePage) => {
                void detectSiblingPage(companionTarget, companionSource.document.id, sourcePage);
              },
            }}
            destination={{ target: companionTarget, onTargetChange: setCompanionTarget }}
            onPageChange={(sourcePage) => { rememberSourcePage(companionSource, sourcePage); }}
            onMagnifierChange={setSiblingMagnifier}
          />
        ) : null}
        {!companionSource && visibleViews.has('answer') && sources.answer ? (
          <SourcePreviewPane
            title="Answer"
            tone="answer"
            documentId={sources.answer.document.id}
            fileName={sources.answer.document.fileName}
            defaultPage={sources.answer.defaultPage}
            transcription={transcriptionForSource(sources.answer)}
            crop={{
              armed: cropRequest?.source === 'answer',
              onCrop: (imageUrl, natural, sourcePage) => { void fulfilCrop(imageUrl, natural, sourcePage); },
              onCancel: cancelCropRequest,
              existingCrops: answerPreviewCrops.map((item) => ({
                id: item.id,
                url: item.crop.url,
                rect: { x: item.crop.nx, y: item.crop.ny, width: item.crop.nw, height: item.crop.nh },
                page: item.page,
                label: item.label,
              })),
              onExistingCrop: (id, replacedUrl, imageUrl, natural, sourcePage) => {
                const target = answerPreviewCrops.find((item) => item.id === id);
                const sourceDocumentId = sources.answer?.document.id;
                if (!target || !sourceDocumentId) return null;
                return replacePreviewCrop(
                  target.questionId,
                  'answer',
                  replacedUrl,
                  sourceDocumentId,
                  imageUrl,
                  natural,
                  sourcePage,
                );
              },
            }}
            detection={{
              busy: aiBusy || allProgress !== null || siblingDetecting.size > 0,
              onDetect: (sourcePage) => {
                const source = sources.answer;
                if (source) void detectSiblingPage('answer', source.document.id, sourcePage);
              },
            }}
            onPageChange={(sourcePage) => { rememberSourcePage(sources.answer as VerifySibling, sourcePage); }}
            onMagnifierChange={setSiblingMagnifier}
          />
        ) : null}
        {!companionSource && visibleViews.has('solution') && sources.solution ? (
          <SourcePreviewPane
            title="Solution"
            tone="solution"
            documentId={sources.solution.document.id}
            fileName={sources.solution.document.fileName}
            defaultPage={sources.solution.defaultPage}
            transcription={transcriptionForSource(sources.solution)}
            crop={{
              armed: cropRequest?.source === 'solution',
              onCrop: (imageUrl, natural, sourcePage) => { void fulfilCrop(imageUrl, natural, sourcePage); },
              onCancel: cancelCropRequest,
              existingCrops: solutionPreviewCrops.map((item) => ({
                id: item.id,
                url: item.crop.url,
                rect: { x: item.crop.nx, y: item.crop.ny, width: item.crop.nw, height: item.crop.nh },
                page: item.page,
                label: item.label,
              })),
              onExistingCrop: (id, replacedUrl, imageUrl, natural, sourcePage) => {
                const target = solutionPreviewCrops.find((item) => item.id === id);
                const sourceDocumentId = sources.solution?.document.id;
                if (!target || !sourceDocumentId) return null;
                return replacePreviewCrop(
                  target.questionId,
                  'solution',
                  replacedUrl,
                  sourceDocumentId,
                  imageUrl,
                  natural,
                  sourcePage,
                );
              },
            }}
            detection={{
              busy: aiBusy || allProgress !== null || siblingDetecting.size > 0,
              onDetect: (sourcePage) => {
                const source = sources.solution;
                if (source) void detectSiblingPage('solution', source.document.id, sourcePage);
              },
            }}
            onPageChange={(sourcePage) => { rememberSourcePage(sources.solution as VerifySibling, sourcePage); }}
            onMagnifierChange={setSiblingMagnifier}
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
            {sessionBar ? <div className="verify__session-row">{typeof sessionBar === 'function'
              ? sessionBar(drafts.dirtyIds.size + passageDrafts.dirtyIds.size > 0, drafts.isSaving || passageDrafts.isSaving, focusQuestionInWorkspace)
              : sessionBar}</div> : null}
            <div className="verify__session-row" hidden={viewModes.length <= 1 && !(publishIssues.data?.issues.length)}>
              {viewModes.length > 1 ? (
                <>
                  <span className="text-sm text-ink-2">View</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5" role="group" aria-label="Visible source previews">
                    {viewModes.map((option) => {
                      const missing =
                        (option.needs === 'answer' && !sources.answer) ||
                        (option.needs === 'solution' && !sources.solution);
                      return (
                        <label
                          key={option.mode}
                          className={`inline-flex items-center gap-1.5 text-sm ${missing ? 'cursor-not-allowed text-ink-3' : 'cursor-pointer text-ink'}`}
                          title={missing ? `No ${option.needs ?? ''} PDF attached to this unit` : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={visibleViews.has(option.mode)}
                            disabled={missing || (visibleViews.has(option.mode) && visibleViews.size === 1)}
                            onChange={() => { toggleView(option.mode); }}
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <PublishIssueActions
                issues={publishIssues.data?.issues ?? []}
                onNavigateToQuestion={focusQuestionInWorkspace}
              />
            </div>
            <div className="verify__session-row">
              <span className="text-sm text-ink-2">
                {drafts.dirtyIds.size + passageDrafts.dirtyIds.size > 0
                  ? `${String(drafts.dirtyIds.size + passageDrafts.dirtyIds.size)} item(s) with unsaved edits`
                  : 'All edits saved'}
              </span>
              <Button
                size="xs"
                className="ml-auto flex-none"
                disabled={
                  drafts.dirtyIds.size + passageDrafts.dirtyIds.size === 0 ||
                  drafts.isSaving ||
                  passageDrafts.isSaving
                }
                onClick={() => {
                  void drafts.save([...drafts.dirtyIds]);
                  void passageDrafts.save([...passageDrafts.dirtyIds]);
                }}
              >
                {drafts.isSaving || passageDrafts.isSaving ? (
                  <><Spinner /> Saving…</>
                ) : (
                  `Update all${
                    drafts.dirtyIds.size + passageDrafts.dirtyIds.size > 0
                      ? ` (${String(drafts.dirtyIds.size + passageDrafts.dirtyIds.size)})`
                      : ''
                  }`
                )}
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
          {activeMagnifier ? (
            <CropMagnifier
              imageSrc={activeMagnifier.imageSrc}
              box={activeMagnifier.box}
              size={activeMagnifier.size}
              label={activeMagnifier.label}
            />
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
              ? `No figures detected on this ${aiResult.sourceLabel?.toLowerCase() ?? 'question'} page.`
              : aiResult.skipped > 0
                ? `Detected ${String(aiResult.detected)} ${aiResult.sourceLabel?.toLowerCase() ?? 'question'} figure(s); ${String(aiResult.skipped)} already have an image and were skipped.`
                : `Detected ${String(aiResult.detected)} ${aiResult.sourceLabel?.toLowerCase() ?? 'question'} figure(s).`}
          </p>
        ) : null}

        {continuationQuestionIds.size > 0 ? (
          <p className="note">Showing question cards continued from the previous page.</p>
        ) : null}

        {onThisPage.length === 0 ? (
          <EmptyState
            icon={<IconFileText />}
            title="No questions on this page"
            body="Use the page arrows above the source page to move to a page with extracted questions."
          />
        ) : (
          renderItems.map((item) =>
            item.kind === 'single' ? (
              <div key={item.question.id} className="min-w-0">{renderCard(item.question)}</div>
            ) : (
              // ONE card for the whole comprehension: the passage on top, then its sub-questions
              // nested inside (flattened cards, divider-separated).
              <div
                key={`group_${item.passageId}`}
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
              >
                <ComprehensionGroupPanel
                  documentId={documentId}
                  passageId={item.passageId}
                  count={item.questions.length}
                  passage={passageDrafts.textFor(item.passageId)}
                  passageImage={passageById.get(item.passageId)?.passageImage ?? null}
                  dirty={passageDrafts.dirtyIds.has(item.passageId)}
                  disabled={runActive}
                  onPassageChange={(value) => { passageDrafts.setText(item.passageId, value); }}
                  onReExtracted={(result) => { applyGroupReExtract(item.passageId, item.questions, result); }}
                  onUngroup={() => { ungroupMutation.mutate(item.passageId); }}
                  onRequestCrop={() => requestCrop(item.passageId, 'question')}
                  onImageChange={(url) => {
                    void passageImageUpdate.mutateAsync({ id: item.passageId, patch: { passageImage: url } });
                  }}
                />
                {item.questions.map((question) => (
                  <div key={question.id} className="border-t border-line pt-3">
                    {renderCard(question, true)}
                  </div>
                ))}
              </div>
            ),
          )
        )}
        {orderedSelection.length >= 1 ? (
          <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-lg">
            <span className="text-sm text-ink-2">{orderedSelection.length} selected</span>
            <Button size="xs" disabled={groupMutation.isPending} onClick={groupSelected}>
              {groupMutation.isPending ? <><Spinner /> Grouping…</> : 'Group into comprehension'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => { setSelectedIds(new Set()); }}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
      {confirmDialog}
    </div>
  );
}
