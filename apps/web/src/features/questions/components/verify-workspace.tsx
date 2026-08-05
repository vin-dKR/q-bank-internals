import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '@ingest/contracts';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { useDocument } from '../../documents/index.js';
import { questionsApi } from '../api/questions.api.js';
import { useAutoExtractFigures } from '../hooks/use-auto-extract-figures.js';
import { usePageCount, useQuestions, useUpdateQuestion } from '../hooks/use-questions.js';
import type { BoxRect } from './draggable-box.js';
import { type CanvasSize, CropCanvas } from './crop-canvas.js';
import { type CardBox, EditableQuestionCard } from './editable-question-card.js';

type Box = BoxRect & {
  id: string;
  questionId: string;
  type: 'question' | 'option';
  optionIndex: number;
  label: string;
};

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

/**
 * The Verify crop workspace: left is the source page with draggable crop regions (undo/redo/clear);
 * right is an editable card per question (metadata + per-field AI, from EditableQuestionCard) with
 * Question/Option-image cropping that uploads to Supabase and saves the URL.
 *
 * `autoRun` (set when the session hands off with `?auto=1`) fires the AI figure auto-crop once on
 * arrival; the same run is also available on demand via the "Auto-detect figures" button. The manual
 * draggable-box cropping below is untouched — it's the human fallback for anything the AI gets wrong.
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
  const auto = useAutoExtractFigures(documentId);

  // Kick off the automatic extraction exactly once when the session pushes a document straight here.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoRun && !autoStarted.current && questions.isSuccess && questions.data.length > 0) {
      autoStarted.current = true;
      void auto.run();
    }
  }, [autoRun, questions.isSuccess, questions.data, auto]);

  const [page, setPage] = useState(1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

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

  const goToPage = (next: number): void => {
    setBoxes([]);
    past.current = [];
    future.current = [];
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
  const cardBoxesFor = (questionId: string): CardBox[] =>
    boxes
      .filter((b) => b.questionId === questionId)
      .map((b) => ({ id: b.id, type: b.type, optionIndex: b.optionIndex, label: b.label }));

  if (questions.isPending) return <p className="muted">Loading questions…</p>;
  if (questions.isError) return <p className="error">Could not load questions.</p>;
  if (questions.data.length === 0) {
    return <p className="muted">No questions yet — run extraction on this document first.</p>;
  }

  const totalPages = pageCount.data ?? 1;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong>AI figure auto-crop</strong>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Detect each question&rsquo;s diagram and crop it onto the question automatically. Anything
              the AI misses is still fixable by hand with the crop tools below.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={auto.isRunning}
            onClick={() => { void auto.run(); }}
          >
            {auto.isRunning ? 'Extracting…' : '✨ Auto-detect figures'}
          </button>
        </div>
        {auto.isRunning && auto.progress ? (
          <p className="note">
            Scanning page {auto.progress.page} / {auto.progress.totalPages} — {auto.progress.saved} figure(s) saved…
          </p>
        ) : null}
        {!auto.isRunning && auto.lastSaved !== null ? (
          <p className="note">✓ Auto-cropped {auto.lastSaved} figure(s) onto their questions.</p>
        ) : null}
        {auto.error ? <p className="error">{auto.error}</p> : null}
      </div>

      <div className="verify">
      <div className="verify__canvas">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <strong>Source page</strong>
          <div className="row">
            <button type="button" className="btn btn--xs" disabled={past.current.length === 0} onClick={undo}>↶ Undo</button>
            <button type="button" className="btn btn--xs" disabled={future.current.length === 0} onClick={redo}>↷ Redo</button>
            <button type="button" className="btn btn--xs" disabled={boxes.length === 0} onClick={() => { commit(() => []); }}>Clear</button>
          </div>
        </div>
        <CropCanvas imageSrc={imageSrc} boxes={boxes} onUpdateBox={updateBox} onDeleteBox={deleteBox} onSize={setSize} />
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
