import { useRef, type JSX, type ReactNode } from 'react';
import { StructureCropRoleSchema } from '@ingest/contracts';
import type { StructureCropsController } from '../hooks/use-structure-crops.js';
import { IconLock, IconUnlock, IconSparkle, InfoButton } from '../../../shared/ui/index.js';
import { structureCropRolePresentation } from '../lib/structure-crop-role.js';
import { StructureTaskLoader } from './structure-task-loader.js';

export function StructureCropReview({
  controller,
  disabled,
  aiReady,
  aiError,
  contextKey,
  onExtract,
  rules,
}: {
  controller: StructureCropsController;
  disabled: boolean;
  /** OCR and manual review remain available while source-specific rules are resolving. */
  aiReady: boolean;
  aiError: string | null;
  contextKey: string;
  onExtract: (id: string) => void;
  rules?: ReactNode;
}): JSX.Element {
  const { crops } = controller;
  const roles = ['combined', ...controller.hierarchy.map((level) => level.id)];
  const unsupported = crops.some((crop) => !roles.includes(crop.role ?? 'combined'));
  const reviewRef = useRef<HTMLDivElement>(null);
  const unresolved = crops.filter((crop) => !crop.ocrDone || crop.error !== null).length;
  const hasSavedText = crops.some((crop) => crop.reviewedText !== null);
  const textSaved = crops.length > 0 && controller.textCrops.length === crops.length;
  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-semibold text-ink">1. Heading crops</span>
        <InfoButton label="Heading crop guide">
          <p>
            Horizontal: click below the headings for a top band, or drag to select a band.
            Rectangle: drag around any region.
          </p>
          <p className="mt-2">
            Combined can include several configured levels. For a typed crop, select its heading
            type and draw around that heading. Include printed question-type labels.
          </p>
          <p className="mt-2">
            Drag an existing box to move it. Moving requires fresh OCR and review. Save the reading
            order before running OCR.
          </p>
          <p className="mt-2">
            Use the lock on a crop to save its size for that heading type. In Rectangle mode, click
            the top-left corner of the next heading to place the same-sized box. Unlock the size to
            draw a different rectangle.
          </p>
        </InfoButton>
        {(['none', 'rectangle', 'horizontal'] as const).map((mode) => (
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
      <div className="flex flex-wrap items-center gap-1" aria-label="Heading crop type">
        <span className="mr-1 font-medium text-ink">Heading type</span>
        {roles.map((role) => {
          const { label, color } = structureCropRolePresentation(role, controller.hierarchy);
          const selected = controller.role === role;
          return (
            <button
              key={role}
              type="button"
              className="btn btn--ghost btn--xs border"
              style={{
                borderColor: color,
                color: selected ? '#ffffff' : color,
                backgroundColor: selected ? color : 'transparent',
              }}
              disabled={disabled || !controller.ready}
              aria-pressed={selected}
              onClick={() => {
                controller.setRole(role);
              }}
            >
              {label}
              {controller.lockedSizes[role] ? <IconLock /> : null}
            </button>
          );
        })}
        {controller.lockedSizes[controller.role] ? (
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            disabled={disabled || !controller.ready}
            onClick={() => {
              controller.unlockSize(controller.role);
            }}
          >
            <IconUnlock /> Unlock size
          </button>
        ) : null}
      </div>
      {unsupported ? (
        <p role="alert" className="error">
          A saved crop uses a removed hierarchy level. Choose a current heading type for that crop,
          or remove it, before generating JSON.
        </p>
      ) : null}
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
        <InfoButton label="OCR information">
          <p>Tesseract reads each crop using Automatic and Sparse modes. OCR makes no AI call.</p>
          <p className="mt-2">
            Rerunning OCR replaces crop text when it succeeds. Review and save the text again before
            generating JSON.
          </p>
          <p className="mt-2">
            If OCR finds no readable text, resize or rerun the crop, or type the visible heading in
            the text box. Manually corrected text can then be reviewed and saved.
          </p>
        </InfoButton>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={disabled || !controller.ordered || !crops.length}
          onClick={() => {
            if (unresolved > 0) controller.runOcr();
            else controller.rerunOcr();
          }}
        >
          {unresolved === 0
            ? 'Rerun OCR'
            : crops.some((crop) => crop.error)
              ? 'Retry unfinished OCR'
              : 'Run OCR'}
        </button>
        {unresolved > 0 && crops.some((crop) => crop.ocrDone) ? (
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
      </div>
      {crops.length ? (
        <div className="relative" aria-busy={controller.busy}>
          <div
            ref={reviewRef}
            className="max-h-96 space-y-2 overflow-auto rounded border border-brand/20 p-2"
          >
            {crops.map((crop, index) => (
              <details key={crop.id} open className="rounded border border-line bg-surface p-2">
                <summary className="cursor-pointer font-medium text-ink">
                  Crop {index + 1} · page {crop.pageNumber} ·{' '}
                  <span
                    style={{
                      color: structureCropRolePresentation(
                        crop.role ?? 'combined',
                        controller.hierarchy,
                      ).color,
                    }}
                  >
                    {
                      structureCropRolePresentation(crop.role ?? 'combined', controller.hierarchy)
                        .label
                    }
                  </span>{' '}
                  ·{' '}
                  {crop.error
                    ? 'OCR needs attention'
                    : crop.reviewedText !== null && crop.reviewedText === crop.text
                      ? 'text saved'
                      : crop.ocrDone
                        ? 'review text'
                        : 'awaiting OCR'}
                </summary>
                <div className="my-2 flex flex-wrap gap-1">
                  <select
                    className="input w-auto text-[12px]"
                    style={{
                      color: structureCropRolePresentation(
                        crop.role ?? 'combined',
                        controller.hierarchy,
                      ).color,
                    }}
                    value={crop.role ?? 'combined'}
                    disabled={disabled}
                    aria-label={`Heading type for crop ${String(index + 1)}`}
                    onChange={(event) => {
                      controller.setCropRole(
                        crop.id,
                        StructureCropRoleSchema.parse(event.target.value),
                      );
                    }}
                  >
                    {!roles.includes(crop.role ?? 'combined') ? (
                      <option value={crop.role}>
                        {
                          structureCropRolePresentation(
                            crop.role ?? 'combined',
                            controller.hierarchy,
                          ).label
                        }
                      </option>
                    ) : null}
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {structureCropRolePresentation(role, controller.hierarchy).label}
                      </option>
                    ))}
                  </select>
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
                    disabled={
                      disabled ||
                      !aiReady ||
                      !crop.ocrDone ||
                      !crop.text.trim() ||
                      !controller.ordered
                    }
                    aria-label={`Extract headings with AI for crop ${String(index + 1)}`}
                    onClick={() => {
                      if (aiReady) onExtract(crop.id);
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
                {crop.ai &&
                crop.ai.contextKey === contextKey &&
                crop.ai.result.text === crop.text &&
                (crop.ai.result.role ?? 'combined') === (crop.role ?? 'combined') ? (
                  <div className="my-2 space-y-1 rounded border border-brand/20 bg-brand/5 p-2">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-ink">Extracted headings</span>
                      <InfoButton label="Using extracted headings">
                        <p>
                          Save reviewed text to use these values in JSON. Unchanged text and source
                          rules reuse saved AI results. Missing headings stay null; the original OCR
                          text stays above.
                        </p>
                      </InfoButton>
                    </div>
                    <pre
                      className="max-h-52 overflow-auto whitespace-pre-wrap text-[11px]"
                      aria-label={`AI headings for crop ${String(index + 1)}`}
                    >
                      {JSON.stringify(
                        crop.ai.result.items.map((item) => ({
                          ...Object.fromEntries(
                            controller.hierarchy.map((level) => [
                              level.name,
                              (
                                item.headings?.[level.id] ??
                                (level.id === 'section'
                                  ? item.section
                                  : level.id === 'part'
                                    ? item.part
                                    : level.id === 'topic'
                                      ? item.topic
                                      : null)
                              )?.label ?? null,
                            ]),
                          ),
                          questionType: item.questionType?.value ?? null,
                        })),
                        null,
                        2,
                      )}
                    </pre>
                    {crop.ai.warnings.map((warning) => (
                      <p key={warning} className="text-amber-700">
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
                {crop.confidence !== null ? (
                  <p className="text-ink-3">OCR confidence: {Math.round(crop.confidence)}%</p>
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
          {controller.busy && controller.progress ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center rounded bg-surface/90 p-4">
              <StructureTaskLoader
                label="Running OCR"
                progress={controller.progress}
                {...(controller.status ? { detail: controller.status } : {})}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-brand/20 pt-2">
        <span className="font-semibold text-ink">3. Review &amp; save text</span>
        <InfoButton label="Reviewing and saving text">
          <p>
            Correct the extracted text, then save it before generating JSON. Use Edit saved text to
            review it again.
          </p>
          <p className="mt-2">
            Order and text are saved in this browser. Reopen the same PDF to restore them. Download
            the OCR draft to keep a copy.
          </p>
          <p className="mt-2">
            Crop images are temporary. Chapter data, answer layout and page attachments are entered
            manually.
          </p>
        </InfoButton>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          disabled={disabled || !controller.ordered || !crops.length || unresolved > 0 || textSaved}
          onClick={controller.saveText}
        >
          {textSaved ? 'Text saved' : 'Save reviewed text'}
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
          Edit saved text
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          disabled={disabled || !crops.length}
          onClick={controller.exportText}
        >
          Download draft
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!aiReady ? (
          <p role="status" className="text-ink-3">
            {aiError ??
              'Loading heading rules before AI extraction. You can continue OCR and review text.'}
          </p>
        ) : null}
        {unresolved > 0 && controller.ordered ? (
          <p role="status" className="text-amber-700">
            {unresolved} {unresolved === 1 ? 'crop needs' : 'crops need'} usable OCR text. Retry OCR
            or type the visible heading manually before saving text for JSON.
          </p>
        ) : textSaved ? (
          <p role="status" className="font-medium text-brand">
            {crops.length} crops ready for JSON
          </p>
        ) : crops.length > 0 && unresolved === 0 && controller.ordered ? (
          <p role="status" className="text-amber-700">
            Review and save text before generating JSON.
          </p>
        ) : null}
        {rules ? <div className="ml-auto">{rules}</div> : null}
      </div>
    </div>
  );
}
