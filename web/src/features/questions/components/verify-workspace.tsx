import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DetectedFigure, Question } from '@ingest/contracts';
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
  IconUndo,
  IconX,
  LoadingState,
  Spinner,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarHelp,
  ToolbarSpacer,
} from '../../../shared/ui/index.js';
import { type CardBox, type CardDrawTarget, EditableQuestionCard } from './editable-question-card.js';

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

/** One in-flight auto-save per box; `again` re-runs it with the latest rect once the current pass ends. */
type SaveRun = { again: boolean; done: Promise<void> };

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
type AllPagesSummary = { attached: number; skipped: number; pages: number; failed: number };

function allPagesSummaryText(s: AllPagesSummary): string {
  if (s.attached === 0 && s.skipped === 0 && s.failed === 0) {
    return 'No figures detected across the document.';
  }
  const parts = [
    `Attached ${String(s.attached)} figure${s.attached === 1 ? '' : 's'} across ${String(s.pages)} page${s.pages === 1 ? '' : 's'}.`,
  ];
  if (s.skipped > 0) parts.push(`${String(s.skipped)} skipped (already had an image).`);
  if (s.failed > 0) parts.push(`${String(s.failed)} failed — re-run or crop manually.`);
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
 * A live preview of what a crop box currently covers: a fixed-size window into the page image,
 * scaled so the box region fills it. Derives everything from the box's display coords + the page's
 * natural↔display size, so it tracks the box as it is dragged/resized (no canvas work).
 */
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
  const scaleX = size.naturalWidth / size.displayWidth;
  const scaleY = size.naturalHeight / size.displayHeight;
  const bw = Math.max(1, box.width * scaleX);
  const bh = Math.max(1, box.height * scaleY);
  const k = Math.min(THUMB_W / bw, THUMB_H / bh);
  const offsetX = (THUMB_W - bw * k) / 2 - box.x * scaleX * k;
  const offsetY = (THUMB_H - bh * k) / 2 - box.y * scaleY * k;
  return (
    <div
      className="crop-thumb"
      style={{
        backgroundImage: `url("${imageSrc}")`,
        backgroundSize: `${String(size.naturalWidth * k)}px ${String(size.naturalHeight * k)}px`,
        backgroundPosition: `${String(offsetX)}px ${String(offsetY)}px`,
      }}
    />
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
}: {
  documentId: string;
  autoRun?: boolean;
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
  });

  const [page, setPage] = useState(1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  /** boxId → the image URL its last successful save attached to the question. */
  const [savedUrls, setSavedUrls] = useState<ReadonlyMap<string, string>>(new Map());
  /** Boxes whose last auto-save failed — the card offers a manual Save retry for these. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

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

  const goToPage = (next: number): void => {
    applyBoxes(() => []);
    past.current = [];
    future.current = [];
    applySavedUrls(() => new Map());
    setFailed(new Set());
    setDrawTarget(null);
    setAiResult(null);
    setAiError(null);
    setPage(next);
  };

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
    if (box.type === 'question') {
      const urls = splitUrls(question.questionImage);
      if (!urls.includes(url)) return;
      const kept = urls.filter((u) => u !== url);
      await patchQuestion({ id: question.id, patch: { questionImage: kept.length > 0 ? kept.join(',') : null } });
    } else if ((question.optionImages[box.optionIndex] ?? '') === url) {
      const optionImages = [...question.optionImages];
      optionImages[box.optionIndex] = '';
      await patchQuestion({ id: question.id, patch: { optionImages } });
    }
  };

  /**
   * Attach an uploaded crop to its question — runs on the question's write queue. Re-checks that the
   * box still exists (right-click delete is the undo path and may land while the upload or the PATCH
   * itself is in flight): a deleted box's crop is never attached, and one deleted mid-PATCH is
   * detached straight back off.
   */
  const attachCrop = async (box: Box, url: string): Promise<void> => {
    if (!boxesRef.current.some((b) => b.id === box.id)) return;
    const question = readQuestion(box.questionId);
    if (!question) return;
    const previousUrl = savedUrlsRef.current.get(box.id);
    if (box.type === 'question') {
      const urls = splitUrls(question.questionImage);
      const at = previousUrl ? urls.indexOf(previousUrl) : -1;
      if (at >= 0) urls[at] = url;
      else urls.push(url);
      await patchQuestion({ id: question.id, patch: { isQuestionImage: true, questionImage: urls.join(',') } });
    } else {
      const optionImages = [...question.optionImages];
      while (optionImages.length <= box.optionIndex) optionImages.push('');
      optionImages[box.optionIndex] = url;
      await patchQuestion({ id: question.id, patch: { isOptionImage: true, optionImages } });
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
      const blob = await getCroppedBlob(imageSrcRef.current, {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      });
      // Fresh storage key per save: the store upserts by key and serves cached URLs, so re-using a
      // key on re-crop would keep the stale image visible everywhere. A new key = a new URL.
      const { url } = await questionsApi.uploadImage(box.questionId, `${boxId}_${String(Date.now())}`, blob);
      await enqueueQuestionWrite(box.questionId, () => attachCrop(box, url));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setFailed((prev) => new Set(prev).add(boxId));
    } finally {
      markBusy(boxId, false);
    }
  };

  /**
   * Save a box, serialised per box: at most one upload in flight, and adjustments made while one is
   * running coalesce into a single follow-up save of the final rect (the "debounce on release").
   */
  const requestSave = (boxId: string): Promise<void> => {
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

  // --- Adjust-to-resave: one history entry per grab, one (coalesced) save per release. ---
  const grabbed = useRef<Box[] | null>(null);
  const handleBoxGrab = (): void => {
    grabbed.current = boxesRef.current;
  };
  const handleBoxRelease = (id: string, moved: boolean): void => {
    if (moved && grabbed.current) {
      past.current = [...past.current, grabbed.current];
      future.current = [];
      forceHistory((n) => n + 1);
    }
    grabbed.current = null;
    if (!moved) return;
    // Saved boxes re-crop on release; a box whose save failed (or is mid-flight) retries the same way.
    // Unconfirmed AI suggestions stay unsaved until Confirm.
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

  // --- AI detection: mark the current page's figures for review, never auto-save. ---
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
      // Replace any earlier unconfirmed AI suggestions on this page; confirmed + manual boxes stay.
      commit((prev) => [...prev.filter((b) => b.source !== 'ai' || savedUrlsRef.current.has(b.id)), ...placed]);
      setAiResult({ detected: figures.length, placed: placed.length, skipped });
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
   * an image. Saves are grouped per question so one patch carries all of its new images; sequential
   * patches built from the same stale snapshot would clobber one another's optionImages. Afterwards
   * the operator only reviews and touches up, instead of driving the document page by page.
   */
  const detectAllPages = useCallback(async (): Promise<void> => {
    const pagesWithQuestions = [
      ...new Set((questions.data ?? []).map((q) => q.sourceRegion.page)),
    ].sort((a, b) => a - b);
    if (pagesWithQuestions.length === 0) return;
    setAiError(null);
    setAiResult(null);
    setAllSummary(null);
    setAllProgress({ phase: 'detect', done: 0, total: pagesWithQuestions.length });
    try {
      const detected: { page: number; figure: DetectedFigure }[] = [];
      for (let start = 0; start < pagesWithQuestions.length; start += DETECT_FIGURES_MAX_PAGES) {
        const chunk = pagesWithQuestions.slice(start, start + DETECT_FIGURES_MAX_PAGES);
        const { pages: results } = await questionsApi.detectFiguresBatch(documentId, chunk);
        for (const result of results) {
          for (const figure of result.figures) detected.push({ page: result.page, figure });
        }
        setAllProgress({
          phase: 'detect',
          done: Math.min(start + chunk.length, pagesWithQuestions.length),
          total: pagesWithQuestions.length,
        });
      }

      let skipped = 0;
      const byQuestion = new Map<string, { page: number; figure: DetectedFigure }[]>();
      for (const entry of detected) {
        const question = questionById.get(entry.figure.questionId);
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
      let firstFailure: string | null = null;
      const touchedPages = new Set<number>();
      setAllProgress({ phase: 'apply', done, total });
      for (const [questionId, group] of byQuestion) {
        const question = questionById.get(questionId);
        if (!question) continue;
        const stemUrls = splitUrls(question.questionImage);
        const optionImages = [...question.optionImages];
        let touchedStem = false;
        let touchedOption = false;
        let attachedHere = 0;
        const pagesHere = new Set<number>();
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
              },
            });
          });
          attached += attachedHere;
          for (const touched of pagesHere) touchedPages.add(touched);
        } catch (caught) {
          failed += attachedHere;
          firstFailure ??= caught instanceof Error ? caught.message : String(caught);
        }
      }
      setAllSummary({ attached, skipped, pages: touchedPages.size, failed });
      setError(firstFailure);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAllProgress(null);
    }
  }, [documentId, questions.data, questionById, patchQuestion]);

  // Auto-detect once on arrival when the session pushed us here with ?auto=1 (still only marks).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoRun && !autoStarted.current && size && questions.isSuccess && questions.data.length > 0) {
      autoStarted.current = true;
      void detectCurrentPage();
    }
  }, [autoRun, size, questions.isSuccess, questions.data, detectCurrentPage]);

  const pendingAi = boxes.filter((b) => b.source === 'ai' && !savedUrls.has(b.id));
  const confirmBox = (boxId: string): void => { void requestSave(boxId); };
  const confirmAll = async (): Promise<void> => {
    // Saves of the same question are serialised on its write queue and each one re-reads the fresh
    // record, so several crops into one question can never clobber one another's option/stem image.
    for (const box of pendingAi) {
      await requestSave(box.id);
    }
  };
  const discardAll = (): void => {
    commit((prev) => prev.filter((b) => b.source !== 'ai' || savedUrlsRef.current.has(b.id)));
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
    <div className="verify">
      <div className="verify__canvas">
        <Toolbar ariaLabel="Source page tools">
          <ToolbarGroup>
            <IconButton
              icon={<IconChevronLeft />}
              label="Previous page"
              disabled={page <= 1}
              onClick={() => { goToPage(page - 1); }}
            />
            <span className="tbar__count">Page {page} / {totalPages}</span>
            <IconButton
              icon={<IconChevronRight />}
              label="Next page"
              disabled={page >= totalPages}
              onClick={() => { goToPage(page + 1); }}
            />
          </ToolbarGroup>

          <ToolbarDivider />

          <ToolbarGroup>
            <IconButton icon={<IconUndo />} label="Undo" disabled={past.current.length === 0} onClick={undo} />
            <IconButton icon={<IconRedo />} label="Redo" disabled={future.current.length === 0} onClick={redo} />
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              title="Remove every box on this page (saved crops stay attached)"
              disabled={boxes.length === 0}
              onClick={() => { commit(() => []); }}
            >
              Clear
            </button>
          </ToolbarGroup>

          <ToolbarSpacer />

          <ToolbarGroup>
            <Button
              size="xs"
              disabled={aiBusy || allProgress !== null || !size}
              onClick={() => { void detectCurrentPage(); }}
            >
              {aiBusy ? <><Spinner /> Detecting…</> : <><IconSparkle /> Auto-detect figures</>}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={aiBusy || allProgress !== null}
              onClick={() => { void detectAllPages(); }}
            >
              {allProgress ? <><Spinner /> Working…</> : <><IconLayers /> Detect all pages</>}
            </Button>
            <ToolbarHelp>
              <b>Add region</b> on a question, then draw — the crop uploads and attaches by itself.
              <b> Drag</b> a box or its <b>handles</b> to adjust; a saved (green) box re-saves on
              release. <b>Right-click</b> removes a box — a saved box&rsquo;s image is detached too.
              <b> Auto-detect</b> only marks AI suggestions; nothing saves until you Confirm.
              <b> Detect all pages</b> detects and attaches figures across the whole document in one
              run, skipping targets that already have an image — review the cards afterwards.
            </ToolbarHelp>
          </ToolbarGroup>
        </Toolbar>

        <div className="verify__stage">
          <CropCanvas
            imageSrc={imageSrc}
            boxes={canvasBoxes}
            onUpdateBox={updateBox}
            onDeleteBox={deleteBox}
            onSize={handleSize}
            draw={drawLabel !== null ? { label: drawLabel } : null}
            onDraw={handleDraw}
            onDrawCancel={() => { setDrawTarget(null); }}
            onBoxGrab={handleBoxGrab}
            onBoxRelease={handleBoxRelease}
          />
        </div>
      </div>

      <div className="verify__panel">
        <div className="sticky top-0 z-10 flex flex-none items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
          <span className="text-sm text-ink-2">
            {drafts.dirtyIds.size > 0
              ? `${String(drafts.dirtyIds.size)} question(s) with unsaved edits`
              : 'All edits saved'}
          </span>
          <Button
            size="xs"
            disabled={drafts.dirtyIds.size === 0 || drafts.isSaving}
            onClick={() => { void drafts.save([...drafts.dirtyIds]); }}
          >
            {drafts.isSaving
              ? <><Spinner /> Saving…</>
              : `Update all${drafts.dirtyIds.size > 0 ? ` (${String(drafts.dirtyIds.size)})` : ''}`}
          </Button>
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

        {pendingAi.length > 0 ? (
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                Review {pendingAi.length} AI crop{pendingAi.length === 1 ? '' : 's'}
              </h2>
              <div className="row">
                <Button size="xs" onClick={() => { void confirmAll(); }}>
                  <IconCheck /> Confirm all
                </Button>
                <Button variant="ghost" size="xs" onClick={discardAll}>
                  <IconX /> Discard all
                </Button>
              </div>
            </div>
            <ul className="ai-review__list">
              {pendingAi.map((b) => {
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
                      <Button size="xs" disabled={busy.has(b.id)} onClick={() => { confirmBox(b.id); }}>
                        {busy.has(b.id) ? 'Saving…' : <><IconCheck /> Confirm</>}
                      </Button>
                      <IconButton
                        icon={<IconX />}
                        label="Discard this suggestion"
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
                onDraftChange={(draft) => { drafts.setDraft(question.id, draft); }}
                onSave={() => { void drafts.save([question.id]); }}
                onDrawRegion={toggleDrawTarget}
                onSaveBox={(boxId) => { void requestSave(boxId); }}
                onDeleteBox={deleteBox}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
