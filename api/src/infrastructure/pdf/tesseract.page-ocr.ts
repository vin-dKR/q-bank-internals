import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';
import type { OcrLine, PageOcr, PageOcrSession } from '../../modules/ingestion/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { mergeOcrLines } from './ocr-line-merge.js';

/** English OCR uses bundled model data; no PDF or page is sent to a hosted OCR provider. */
export class TesseractPageOcr implements PageOcr {
  constructor(private readonly timeoutMs: number) {}

  async open(): Promise<PageOcrSession> {
    const require = createRequire(import.meta.url);
    const languagePath = path.join(
      path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int',
    );
    await access(path.join(languagePath, 'eng.traineddata.gz'));
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: languagePath,
      workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
      cacheMethod: 'none',
      errorHandler: (_error: unknown): void => {
        // Tesseract rejects the job promise, but otherwise also throws an uncaught parent-thread error.
        logger.warn('Tesseract OCR job failed.');
      },
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '216' });
    } catch (error) {
      await worker.terminate();
      throw error;
    }
    const readPass = async (png: Buffer, mode: PSM): Promise<OcrLine[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const result = await worker.recognize(
        png,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      return (result.data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line) => ({
            text: line.text.trim(),
            confidence: line.confidence,
            box: {
              left: line.bbox.x0,
              top: line.bbox.y0,
              right: line.bbox.x1,
              bottom: line.bbox.y1,
            },
          })),
        ),
      );
    };
    let closed = false;
    return {
      recognize: async (png): Promise<OcrLine[]> => {
        if (closed) throw errors.structureDetectionFailed('The OCR worker has already closed.');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            (async () => {
              const automatic = await readPass(png, PSM.AUTO);
              const sparse = await readPass(png, PSM.SPARSE_TEXT);
              return mergeOcrLines(automatic, sparse);
            })(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                reject(errors.structureDetectionFailed('OCR timed out on this page.'));
              }, this.timeoutMs);
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },
      close: async (): Promise<void> => {
        if (closed) return;
        closed = true;
        await worker.terminate();
      },
    };
  }
}
