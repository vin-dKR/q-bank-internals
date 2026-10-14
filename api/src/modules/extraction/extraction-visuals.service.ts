import { createHash } from 'node:crypto';
import type { ImageStore } from '../questions/index.js';
import type { ChemistryExtraction, ImageCrop } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageCropper } from './image-cropper.js';
import type { AnswerSheet, ExtractedQuestion, PageImage } from './vision-extractor.js';

/** Retain source evidence before any recognized graph becomes student-facing content. */
export class ExtractionVisualsService {
  constructor(private readonly images: ImageStore, private readonly cropper: ImageCropper) {}

  async preserve(documentId: string, page: PageImage, questions: ExtractedQuestion[]): Promise<ExtractedQuestion[]> {
    const preserved: ExtractedQuestion[] = [];
    for (const question of questions) {
      const chemistry = question.chemistry;
      if (!chemistry || chemistry.visuals.length === 0) { preserved.push(question); continue; }
      const { visuals, imageCrops, issues } = await this.preserveVisuals(documentId, [page], chemistry.visuals, question.options, chemistry.representation === 'transcription');
      preserved.push({
        ...question,
        imageCrops: [...(question.imageCrops ?? []), ...imageCrops],
        chemistry: {
          ...chemistry,
          // Source crops preserve topology, but their ownership/completeness needs operator review.
          status: 'needs_review',
          issues: [...chemistry.issues, ...issues],
          visuals,
        },
      });
    }
    return preserved;
  }

  /** Preserve sibling and in-question answer/solution evidence before their entries are merged. */
  async preserveSheets(documentId: string, pages: PageImage[], sheets: AnswerSheet[]): Promise<AnswerSheet[]> {
    const preserved: AnswerSheet[] = [];
    for (const sheet of sheets) {
      const entries: AnswerSheet['entries'] = {};
      for (const [label, entry] of Object.entries(sheet.entries)) {
        if (!entry.chemistryVisuals?.length) { entries[label] = entry; continue; }
        const { visuals, imageCrops, issues } = await this.preserveVisuals(documentId, pages, entry.chemistryVisuals, [], true);
        entries[label] = { ...entry, chemistryVisuals: visuals, chemistryIssues: [...(entry.chemistryIssues ?? []), ...issues], imageCrops: [...(entry.imageCrops ?? []), ...imageCrops] };
      }
      preserved.push({ ...sheet, entries });
    }
    return preserved;
  }

  private async preserveVisuals(
    documentId: string,
    pages: PageImage[],
    sourceVisuals: ChemistryExtraction['visuals'],
    options: string[],
    optionalUpload: boolean,
  ): Promise<{ visuals: ChemistryExtraction['visuals']; imageCrops: ImageCrop[]; issues: string[] }> {
    const visuals: ChemistryExtraction['visuals'] = [];
    const imageCrops: ImageCrop[] = [];
    const issues: string[] = [];
    for (const visual of sourceVisuals) {
      const page = visual.sourcePage === undefined ? pages[0] : pages.find((candidate) => candidate.pageNumber === visual.sourcePage);
      if (!page || (visual.sourceDocumentId !== undefined && visual.sourceDocumentId !== documentId)) throw errors.extractionFailed('A chemistry answer or solution source page is unavailable for preservation.');
      const optionIndex = visual.field === 'option'
        ? options.findIndex((option) => /^\s*(?:\(([^)]+)\)|([A-Za-z0-9]+)[.)])/.exec(option)?.slice(1).find(Boolean)?.trim().toUpperCase() === visual.optionLabel?.trim().toUpperCase()) : 0;
      if (optionIndex < 0) throw errors.extractionFailed('A chemistry source crop could not be assigned to its printed option label.');
      const dimensions = await this.cropper.dimensions(page.png);
      const regions = visual.regions && visual.regions.length > 1 ? visual.regions : [visual.bbox];
      const bytes = regions.length > 1 ? await this.cropper.compose(page.png, regions) : await this.cropper.crop(page.png, visual.bbox);
      const digest = createHash('sha256').update(bytes).digest('hex');
      let cropUrl: string | null = null;
      try {
        cropUrl = await this.images.upload(`extraction/${documentId}/page-${String(page.pageNumber)}-${digest}.png`, bytes, 'image/png');
        if (!cropUrl.trim()) throw errors.extractionFailed('A chemistry source image could not be preserved.');
      } catch (error) {
        if (!optionalUpload) throw error;
        // Storage availability must not erase a completed molecular transcription. Ownership and
        // source coordinates remain available to review directly against the original PDF.
        visuals.push({ ...visual, cropUrl: null, sourceDocumentId: documentId, sourcePage: page.pageNumber });
        issues.push(`Comparison crop unavailable for ${visual.field}. The extracted SMILES were retained; check this field against the original PDF.`);
        continue;
      }
      visuals.push({ ...visual, cropUrl, sourceDocumentId: documentId, sourcePage: page.pageNumber });
      const type = visual.field === 'stem' ? 'question' : visual.field === 'explanation' ? 'solution' : visual.field;
      for (const [x, y, width, height] of regions) {
        imageCrops.push({ url: cropUrl, type, optionIndex, nx: x * dimensions.width, ny: y * dimensions.height, nw: width * dimensions.width, nh: height * dimensions.height, ...(visual.sourceDocumentId ? { sourceDocumentId: visual.sourceDocumentId } : {}), sourcePage: page.pageNumber });
      }
    }
    return { visuals, imageCrops, issues };
  }
}
