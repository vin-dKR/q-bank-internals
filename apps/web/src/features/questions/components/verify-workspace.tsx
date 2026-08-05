import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { useDocument } from '../../documents/index.js';
import { questionsApi } from '../api/questions.api.js';
import { usePageCount, useQuestions, useUpdateQuestion } from '../hooks/use-questions.js';
import { type BoxRect, type CanvasBox, type CanvasSize, CropCanvas } from '../../../shared/ui/index.js';
import { type CardBox, EditableQuestionCard } from './editable-question-card.js';

type Box = BoxRect & {
  id: string;
  questionId: string;
  type: 'question' | 'option';
  optionIndex: number;
  label: string;
  /** `ai` = an unconfirmed AI suggestion (marked, not yet saved); `manual` = drawn by the user. */
  source: 'manual' | 'ai';
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

function hasQuestionImage(question: Question): boolean {
  return (question.questionImage ?? '').trim().length > 0;
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

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ detected: number; placed: number; skipped: number } | null>(null);

  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
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
  // Card ordering on the right is 1..N in reading order; label AI boxes/rows with the same number.
  const cardNumberById = useMemo(() => {
    const map = new Map<string, number>();
    onThisPage.forEach((q, index) => map.set(q.id, index + 1));
    return map;
  }, [onThisPage]);

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
        (questions.data ?? []).filter(hasQuestionImage).map((q) => q.id),
      );
      let skipped = 0;
      const placed: Box[] = [];
      figures.forEach((figure, index) => {
        if (alreadyHasImage.has(figure.questionId)) {
          skipped += 1;
          return;
        }
        const [x, y, w, h] = figure.bbox;
        placed.push({
          id: `${figure.questionId}_ai_${String(page)}_${String(index)}`,
          questionId: figure.questionId,
          type: 'question',
          optionIndex: 0,
          source: 'ai',
          label: `✨ Q${String(cardNumberById.get(figure.questionId) ?? '?')}`,
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
    // commit/cardNumberById are stable enough; guarded single-run via effect below for autoRun.
  }, [documentId, page, size, questions.data, cardNumberById]);

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

  if (questions.isPending) return <p className="muted">Loading questions…</p>;
  if (questions.isError) return <p className="error">Could not load questions.</p>;
  if (questions.data.length === 0) {
    return <p className="muted">No questions yet — run extraction on this document first.</p>;
  }

  const totalPages = pageCount.data ?? 1;
  const setZoomClamped = (next: number): void =>
    { setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100))); };

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong>AI figure auto-crop</strong>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Detect each question&rsquo;s diagram on this page. The results are marked on the page for
              you to review — nothing is saved until you <strong>Confirm</strong>.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={aiBusy || !size}
            onClick={() => { void detectCurrentPage(); }}
          >
            {aiBusy ? 'Detecting…' : '✨ Auto-detect figures'}
          </button>
        </div>

        {aiError ? <p className="error">{aiError}</p> : null}
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
          <div className="ai-review">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>Review {pendingAi.length} AI crop(s)</strong>
              <div className="row">
                <button type="button" className="btn btn--xs btn--primary" onClick={() => { void confirmAll(); }}>
                  ✔ Confirm all
                </button>
                <button type="button" className="btn btn--xs" onClick={discardAll}>✖ Discard all</button>
              </div>
            </div>
            <ul className="ai-review__list">
              {pendingAi.map((b) => (
                <li key={b.id} className="ai-review__item">
                  <span className="ai-review__label">✨ Q{cardNumberById.get(b.questionId) ?? '?'}</span>
                  <span className="muted" style={{ flex: 1 }}>
                    marked on the page — adjust the box if needed, then confirm.
                  </span>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn--xs btn--primary"
                      disabled={busy.has(b.id)}
                      onClick={() => { confirmBox(b.id); }}
                    >
                      {busy.has(b.id) ? 'Saving…' : '✔ Confirm'}
                    </button>
                    <button type="button" className="btn btn--xs" onClick={() => { deleteBox(b.id); }}>
                      ✖ Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="verify">
        <div className="verify__canvas">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <strong>Source page</strong>
            <div className="row">
              <button type="button" className="btn btn--xs" disabled={zoom <= ZOOM_MIN} onClick={() => { setZoomClamped(zoom - ZOOM_STEP); }}>−</button>
              <button type="button" className="btn btn--xs" onClick={() => { setZoom(1); }} title="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button type="button" className="btn btn--xs" disabled={zoom >= ZOOM_MAX} onClick={() => { setZoomClamped(zoom + ZOOM_STEP); }}>+</button>
              <span style={{ width: 8 }} />
              <button type="button" className="btn btn--xs" disabled={past.current.length === 0} onClick={undo}>↶ Undo</button>
              <button type="button" className="btn btn--xs" disabled={future.current.length === 0} onClick={redo}>↷ Redo</button>
              <button type="button" className="btn btn--xs" disabled={boxes.length === 0} onClick={() => { commit(() => []); }}>Clear</button>
            </div>
          </div>
          <CropCanvas imageSrc={imageSrc} boxes={canvasBoxes} zoom={zoom} onUpdateBox={updateBox} onDeleteBox={deleteBox} onSize={setSize} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className="muted">Drag to move · handles to resize · right-click to delete.</span>
            <div className="row">
              <button type="button" className="btn btn--xs" disabled={page <= 1} onClick={() => { goToPage(page - 1); }}>← Prev</button>
              <span className="muted">Page {page} / {totalPages}</span>
              <button type="button" className="btn btn--xs" disabled={page >= totalPages} onClick={() => { goToPage(page + 1); }}>Next →</button>
            </div>
          </div>
        </div>

        <div className="verify__panel">
          {error ? <p className="error">{error}</p> : null}
          {onThisPage.length === 0 ? (
            <p className="muted">No questions on this page.</p>
          ) : (
            onThisPage.map((question, index) => (
              <EditableQuestionCard
                key={question.id}
                question={question}
                index={index}
                boxes={cardBoxesFor(question.id)}
                busyBoxIds={busy}
                fallbackQuestionType={document.data?.questionType ?? null}
                fallbackSectionName={document.data?.sectionName ?? null}
                onAddBox={addBox}
                onCropSave={cropSaveById}
                onDeleteBox={deleteBox}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
