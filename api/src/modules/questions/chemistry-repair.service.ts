import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { chemistrySourceOptionText, chemistrySourceText, type ChemistryExtraction, type ChemistryRepairResult, type Document, type Question, type UpdateQuestion } from '@ingest/contracts';
import type { DocumentRepository } from '../documents/index.js';
import { normalizePrintedQuestionLabel, type ImageCropper, type PageImage, type SourceQuestionAnchor } from '../extraction/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { ImageStore } from './image-store.js';
import type { PageRenderer } from './page-renderer.js';
import type { QuestionRepository } from './questions.repository.js';
import { questionPageBelongsToBindings, topicSourceBindings, type TopicSourceKind } from './source-topic-scope.js';

type CompanionField = 'answer' | 'explanation';
type RepairIssue = ChemistryRepairResult['unresolved'][number];
type SourceMatch = { documentId: string; page: PageImage; anchor: SourceQuestionAnchor };
const MOLECULAR_TAG = /<smiles\b/i;

function labelKey(value: string): string {
  return value.trim().toLocaleUpperCase();
}

function questionIdentity(question: Question): string | null {
  return normalizePrintedQuestionLabel(question.printedLabel ?? question.questionNumber?.toString());
}

function siblingOwnsField(owner: Document, sibling: Document, field: CompanionField): boolean {
  const expectedKind = field === 'answer' ? 'answer' : 'solution';
  return owner.sessionId === sibling.sessionId && sibling.deletedAt === null &&
    owner.path.module === sibling.path.module && owner.path.chapter === sibling.path.chapter &&
    owner.path.section === sibling.path.section &&
    (!owner.uploadGroupId || !sibling.uploadGroupId || owner.uploadGroupId === sibling.uploadGroupId) &&
    (owner.answerLayout === 'combined' ? sibling.kind === 'companion' : owner.answerLayout === 'separate' && sibling.kind === expectedKind);
}

function unchangedAttachment(question: Question, visual: ChemistryExtraction['visuals'][number]): boolean {
  if (!visual.cropUrl?.trim()) return false;
  if (visual.field === 'stem') return question.isQuestionImage && question.questionImage?.trim() === visual.cropUrl.trim();
  if (visual.field === 'answer') return question.answerImages.includes(visual.cropUrl);
  if (visual.field === 'explanation') return question.explanationImages.includes(visual.cropUrl);
  const index = question.options.findIndex((option) => labelKey(option.label) === labelKey(visual.optionLabel ?? ''));
  return index >= 0 && question.isOptionImage && question.optionImages[index] === visual.cropUrl;
}

function restoreSourceText(question: Question, chemistry: ChemistryExtraction, issues: RepairIssue[]): UpdateQuestion {
  const patch: UpdateQuestion = {};
  const stemVisual = chemistry.visuals.find((visual) => visual.field === 'stem');
  if (!question.stem.trim() && chemistry.candidateStem.trim() && stemVisual) {
    if (unchangedAttachment(question, stemVisual)) patch.stem = chemistrySourceText(chemistry.candidateStem);
    else issues.push({ questionId: question.id, field: 'stem', message: 'The question source image has changed. Its saved candidate was kept without replacing your edits.' });
  }
  const options = question.options.map((option, index) => {
    if (option.body.trim()) return option;
    const visual = chemistry.visuals.find((candidate) => candidate.field === 'option' && labelKey(candidate.optionLabel ?? '') === labelKey(option.label));
    const candidate = chemistry.candidateOptions[index];
    if (!visual || !candidate?.trim()) return option;
    if (!unchangedAttachment(question, visual)) {
      issues.push({ questionId: question.id, field: 'option', message: `Option ${option.label}'s source image has changed. Its saved candidate was kept without replacing your edits.` });
      return option;
    }
    return { ...option, body: chemistrySourceOptionText(candidate, option.label) };
  });
  if (options.some((option, index) => option !== question.options[index])) patch.options = options;
  return patch;
}

