import { createHash } from 'node:crypto';
import type { ImageStore } from '../questions/index.js';
import type { ImageCrop } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageCropper } from './image-cropper.js';
import type { ExtractedQuestion, PageImage } from './vision-extractor.js';

/** Retain source evidence before any recognized graph becomes student-facing content. */
export class ExtractionVisualsService {
  constructor(private readonly images: ImageStore, private readonly cropper: ImageCropper) {}

  async preserve(documentId: string, page: PageImage, questions: ExtractedQuestion[]): Promise<ExtractedQuestion[]> {
    const preserved: ExtractedQuestion[] = [];
    for (const question of questions) {
      const chemistry = question.chemistry;
      if (!chemistry || chemistry.visuals.length === 0) { preserved.push(question); continue; }
      const dimensions = await this.cropper.dimensions(page.png);
      const visuals = [];
      const imageCrops: ImageCrop[] = [];
      for (const visual of chemistry.visuals) {
        const regions = visual.regions && visual.regions.length > 1 ? visual.regions : [visual.bbox];
        const bytes = regions.length > 1
          ? await this.cropper.compose(page.png, regions) : await this.cropper.crop(page.png, visual.bbox);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const cropUrl = await this.images.upload(`extraction/${documentId}/page-${String(page.pageNumber)}-${digest}.png`, bytes, 'image/png');
        if (!cropUrl) throw errors.extractionFailed('A chemistry source image could not be preserved.');
        visuals.push({ ...visual, cropUrl });
        const optionIndex = visual.field === 'option'
          ? question.options.findIndex((option) => /^\s*(?:\(([^)]+)\)|([A-Za-z0-9]+)[.)])/.exec(option)?.slice(1).find(Boolean)?.trim().toUpperCase() === visual.optionLabel?.trim().toUpperCase())
          : 0;
        if (optionIndex < 0) throw errors.extractionFailed('A chemistry source crop could not be assigned to its printed option label.');
        for (const [x, y, width, height] of regions) {
          imageCrops.push({ url: cropUrl, type: visual.field === 'stem' ? 'question' : 'option', optionIndex, nx: x * dimensions.width, ny: y * dimensions.height, nw: width * dimensions.width, nh: height * dimensions.height, sourcePage: page.pageNumber });
        }
      }
      preserved.push({
        ...question,
        imageCrops,
        chemistry: {
          ...chemistry,
          // Source crops preserve topology, but their ownership/completeness needs operator review.
          status: 'needs_review',
          visuals,
        },
      });
    }
    return preserved;
  }
}
