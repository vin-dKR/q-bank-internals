import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { useDocument } from '../../documents/index.js';
import { questionsApi } from '../api/questions.api.js';
import { usePageCount, useQuestions, useUpdateQuestion } from '../hooks/use-questions.js';
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
import { type CardBox, EditableQuestionCard } from './editable-question-card.js';

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

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

function hasQuestionImage(question: Question): boolean {
  return (question.questionImage ?? '').trim().length > 0;
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
 * The Verify crop workspace: left is the source page (zoomable) with crop regions; right is an editable
 * card per question. Two ways to make a crop, both ending in the same upload+save:
 *  - Manual — draw a draggable box and crop it (the human fallback, unchanged).
 *  - AI — "Auto-detect figures" asks the model to locate each question's diagram and drops the results
 *    on the page as MARKED boxes. Nothing is saved until you Confirm each (or Confirm all); Discard
 *    drops a suggestion without ever touching the database. AI boxes are draggable, so a slightly-off
 *    box can be nudged before confirming.
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
  const update = useUpdateQuestion();
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

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ detected: number; placed: number; skipped: number } | null>(null);

  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  // The fitted page size can change when the column resizes; keep drawn boxes aligned by rescaling
  // their (display-pixel) coordinates by the same ratio, so a crop still points at the same region.
  const sizeRef = useRef<CanvasSize | null>(null);
  const handleSize = useCallback((next: CanvasSize): void => {
    const prev = sizeRef.current;
    if (prev && prev.displayWidth > 0 && next.displayWidth > 0 &&
      (prev.displayWidth !== next.displayWidth || prev.displayHeight !== next.displayHeight)) {
      const rx = next.displayWidth / prev.displayWidth;
      const ry = next.displayHeight / prev.displayHeight;
      setBoxes((bs) => bs.map((b) => ({ ...b, x: b.x * rx, y: b.y * ry, width: b.width * rx, height: b.height * ry })));
    }
    sizeRef.current = next;
    setSize(next);
  }, []);
  const past = useRef<Box[][]>([]);
  const future = useRef<Box[][]>([]);
  const [, forceHistory] = useState(0);
  const commit = (updater: (prev: Box[]) => Box[]): void => {
    past.current = [...past.current, boxesRef.current];
    future.current = [];
    setBoxes(updater(boxesRef.current));
    forceHistory((n) => n + 1);
  };
  const undo = (): void => {
    const prev = past.current.at(-1);
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [boxesRef.current, ...future.current];
    setBoxes(prev);
    forceHistory((n) => n + 1);
  };
  const redo = (): void => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, boxesRef.current];
    setBoxes(next);
    forceHistory((n) => n + 1);
  };

  const imageSrc = questionsApi.pageImageUrl(documentId, page);
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
    setBoxes([]);
    past.current = [];
    future.current = [];
    setAiResult(null);
    setAiError(null);
    setPage(next);
  };

  const addBox = (question: Question, type: 'question' | 'option', optionIndex = 0): void => {
    const id = `${question.id}_${type}_${String(optionIndex)}_${String(Date.now())}`;
    commit((prev) => [
      ...prev,
      {
        id,
        questionId: question.id,
        type,
        optionIndex,
        source: 'manual',
        label: `p${String(question.sourceRegion.page)}·${type}`,
        x: 48,
        y: 48,
        width: 220,
        height: 160,
      },
    ]);
  };
  const updateBox = (id: string, rect: Partial<BoxRect>): void => {
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...rect } : b)));
  };
  const deleteBox = (id: string): void => {
    commit((prev) => prev.filter((b) => b.id !== id));
  };
  const markBusy = (id: string, on: boolean): void => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const cropAndSave = async (box: Box, question: Question): Promise<void> => {
    if (!size || size.displayWidth === 0) return;
    setError(null);
    markBusy(box.id, true);
    try {
      const scaleX = size.naturalWidth / size.displayWidth;
      const scaleY = size.naturalHeight / size.displayHeight;
      const blob = await getCroppedBlob(imageSrc, {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      });
      const { url } = await questionsApi.uploadImage(question.id, box.id, blob);
      if (box.type === 'question') {
        const urls = [...splitUrls(question.questionImage), url];
        await update.mutateAsync({ id: question.id, patch: { isQuestionImage: true, questionImage: urls.join(',') } });
      } else {
        const optionImages = [...question.optionImages];
        while (optionImages.length <= box.optionIndex) optionImages.push('');
        optionImages[box.optionIndex] = url;
        await update.mutateAsync({ id: question.id, patch: { isOptionImage: true, optionImages } });
      }
      deleteBox(box.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      markBusy(box.id, false);
    }
  };

  const cropSaveById = (boxId: string): void => {
    const box = boxes.find((b) => b.id === boxId);
    const question = (questions.data ?? []).find((q) => q.id === box?.questionId);
    if (box && question) void cropAndSave(box, question);
  };

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
      const alreadyHasImage = new Set(
        (questions.data ?? []).filter(hasQuestionImage).map((q) => `${q.id}:question:0`),
      );
      for (const question of questions.data ?? []) {
        question.optionImages.forEach((url, optionIndex) => {
          if (url.trim()) alreadyHasImage.add(`${question.id}:option:${String(optionIndex)}`);
        });
      }
      let skipped = 0;
      const placed: Box[] = [];
      figures.forEach((figure, index) => {
        const imageKey = `${figure.questionId}:${figure.target}:${String(figure.optionIndex)}`;
        if (alreadyHasImage.has(imageKey)) {
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
      // Replace any earlier AI suggestions on this page; leave manual boxes untouched.
      commit((prev) => [...prev.filter((b) => b.source !== 'ai'), ...placed]);
      setAiResult({ detected: figures.length, placed: placed.length, skipped });
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiBusy(false);
    }
    // commit/questionNumberById are stable enough; guarded single-run via effect below for autoRun.
  }, [documentId, page, size, questions.data, questionNumberById]);

  // Auto-detect once on arrival when the session pushed us here with ?auto=1 (still only marks).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoRun && !autoStarted.current && size && questions.isSuccess && questions.data.length > 0) {
      autoStarted.current = true;
      void detectCurrentPage();
    }
  }, [autoRun, size, questions.isSuccess, questions.data, detectCurrentPage]);

  const pendingAi = boxes.filter((b) => b.source === 'ai');
  const confirmBox = (boxId: string): void => { cropSaveById(boxId); };
  const confirmAll = async (): Promise<void> => {
    for (const box of pendingAi) {
      const question = (questions.data ?? []).find((q) => q.id === box.questionId);
      if (question) await cropAndSave(box, question);
    }
  };
  const discardAll = (): void => {
    commit((prev) => prev.filter((b) => b.source !== 'ai'));
  };

  const canvasBoxes: CanvasBox[] = boxes.map((b) => ({
    id: b.id,
    label: b.label,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    variant: b.source,
  }));
  const cardBoxesFor = (questionId: string): CardBox[] =>
    boxes
      .filter((b) => b.questionId === questionId && b.source === 'manual')
      .map((b) => ({ id: b.id, type: b.type, optionIndex: b.optionIndex, label: b.label }));

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
              title="Remove every box on this page"
              disabled={boxes.length === 0}
              onClick={() => { commit(() => []); }}
            >
              Clear
            </button>
          </ToolbarGroup>

          <ToolbarSpacer />

          <ToolbarGroup>
            <Button size="xs" disabled={aiBusy || !size} onClick={() => { void detectCurrentPage(); }}>
              {aiBusy ? <><Spinner /> Detecting…</> : <><IconSparkle /> Auto-detect figures</>}
            </Button>
            <ToolbarHelp>
              <b>Auto-detect</b> marks each question&rsquo;s diagram on this page for review — nothing
              is saved until you Confirm. Boxes: <b>drag</b> to move · <b>handles</b> to resize ·{' '}
              <b>right-click</b> to delete.
            </ToolbarHelp>
          </ToolbarGroup>
        </Toolbar>

        <div className="verify__stage">
          <CropCanvas imageSrc={imageSrc} boxes={canvasBoxes} onUpdateBox={updateBox} onDeleteBox={deleteBox} onSize={handleSize} />
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
                busyBoxIds={busy}
                onDraftChange={(draft) => { drafts.setDraft(question.id, draft); }}
                onSave={() => { void drafts.save([question.id]); }}
                onAddBox={addBox}
                onCropSave={cropSaveById}
                onDeleteBox={deleteBox}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
