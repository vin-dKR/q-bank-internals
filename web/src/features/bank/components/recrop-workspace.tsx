import { type JSX, useEffect, useState } from 'react';
import type { BankQuestion, IngestRef } from '@ingest/contracts';
import {
  type BoxRect,
  Button,
  type CanvasBox,
  type CanvasSize,
  CropCanvas,
  IconButton,
  IconChevronLeft,
  IconChevronRight,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarHelp,
  ToolbarSpacer,
} from '../../../shared/ui/index.js';
import { getCroppedBlob } from '../../../shared/lib/crop-image.js';
import { uploadCrop } from '../../../shared/api/upload-crop.js';
import { fetchPageCount, pageImageUrl } from '../../../shared/api/pages.js';
import { useUpdateBankImage } from '../hooks/use-bank.js';

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((url) => url.trim()).filter(Boolean) : [];
}

const INITIAL_BOX: CanvasBox = { id: 'crop', label: 'crop', x: 48, y: 48, width: 220, height: 160 };

/**
 * Fix one published question's image: reopen its source Drive page (from `ingestRef`), draw a crop
 * region, and re-point the question figure or a chosen option image at the freshly uploaded crop.
 */
export function RecropWorkspace({
  question,
  ingestRef,
}: {
  question: BankQuestion;
  ingestRef: IngestRef;
}): JSX.Element {
  const [page, setPage] = useState(ingestRef.sourceRegion.page);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [box, setBox] = useState<CanvasBox>(INITIAL_BOX);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const update = useUpdateBankImage();

  useEffect(() => {
    let alive = true;
    void fetchPageCount(ingestRef.documentId)
      .then((count) => {
        if (alive) setPageCount(count);
      })
      .catch(() => {
        if (alive) setError('Could not load the source PDF — its ingest document may be gone.');
      });
    return () => {
      alive = false;
    };
  }, [ingestRef.documentId]);

  const imageSrc = pageImageUrl(ingestRef.documentId, page);
  const updateBox = (_id: string, rect: Partial<BoxRect>): void => {
    setBox((prev) => ({ ...prev, ...rect }));
  };

  const fix = async (target: 'question' | 'option', optionIndex: number | null): Promise<void> => {
    if (!size || size.displayWidth === 0) return;
    setError(null);
    setDone(null);
    try {
      const scaleX = size.naturalWidth / size.displayWidth;
      const scaleY = size.naturalHeight / size.displayHeight;
      const blob = await getCroppedBlob(imageSrc, {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      });
      const name = `${ingestRef.questionId}_${target}_${String(optionIndex ?? 0)}_${String(Date.now())}`;
      const { url } = await uploadCrop(ingestRef.questionId, name, blob);
      await update.mutateAsync({ questionId: ingestRef.questionId, patch: { target, optionIndex, url } });
      setDone(target === 'question' ? 'Question image updated.' : `Option ${String((optionIndex ?? 0) + 1)} image updated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const totalPages = pageCount ?? page;
  const questionImages = splitUrls(question.questionImage);

  return (
    <div className="verify">
      <div className="verify__canvas">
        <Toolbar ariaLabel="Source page tools">
          <ToolbarGroup>
            <IconButton
              icon={<IconChevronLeft />}
              label="Previous page"
              disabled={page <= 1}
              onClick={() => { setPage(page - 1); }}
            />
            <span className="tbar__count">Page {page} / {totalPages}</span>
            <IconButton
              icon={<IconChevronRight />}
              label="Next page"
              disabled={pageCount !== null && page >= pageCount}
              onClick={() => { setPage(page + 1); }}
            />
          </ToolbarGroup>

          <ToolbarDivider />

          <ToolbarGroup>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              title="Put the crop box back to its starting position"
              onClick={() => { setBox(INITIAL_BOX); }}
            >
              Reset box
            </button>
          </ToolbarGroup>

          <ToolbarSpacer />

          <ToolbarHelp>
            <b>Drag</b> the box to move it · <b>handles</b> to resize. Then crop into the question or
            an option on the right.
          </ToolbarHelp>
        </Toolbar>

        <div className="verify__stage">
          <CropCanvas
            imageSrc={imageSrc}
            boxes={[box]}
            onUpdateBox={updateBox}
            onDeleteBox={() => { setBox(INITIAL_BOX); }}
            onSize={setSize}
          />
        </div>
      </div>

      <div className="verify__panel">
        {error ? <p className="error">{error}</p> : null}
        {done ? <p className="note">{done}</p> : null}

        <div className="card">
          <h2 className="card__title">Current question image{questionImages.length === 1 ? '' : 's'}</h2>
          <div className="row">
            {questionImages.length === 0 ? (
              <span className="muted">None.</span>
            ) : (
              questionImages.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="Question figure"
                  className="max-h-16 rounded-lg border border-line bg-white"
                />
              ))
            )}
          </div>
          <div>
            <Button variant="primary" disabled={update.isPending} onClick={() => { void fix('question', null); }}>
              {update.isPending ? 'Saving…' : 'Crop → replace question image'}
            </Button>
          </div>
        </div>

        {question.options.length > 0 ? (
          <div className="card">
            <h2 className="card__title">Options</h2>
            <div className="stack stack--tight">
              {question.options.map((option, index) => {
                const current = question.optionImages[index] ?? '';
                return (
                  <div key={index} className="flex items-center justify-between gap-2">
                    <span className="muted min-w-0 flex-1">{option}</span>
                    {current ? (
                      <img
                        src={current}
                        alt={`Option ${String(index + 1)}`}
                        className="max-h-12 rounded-lg border border-line bg-white"
                      />
                    ) : null}
                    <Button size="xs" disabled={update.isPending} onClick={() => { void fix('option', index); }}>
                      Crop → option {index + 1}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