/** Repair only existing source-backed fields; question identities and manually edited prose stay intact. */
export class ChemistryRepairService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly documents: DocumentRepository,
    private readonly images: ImageStore,
    private readonly pages: PageRenderer,
    private readonly cropper: ImageCropper,
  ) {}

  async repair(documentId: string, questionId?: string): Promise<ChemistryRepairResult> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.kind !== 'question' || document.deletedAt !== null) throw errors.validation({ message: 'Chemistry recovery requires an active question PDF.' });
    const all = await this.questions.findByDocument(documentId);
    const selected = questionId ? all.filter((question) => question.id === questionId) : all;
    if (questionId && selected.length === 0) throw errors.questionNotFound(questionId);
    const siblings = document.sessionId ? await this.documents.listBySession(document.sessionId) : [];
    const cache = new Map<string, Promise<PageImage>>();
    const result: ChemistryRepairResult = { updated: [], unchanged: 0, unresolved: [] };
    for (const question of selected) {
      if (!question.chemistry) { result.unchanged += 1; continue; }
      const chemistry: ChemistryExtraction = { ...question.chemistry, visuals: [...question.chemistry.visuals] };
      const patch = restoreSourceText(question, chemistry, result.unresolved);
      for (const field of ['answer', 'explanation'] as const) {
        const text = field === 'answer' ? question.answer : (question.explanation ?? '');
        if (!MOLECULAR_TAG.test(text) && !chemistry.unresolvedSourceFields?.includes(field)) continue;
        try {
          const fieldPatch = await this.repairCompanionField(document, siblings, all, question, field, text, chemistry, cache);
          const imageCrops = fieldPatch.imageCrops
            ? [...(patch.imageCrops ?? question.imageCrops), ...fieldPatch.imageCrops.slice(question.imageCrops.length)]
            : undefined;
          Object.assign(patch, fieldPatch);
          if (imageCrops) patch.imageCrops = imageCrops;
          if (chemistry.unresolvedSourceFields) chemistry.unresolvedSourceFields = chemistry.unresolvedSourceFields.filter((unresolved) => unresolved !== field);
        } catch (error) {
          result.unresolved.push({ questionId: question.id, field, message: error instanceof Error ? error.message : String(error) });
        }
      }
      if (Object.keys(patch).length === 0) { result.unchanged += 1; continue; }
      const latest = await this.questions.findById(question.id);
      if (!latest || !isDeepStrictEqual(question, latest)) {
        result.unresolved.push({ questionId: question.id, field: 'stem', message: 'This question changed during recovery. Refresh before retrying; your current edits were kept.' });
        result.unchanged += 1;
        continue;
      }
      // The internal repair can append genuine source provenance; ordinary PATCH can only accept it.
      patch.chemistry = { ...chemistry, status: 'needs_review' };
      result.updated.push(await this.questions.update(question.id, patch));
    }
    return result;
  }

  private async repairCompanionField(
    owner: Document,
    siblings: Document[],
    questions: Question[],
    question: Question,
    field: CompanionField,
    text: string,
    chemistry: ChemistryExtraction,
    cache: Map<string, Promise<PageImage>>,
  ): Promise<UpdateQuestion> {
    const savedCandidate = field === 'answer' ? chemistry.candidateAnswer : chemistry.candidateExplanation;
    if (savedCandidate !== undefined && text !== savedCandidate && text !== chemistrySourceText(savedCandidate)) {
      throw errors.chemistryRecoveryFailed('The current text differs from its saved extraction. Your edits were kept; check this field before restoring its diagrams.');
    }
    const existing = chemistry.visuals.filter((visual) => visual.field === field);
    const currentImages = field === 'answer' ? question.answerImages : question.explanationImages;
    if (chemistry.unresolvedSourceFields?.includes(field) && (existing.length > 0 || currentImages.length > 0)) {
      throw errors.chemistryRecoveryFailed('This field has a source crop but still has a missing or continued diagram. Its existing images were kept; the remaining source region must be resolved before review.');
    }
    if (existing.length > 0 && existing.every((visual) => unchangedAttachment(question, visual))) {
      this.keepCandidate(chemistry, field, text);
      return { [field]: chemistrySourceText(text) };
    }
    if (existing.length > 0 || currentImages.length > 0) throw errors.chemistryRecoveryFailed('The existing source images cannot be replaced automatically. Check their ownership before restoring this field.');
    const match = await this.locateSource(owner, siblings, questions, question, field, cache);
    const [x0, y0, x1, y1] = match.anchor.bbox;
    const bbox: [number, number, number, number] = [x0, y0, x1 - x0, y1 - y0];
    const bytes = await this.cropper.crop(match.page.png, bbox);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const url = await this.images.upload(`extraction/${match.documentId}/page-${String(match.page.pageNumber)}-${digest}.png`, bytes, 'image/png');
    if (!url.trim()) throw errors.chemistryRecoveryFailed('The source crop could not be saved; the original candidate was kept.');
    const { width, height } = await this.cropper.dimensions(match.page.png);
    chemistry.visuals.push({
      id: `${field}:source:${match.documentId}:${String(match.page.pageNumber)}:${digest}`,
      field, optionLabel: null, kind: 'figure', bbox,
      candidateSmiles: [...text.matchAll(/<smiles\b[^>]*>([\s\S]*?)<\/smiles>/gi)].map((entry) => entry[1] ?? ''),
      graphValid: null, cropUrl: url, sourceDocumentId: match.documentId, sourcePage: match.page.pageNumber,
    });
    this.keepCandidate(chemistry, field, text);
    const imageCrops = [{ url, type: field === 'answer' ? 'answer' as const : 'solution' as const, optionIndex: 0, nx: x0 * width, ny: y0 * height, nw: bbox[2] * width, nh: bbox[3] * height, sourceDocumentId: match.documentId, sourcePage: match.page.pageNumber }];
    return {
      [field]: chemistrySourceText(text),
      ...(field === 'answer' ? { answerImages: [url] } : { explanationImages: [url] }),
      imageCrops: [...question.imageCrops, ...imageCrops],
    };
  }

  private keepCandidate(chemistry: ChemistryExtraction, field: CompanionField, text: string): void {
    if (field === 'answer') chemistry.candidateAnswer ??= text;
    else chemistry.candidateExplanation ??= text;
  }

  private async locateSource(
    owner: Document,
    siblings: Document[],
    questions: Question[],
    question: Question,
    field: CompanionField,
    cache: Map<string, Promise<PageImage>>,
  ): Promise<SourceMatch> {
    const identity = questionIdentity(question);
    if (!identity || !this.pages.readSourcePage) throw errors.chemistryRecoveryFailed('No reliable native source identity is available for this field. Its original candidate was kept.');
    const sources = siblings.filter((candidate) => siblingOwnsField(owner, candidate, field));
    if (sources.length !== 1 || !sources[0]) throw errors.chemistryRecoveryFailed('This field does not have exactly one matching answer or solution PDF. Its original candidate was kept.');
    const source = sources[0];
    const kind: TopicSourceKind = source.kind === 'companion' ? 'companion' : field === 'answer' ? 'answer' : 'solution';
    const bindings = topicSourceBindings(owner, kind);
    const scoped = bindings.filter((binding) => questionPageBelongsToBindings(question.sourceRegion.page, [binding]));
    if (bindings.length > 0 && scoped.length !== 1) throw errors.chemistryRecoveryFailed('This question has no unique bound answer or solution page range.');
    if (kind === 'companion' && scoped.length === 0) throw errors.chemistryRecoveryFailed('The combined answer and solution PDF needs a topic page range before automatic recovery.');
    const peers = questions.filter((candidate) => scoped.length === 0 || questionPageBelongsToBindings(candidate.sourceRegion.page, scoped));
    if (peers.filter((candidate) => questionIdentity(candidate) === identity).length !== 1) throw errors.chemistryRecoveryFailed('This printed question label occurs more than once in its source scope. Automatic recovery cannot assign its solution safely.');
    let range = scoped[0]?.sourcePageRange ?? source.pageRange;
    if (!range) {
      if (!this.pages.pageCount) throw errors.chemistryRecoveryFailed('The answer or solution PDF has no readable page range.');
      range = { from: 1, to: await this.pages.pageCount(source.id) };
    }
    const matches: SourceMatch[] = [];
    for (let pageNumber = range.from; pageNumber <= range.to; pageNumber += 1) {
      const key = `${source.id}:${String(pageNumber)}`;
      let page = cache.get(key);
      if (!page) { page = this.pages.readSourcePage(source.id, pageNumber); cache.set(key, page); }
      const evidence = await page;
      if (evidence.layout?.source !== 'native_pdf') continue;
      for (const anchor of evidence.layout.questions) {
        if (normalizePrintedQuestionLabel(anchor.printedLabel) === identity) matches.push({ documentId: source.id, page: evidence, anchor });
      }
    }
    const match = matches[0];
    if (matches.length !== 1 || !match || match.page.layout?.limitations.length) throw errors.chemistryRecoveryFailed('The native PDF does not identify one complete source region for this field. A source crop is needed; its original candidate was kept.');
    // A final page block can continue without repeating its number on the next page. A later native
    // question in the same column proves this field's lower boundary; footer geometry alone cannot.
    const tolerance = 2 / (match.page.layout?.height ?? 1);
    const closedByNextQuestion = match.page.layout?.questions.some((anchor) =>
      anchor.anchorBox[1] > match.anchor.anchorBox[3] &&
      Math.abs(anchor.bbox[0] - match.anchor.bbox[0]) <= tolerance &&
      Math.abs(anchor.bbox[1] - match.anchor.bbox[3]) <= tolerance,
    );
    if (!closedByNextQuestion && range.from !== range.to) throw errors.chemistryRecoveryFailed('This source question ends at the page boundary and may continue on another page. Its complete field needs a source region before automatic recovery.');
    return match;
  }
}
