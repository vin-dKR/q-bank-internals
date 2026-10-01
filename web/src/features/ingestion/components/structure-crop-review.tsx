import { useRef, type JSX } from 'react';
import type { StructureCropsController } from '../hooks/use-structure-crops.js';
import { IconSparkle } from '../../../shared/ui/index.js';

export function StructureCropReview({
  controller,
  disabled,
  contextKey,
  onExtract,
}: {
  controller: StructureCropsController;
  disabled: boolean;
  contextKey: string;
  onExtract: (id: string) => void;
}): JSX.Element {
  const { crops } = controller;
  const reviewRef = useRef<HTMLDivElement>(null);
  const unread = crops.filter((crop) => !crop.ocrDone).length;
  const hasSavedText = crops.some((crop) => crop.reviewedText !== null);
  const textSaved = crops.length > 0 && controller.textCrops.length === crops.length;
  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-semibold text-ink">1. Heading crops</span>
        {(['none', 'horizontal', 'rectangle'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`btn btn--xs ${controller.mode === mode ? 'btn--primary' : 'btn--ghost'}`}
            disabled={disabled || !controller.ready}
            aria-pressed={controller.mode === mode}
            onClick={() => {
              controller.setMode(mode);
            }}
          >
            {mode === 'none' ? 'None' : mode === 'horizontal' ? 'Horizontal' : 'Rectangle'}
          </button>
        ))}
      </div>
      <p className="text-ink-3">
        Horizontal: click below the headings for a top band, or drag to select a band. Rectangle:
        drag around any region. One crop can include Exercise, Part and Topic together. Include
        question-type labels such as Single Correct or Subjective Questions when printed. Drag an
        existing box to move it. Moving requires fresh OCR and review.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {crops.length} crops · {controller.ordered ? 'order saved' : 'save reading order'}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={disabled || !crops.length}
          onClick={controller.sort}
        >
          Sort by page
        </button>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={disabled || !crops.length || controller.ordered}
          onClick={controller.saveOrder}
        >
          Save ordered crops
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs text-red-600"
          disabled={disabled || !crops.length}
          onClick={controller.clear}
        >
          Clear all crops
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-brand/20 pt-2">
        <span className="font-semibold text-ink">2. Extract text</span>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={disabled || !controller.ordered || !crops.length}
          onClick={() => {
            if (unread > 0) controller.runOcr();
            else controller.rerunOcr();
          }}
        >
          {unread === 0
            ? 'Rerun OCR'
            : crops.some((crop) => crop.error)
              ? 'Retry unfinished OCR'
              : 'Run OCR'}
        </button>
        {unread > 0 && crops.some((crop) => crop.ocrDone) ? (
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            disabled={disabled || !controller.ordered}
            onClick={() => {
              controller.rerunOcr();
            }}
          >
            Rerun all OCR
          </button>
        ) : null}
        <span className="text-ink-3">Tesseract · Automatic + Sparse · no AI call</span>
      </div>
      {crops.some((crop) => crop.ocrDone) ? (
        <p className="text-ink-3">
          Rerunning OCR replaces crop text when it succeeds. Review and save the text again before
          generating JSON.
        </p>
      ) : null}
      {crops.length ? (
        <div
          ref={reviewRef}
          className="max-h-96 space-y-2 overflow-auto rounded border border-brand/20 p-2"
        >
          {crops.map((crop, index) => (
            <details key={crop.id} open className="rounded border border-line bg-surface p-2">
              <summary className="cursor-pointer font-medium text-ink">
                Crop {index + 1} · page {crop.pageNumber} ·{' '}
                {crop.reviewedText !== null && crop.reviewedText === crop.text
                  ? 'text saved'
                  : crop.ocrDone
                    ? 'review text'
                    : 'awaiting OCR'}
              </summary>
              <div className="my-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  onClick={() => {
                    document
                      .getElementById(`cut-page-${String(crop.pageNumber)}`)
                      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }}
                >
                  View page
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  disabled={disabled || !controller.ordered}
                  aria-label={`${crop.ocrDone ? 'Rerun' : 'Run'} OCR for crop ${String(index + 1)}`}
                  onClick={() => {
                    controller.rerunOcr(crop.id);
                  }}
                >
                  {crop.ocrDone ? 'Rerun OCR' : 'Run OCR'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs text-brand"
                  disabled={disabled || !crop.ocrDone || !crop.text.trim() || !controller.ordered}
                  aria-label={`Extract headings with AI for crop ${String(index + 1)}`}
                  onClick={() => {
                    onExtract(crop.id);
                  }}
                >
                  <IconSparkle /> Extract with AI
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  disabled={disabled || index === 0}
                  onClick={() => {
                    controller.move(crop.id, -1);
                  }}
                  aria-label={`Move crop ${String(index + 1)} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  disabled={disabled || index === crops.length - 1}
                  onClick={() => {
                    controller.move(crop.id, 1);
                  }}
                  aria-label={`Move crop ${String(index + 1)} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--xs text-red-600"
                  disabled={disabled}
                  onClick={() => {
                    controller.remove(crop.id);
                  }}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="input w-full text-[12px]"
                rows={4}
                maxLength={12000}
                value={crop.text}
                disabled={disabled}
                placeholder="OCR text appears here. Correct the printed headings before saving."
                aria-label={`Extracted text for crop ${String(index + 1)}`}
                onChange={(event) => {
                  controller.editText(crop.id, event.target.value);
                }}
              />
              {crop.ai && crop.ai.contextKey === contextKey && crop.ai.result.text === crop.text ? (
                <div className="my-2 space-y-1 rounded border border-brand/20 bg-brand/5 p-2">
                  <p className="font-semibold text-ink">Extracted headings</p>
                  <pre
                    className="max-h-52 overflow-auto whitespace-pre-wrap text-[11px]"
                    aria-label={`AI headings for crop ${String(index + 1)}`}
                  >
                    {JSON.stringify(
                      crop.ai.result.items.map((item) => ({
                        section: item.section?.label ?? null,
                        part: item.part?.label ?? null,
                        topic: item.topic?.label ?? null,
                        questionType: item.questionType?.value ?? null,
                      })),
                      null,
                      2,
                    )}
                  </pre>
                  <p className="text-ink-3">
                    {crop.reviewedText === crop.text
                      ? 'Building JSON reuses these values when text and source rules are unchanged.'
                      : 'Review the values, then save reviewed text to use them in JSON.'}{' '}
                    Missing headings stay null. OCR text is preserved above.
                  </p>
                  {crop.ai.warnings.map((warning) => (
                    <p key={warning} className="text-amber-700">
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}
              {crop.confidence !== null ? (
                <p className="text-ink-3">
                  OCR confidence: {Math.round(crop.confidence)}% · verify identifiers and spelling
                </p>
              ) : null}
              {crop.warnings.map((warning) => (
                <p key={warning} className="text-amber-700">
                  {warning}
                </p>
              ))}
              {crop.error ? (
                <p role="alert" className="error">
                  {crop.error}
                </p>
              ) : null}
            </details>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-brand/20 pt-2">
        <span className="font-semibold text-ink">3. Review &amp; save text</span>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={disabled || !controller.ordered || !crops.length || unread > 0 || textSaved}
          onClick={controller.saveText}
        >
          {textSaved ? 'Reviewed text saved' : 'Save reviewed text'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={disabled || !hasSavedText}
          onClick={() => {
            controller.reviewText();
            const review = reviewRef.current;
            if (!review) return;
            review.querySelectorAll('details').forEach((details) => {
              details.open = true;
            });
            review.scrollTop = 0;
            review.scrollIntoView({ block: 'center', behavior: 'smooth' });
            review.querySelector('textarea')?.focus({ preventScroll: true });
          }}
        >
          Review saved text again
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={disabled || !crops.length}
          onClick={controller.exportText}
        >
          Download OCR draft
        </button>
      </div>
      {textSaved ? (
        <p role="status" className="font-medium text-brand">
          Reviewed text ready · {crops.length} crops. Use the AI button in step 4 to generate or
          regenerate JSON.
        </p>
      ) : crops.length > 0 && unread === 0 && controller.ordered ? (
        <p role="status" className="text-amber-700">
          Text changes are not reviewed yet. Save reviewed text before generating JSON.
        </p>
      ) : null}
      <p className="text-ink-3">
        Order and text are saved in this browser. Reopen the same PDF to restore them. Crop images
        are temporary; chapter data, answer layout and page attachments remain manual.
      </p>
    </div>
  );
}
