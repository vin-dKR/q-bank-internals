import { pdfjs } from 'react-pdf';
import '../../../shared/lib/pdf-worker.js';
import type { StructureCropBounds } from '@ingest/contracts';

/**
 * Render one page of a PDF (in the browser) to a PNG blob — used by the "AI-fill paper details"
 * button to send the paper's header page to the vision endpoint before the PDF is ever uploaded.
 * `scale` trades resolution for size; 2× keeps small header text legible without a huge upload.
 */
export async function renderPageToPng(
  bytes: ArrayBuffer | Uint8Array,
  pageNumber = 1,
  scale = 2,
  bounds?: StructureCropBounds,
): Promise<Blob> {
  // Copy the bytes: pdf.js transfers/detaches the buffer it is given, which would corrupt the live
  // working document if we handed it the original.
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const box = bounds ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    canvas.width = Math.ceil(viewport.width * (box.x1 - box.x0));
    canvas.height = Math.ceil(viewport.height * (box.y1 - box.y0));
    if (canvas.width * canvas.height > 20_000_000)
      throw new Error('This crop is too large to render. Select a smaller heading region.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -viewport.width * box.x0, -viewport.height * box.y0],
    }).promise;
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode the page image.'));
      }, 'image/png');
    });
  } finally {
    await doc.destroy();
  }
}
