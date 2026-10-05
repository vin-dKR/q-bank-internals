import type {
  BatchUpdateQuestionsResult,
  DetectFiguresSource,
  DetectedFigure,
  DetectedFigures,
  DetectedFiguresBatch,
  DetectedFiguresPage,
  Document,
  LatexFixResult,
  LatexFieldCheckResult,
  LatexScan,
  PaperMetadata,
  Passage,
  Question,
  QuestionBatchUpdate,
  QuestionListResponse,
  ReExtractedGroup,
  ReExtractedQuestion,
  ReExtractedSubQuestion,
  ReExtractGroupMode,
  ReExtractSource,
  ReExtractSupportingSources,
  TranscribeAreaTarget,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';
import {
  findMatrixChoiceForMatch,
  matrixChoiceMappingText,
  mergeMatrixKeyWithAnswer,
  parseMatchKey,
} from '@ingest/contracts';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ReExtractedSubDraft } from './question-reextractor.js';
import { mapWithConcurrency } from '../../shared/async/map-with-concurrency.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { readPngSize } from '../../shared/image/png-size.js';
import { detectLatexInField } from '../quality/latex-rules.js';
import { automaticLatexRepair, fullyAutomaticLatexRepair, preservesExtractedContent, questionLatexPatch, stagedLatexFields, stagedLatexIssues, type StagedLatexField } from './staged-latex.js';
import type { AiTokenUsage, UsageService } from '../usage/index.js';
import type { DocumentRepository } from '../documents/index.js';
import type { BankQuestionStore } from '../bank/index.js';
import type { DiagramDetector } from './diagram-detector.js';
import { matchFiguresToQuestions } from './figure-matcher.js';
import type { ImageStore } from './image-store.js';
import type { LatexRefiner } from './latex-refiner.js';
import type { PageRenderer } from './page-renderer.js';
import type { PaperMetadataExtractor } from './paper-metadata-extractor.js';
import type {
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractSourceKind,
} from './question-reextractor.js';
import type { QuestionRepository } from './questions.repository.js';
import {
  questionPageBelongsToBindings,
  topicNames,
  topicSourceBindings,
  topicScopeForSourcePage,
  type SourceTopicScope,
  type TopicSourceKind,
} from './source-topic-scope.js';

/**
 * How many pages a whole-document detection pass sends to the vision model at once. Rendering is
 * cache-backed, so this bounds only the AI fan-out — high enough to keep a 10-page batch inside a
 * serverless window, low enough not to trip provider rate limits.
 */
const DETECT_PAGE_CONCURRENCY = 3;

/** The document whose page is rendered for one figure-detection request. */
type FigureDetectionSource = {
  documentId: string;
  /** Null means the question PDF itself; a sibling target changes the attached image field. */
  target: 'answer' | 'solution' | null;
  /** Only an inline question PDF may emit explicit Answer/Solution targets from the detector. */
  inlineAnswerFields: boolean;
  /** Which operator-configured range owns the rendered page. */
  sourceKind: TopicSourceKind;
  /** The question document whose topic map constrains matching. */
  owner: Document;
};

/** A validated page source for an interactive re-read. */
type ReExtractPageSource = {
  documentId: string;
  page: number;
  sourceKind: ReExtractSourceKind;
  fieldTarget?: 'answer' | 'solution';
  inlineAnswers: boolean;
};

/** Answer/Solution figures may only come from the matching sibling upload, never an arbitrary PDF. */
function isSiblingFigureSource(
  owner: Document,
  candidate: Document,
  target: 'answer' | 'solution',
): boolean {
  const samePath =
    owner.path.module === candidate.path.module &&
    owner.path.chapter === candidate.path.chapter &&
    owner.path.section === candidate.path.section;
  const sameGroup =
    !owner.uploadGroupId ||
    !candidate.uploadGroupId ||
    owner.uploadGroupId === candidate.uploadGroupId;
  // Do not let a stale sibling left over from a different upload layout become a source. A
  // `combined` question document has exactly one companion; a `separate` one may use only the
  // matching Answer or Solution document. Inline documents never have a sibling source.
  const matchesLayout =
    owner.answerLayout === 'combined'
      ? candidate.kind === 'companion'
      : owner.answerLayout === 'separate'
        ? candidate.kind === target
        : false;
  return (
    owner.kind === 'question' &&
    owner.deletedAt === null &&
    matchesLayout &&
    candidate.deletedAt === null &&
    owner.sessionId === candidate.sessionId &&
    samePath &&
    sameGroup
  );
}

/** Same-unit/group companion validation shared by source-specific AI reads. */
function isSiblingReExtractSource(owner: Document, candidate: Document): boolean {
  const samePath =
    owner.path.module === candidate.path.module &&
    owner.path.chapter === candidate.path.chapter &&
    owner.path.section === candidate.path.section;
  const sameGroup =
    !owner.uploadGroupId ||
    !candidate.uploadGroupId ||
    owner.uploadGroupId === candidate.uploadGroupId;
  const matchesLayout =
    owner.answerLayout === 'combined'
      ? candidate.kind === 'companion'
      : owner.answerLayout === 'separate'
        ? candidate.kind === 'answer' || candidate.kind === 'solution'
        : false;
  return (
    owner.kind === 'question' &&
    owner.deletedAt === null &&
    matchesLayout &&
    candidate.deletedAt === null &&
    owner.sessionId === candidate.sessionId &&
    samePath &&
    sameGroup
  );
}

/** The first page in this question block's configured supporting-source span, or a legacy fallback. */
function defaultSupportingSourcePage(
  owner: Document,
  candidate: Document,
  questionPage: number,
  sourceKind: Extract<ReExtractSourceKind, 'answer' | 'solution' | 'companion'>,
): number | null {
  const bindings = topicSourceBindings(owner, sourceKind);
  if (bindings.length > 0) {
    const matching = bindings.filter((item) => questionPageBelongsToBindings(questionPage, [item]));
    // A configured source map must identify exactly one sibling range. Picking the first overlapping
    // binding could apply a same-number answer from a different topic.
    return matching.length === 1 ? (matching[0]?.sourcePageRange.from ?? null) : null;
  }
  return candidate.pageRange?.from ?? 1;
}

/** A source-specific read is valid only for the field it was requested to enrich. */
function sourceCanSupplyField(
  source: ReExtractPageSource,
  field: 'answer' | 'solution',
): boolean {
  return source.sourceKind === field ||
    (source.sourceKind === 'companion' && source.fieldTarget === field);
}

/** Sum successful vision reads into the one usage record attached to the selected question. */
function combinedUsage(
  primary: AiTokenUsage,
  supplemental: readonly (QuestionReExtraction | null)[],
): AiTokenUsage {
  return supplemental.reduce<AiTokenUsage>(
    (total, read) =>
      read === null
        ? total
        : {
            model: total.model,
            promptTokens: total.promptTokens + read.usage.promptTokens,
            completionTokens: total.completionTokens + read.usage.completionTokens,
            totalTokens: total.totalTokens + read.usage.totalTokens,
            callCount: total.callCount + read.usage.callCount,
          },
    primary,
  );
}

function firstNonBlank(...values: readonly string[]): string {
  return values.find((value) => value.trim().length > 0) ?? '';
}

function firstExplanation(
  ...values: readonly (string | null)[]
): string | null {
  return values.find((value): value is string => value !== null && value.trim().length > 0) ?? null;
}

/** Reclassify source-PDF figures after their printed number has been mapped to the owner question. */
function asSiblingFigures(
  figures: DetectedFigure[],
  target: 'answer' | 'solution',
): DetectedFigure[] {
  return figures
    .filter((figure) => figure.target !== 'passage')
    .map((figure) => ({ ...figure, target }));
}

/**
 * Return the one topic that owns a configured source page. There is deliberately no broad fallback
 * once a document has source-range bindings: applying an Answer/Solution page from Topic B to a
 * same-number Question 1 in Topic A is silent data corruption, not a best-effort match.
 */
function requiredSourceScope(
  owner: Document,
  sourceKind: TopicSourceKind,
  page: number,
  operation: string,
): SourceTopicScope | null {
  const scope = topicScopeForSourcePage(owner, sourceKind, page);
  if (!scope.configured) {
    // A grouped companion is a new layout whose one PDF is ambiguous without its cut-time ranges.
    // Standalone legacy Answer/Solution PDFs retain their existing number/stem based fallback.
    if (sourceKind === 'companion') {
      throw errors.validation({
        message:
          'A combined Answer + Solution PDF needs a page range for this topic before it can be used here.',
      });
    }
    return null;
  }
  const names = topicNames(scope);
  if (names.length === 0) {
    throw errors.validation({
      message: `${operation} page ${String(page)} is not assigned to a topic in this source PDF.`,
    });
  }
  if (names.length > 1) {
    throw errors.validation({
      message: `${operation} page ${String(page)} is assigned to multiple topics. Split its source-page ranges before using it.`,
    });
  }
  return scope;
}

/** Filter a sibling source page to only questions in the page's explicitly bound topic. */
function questionsForSiblingSourcePage(
  owner: Document,
  questions: Question[],
  sourceKind: Exclude<TopicSourceKind, 'question'>,
  page: number,
): Question[] {
  const scope = requiredSourceScope(owner, sourceKind, page, 'This');
  if (scope === null) return questions; // Legacy standalone Answer/Solution upload, no cut-time ranges.
  const scoped = questions.filter((question) =>
    questionPageBelongsToBindings(question.sourceRegion.page, scope.bindings),
  );
  if (scoped.length === 0) {
    throw errors.validation({
      message: `No extracted questions belong to the topic assigned to source page ${String(page)}.`,
    });
  }
  return scoped;
}

/**
 * Current/continuation candidates on the question PDF. A direct source page gets the same range
 * protection as sibling sheets, while a continuation may still look one page back for a figure.
 */
function questionsForQuestionSourcePage(
  owner: Document,
  questions: Question[],
  page: number,
): Question[] {
  const scope = topicScopeForSourcePage(owner, 'question', page);
  if (!scope.configured) return questions.filter((question) => question.sourceRegion.page === page);
  const names = topicNames(scope);
  if (names.length === 0) return [];
  if (names.length > 1) {
    throw errors.validation({
      message: `Question page ${String(page)} is assigned to multiple topics. Split its page ranges before detecting figures.`,
    });
  }
  return questions.filter(
    (question) =>
      question.sourceRegion.page === page &&
      questionPageBelongsToBindings(question.sourceRegion.page, scope.bindings),
  );
}

/**
 * Check an explicit re-read page against the target question(s)' topic. This happens before
 * rendering/calling AI, so a stale UI page cannot overwrite a same-number row in another topic.
 */
function assertReExtractPageOwnsQuestions(
  owner: Document,
  sourceKind: TopicSourceKind,
  sourcePage: number,
  questionPages: readonly number[],
): void {
  const sourceScope = requiredSourceScope(owner, sourceKind, sourcePage, 'Re-extract');
  if (sourceScope === null) {
    // A legacy question PDF still has a safe local rule: a question can only continue onto the next
    // page. Answer/Solution legacy layouts have no reliable page correspondence, so preserve their
    // backwards-compatible number/stem anchored behaviour instead of inventing a false mapping.
    if (sourceKind === 'question') {
      const allowedPages = new Set(questionPages.flatMap((page) => [page, page + 1]));
      if (!allowedPages.has(sourcePage)) {
        throw errors.validation({
          message:
            'Re-extract a question from its own source page (or its immediately following continuation page).',
        });
      }
    }
    return;
  }

  for (const questionPage of questionPages) {
    if (!questionPageBelongsToBindings(questionPage, sourceScope.bindings)) {
      throw errors.validation({
        message:
          'The selected source page belongs to a different topic or question-type block than this question. Choose the corresponding page from the same block.',
      });
    }
  }
}

type MatrixDraftState = Pick<Question, 'questionType' | 'match' | 'options' | 'answer'>;

/** Assemble the small matrix-relevant projection after a partial Verify patch, without mutating it. */
function matrixStateAfterPatch(question: Question, patch: UpdateQuestion): MatrixDraftState {
  return {
    questionType: patch.questionType !== undefined ? patch.questionType : question.questionType,
    match: patch.match !== undefined ? patch.match : question.match,
    options: patch.options !== undefined ? patch.options : question.options,
    answer: patch.answer !== undefined ? patch.answer : question.answer,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reconcile matrix table/key/choice invariants in one place. Choices must preserve the source panel:
 * a direct-response matrix stays table-only, and printed/manual choices are never replaced or
 * supplemented with AI-generated alternatives.
 */
function normalizeMatrixState(state: MatrixDraftState): MatrixDraftState {
  if (state.questionType !== 'matrix' || state.match === null) return state;
  const match = mergeMatrixKeyWithAnswer(state.match, state.answer);
  const visibleOptions = state.options.filter((option) => option.generated !== true);
  if (visibleOptions.length === 0) {
    // No choice panel is a valid direct-response layout. Keep the actual matching table/key and
    // never materialize an A–D fallback that did not exist in the source image.
    const hasDirectMap = Object.keys(parseMatchKey(state.answer)).length > 0;
    return {
      ...state,
      match,
      answer: hasDirectMap ? state.answer : matrixChoiceMappingText(match.key),
      options: [],
    };
  }

  // A source answer key may return a raw `A→p; …` map while this row keeps source-printed choices.
  // When one printed body encodes that exact complete map, canonicalize the answer to its label and
  // make the correct marker agree — without touching bodies/provenance/order.
  const selected = findMatrixChoiceForMatch(state.options, match);
  if (!selected) {
    // A printed/manual panel is the source's fixed answer convention. It must remain that panel,
    // even when a model/table read cannot reconcile the current key to one of its choices. Remove
    // any stale generated helper instead of adding a fifth option, and preserve a pre-existing
    // explicit source/manual selection only when it still names a visible choice.
    const existingAnswer = state.answer.trim().toLocaleLowerCase();
    const preserved =
      visibleOptions.find((option) => option.label.trim().toLocaleLowerCase() === existingAnswer) ??
      visibleOptions.find((option) => option.isCorrect);
    return {
      ...state,
      match,
      answer: preserved?.label ?? '',
      options: visibleOptions.map((option) => ({
        ...option,
        isCorrect: option.label === preserved?.label,
      })),
    };
  }
  return {
    ...state,
    match,
    answer: selected,
    // Once a source/manual body represents the exact key, stale generated helpers are unnecessary
    // and could describe a previous key. Remove only those generated rows; preserve every source/custom
    // choice and set its one canonical selection.
    options: state.options
      .filter((option) => option.generated !== true)
      .map((option) => ({ ...option, isCorrect: option.label === selected })),
  };
}

/** Return only fields whose post-patch normalized value differs from the candidate state. */
function matrixNormalizationPatch(
  candidate: MatrixDraftState,
): Pick<UpdateQuestion, 'match' | 'options' | 'answer'> {
  const normalized = normalizeMatrixState(candidate);
  return {
    ...(sameJson(candidate.match, normalized.match) ? {} : { match: normalized.match }),
    ...(sameJson(candidate.options, normalized.options) ? {} : { options: normalized.options }),
    ...(candidate.answer === normalized.answer ? {} : { answer: normalized.answer }),
  };
}

/** Normalize a source-specific matrix re-read against the persisted table/choice set when needed. */
function normalizeMatrixReExtract(
  question: Question,
  fresh: ReExtractedQuestion,
  expectedType: string | null,
  _sourceKind: ReExtractSourceKind,
): ReExtractedQuestion {
  if (expectedType !== 'matrix') return fresh;
  // A vision re-read is allowed to be incomplete, but it must not wipe an already-complete matrix
  // just because the model did not recover its columns/key this time. Do not, however, pull normal
  // MCQ choices into a question the operator has newly switched to Matrix Match.
  const hasExistingMatrix = question.questionType === 'matrix' || question.match !== null;
  const fallback = hasExistingMatrix
    ? { match: question.match, options: question.options, answer: question.answer }
    : { match: null, options: [], answer: '' };
  const candidate: MatrixDraftState = {
    questionType: 'matrix',
    match: fresh.match ?? fallback.match,
    options: fresh.options.length > 0 ? fresh.options : fallback.options,
    answer: fresh.answer.trim() ? fresh.answer : fallback.answer,
  };
  const normalized = normalizeMatrixState(candidate);
  return {
    ...fresh,
    match: normalized.match,
    options: normalized.options,
    answer: normalized.answer,
  };
}

/**
 * Read + verify side of the extracted questions: load a document's questions, apply verify-screen
 * edits, stage cropped images to storage, detect figures for auto-crop, and refine LaTeX. Depends
 * only on ports (§3).
 */
export class QuestionsService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly documents: DocumentRepository,
    private readonly bank: BankQuestionStore,
    private readonly images: ImageStore,
    private readonly refiner: LatexRefiner,
    private readonly usage: UsageService,
    private readonly detector: DiagramDetector,
    private readonly pages: PageRenderer,
    private readonly reExtractor: QuestionReExtractor,
    private readonly paperMetadata: PaperMetadataExtractor,
  ) {}

  /** The questions extracted from a single document (PDF reading order) + the passages they reference. */
  async listByDocument(documentId: string): Promise<QuestionListResponse> {
    const [questions, passages] = await Promise.all([
      this.questions.findByDocument(documentId),
      this.questions.findPassagesByDocument(documentId),
    ]);
    return { questions, passages };
  }

  /** Scan current staged text on demand. Session and Verify queries start this after extraction. */
  async scanLatex(documentId: string): Promise<LatexScan> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.kind !== 'question') throw errors.validation({ message: 'LaTeX scan requires a question PDF.' });
    const { questions, passages } = await this.listByDocument(documentId);
    const issues = stagedLatexIssues(stagedLatexFields(questions, passages));
    return {
      documentId,
      issues,
      questionCount: new Set(issues.flatMap((issue) => issue.questionId ? [issue.questionId] : [])).size,
      automaticFields: new Set(issues.filter((issue) => issue.automatic).map((issue) => issue.key)).size,
      aiFields: new Set(issues.map((issue) => issue.key)).size,
    };
  }

  /** Check an unsaved Verify draft field with the exact same rules as the document scan. */
  checkLatexField(field: string, text: string): LatexFieldCheckResult {
    return { field, issues: detectLatexInField(field, text) };
  }

  /** Transcribe a user-selected question/answer/solution PDF region into reviewable draft text. */
  async transcribeQuestionRegion(input: {
    questionId: string;
    documentId: string;
    page: number;
    bbox: [number, number, number, number];
    destination: 'stem' | 'answer' | 'solution';
    source?: ReExtractSource | undefined;
  }): Promise<{ text: string }> {
    const [question, document] = await Promise.all([
      this.questions.findById(input.questionId),
      this.documents.findById(input.documentId),
    ]);
    if (!question || question.documentId !== input.documentId) {
      throw errors.validation({ message: 'This question does not belong to the selected document.' });
    }
    if (!document || document.kind !== 'question') {
      throw errors.validation({ message: 'Text selection requires the question PDF as its owner document.' });
    }
    const source = await this.resolveReExtractSource(
      input.documentId,
      input.source,
      question.sourceRegion.page,
      [question.sourceRegion.page],
    );
    const sourceMatchesDestination =
      source.sourceKind === 'question' ||
      (input.destination === 'answer' && (source.sourceKind === 'answer' || source.fieldTarget === 'answer')) ||
      (input.destination === 'solution' && (source.sourceKind === 'solution' || source.fieldTarget === 'solution'));
    if (!sourceMatchesDestination || (input.destination === 'stem' && source.sourceKind !== 'question')) {
      throw errors.validation({ message: 'Choose a source PDF that matches the text field you are transcribing.' });
    }
    if (source.page !== input.page) {
      throw errors.validation({ message: 'The selected PDF page changed. Select the area again.' });
    }
    const png = await this.pages.renderPage(source.documentId, source.page);
    const { width, height } = readPngSize(png);
    const [x0, y0, x1, y1] = input.bbox;
    const left = Math.max(0, Math.floor(x0 * width));
    const top = Math.max(0, Math.floor(y0 * height));
    const right = Math.min(width, Math.ceil(x1 * width));
    const bottom = Math.min(height, Math.ceil(y1 * height));
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    if (cropWidth < 20 || cropHeight < 20) {
      throw errors.validation({ message: 'Select a larger area of the page and try again.' });
    }
    const crop = await sharp(png).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
    const { text, usage } = await this.reExtractor.transcribeRegion({ png: crop, destination: input.destination });
    try {
      await this.usage.recordUsage({ source: 'reextract', documentId: input.documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record selected-region transcription usage');
    }
    return { text };
  }

  /** Apply only mechanical repairs shared with Data Quality, skipping prose that needs judgment. */
  async fixLatexAutomatically(documentId: string): Promise<LatexFixResult> {
    await this.scanLatex(documentId); // Validate ownership before any write.
    const { questions, passages } = await this.listByDocument(documentId);
    const targets = stagedLatexFields(questions, passages).filter((field) =>
      fullyAutomaticLatexRepair(field.field, field.text) !== null);
    const failed: LatexFixResult['failed'] = [];
    let updatedFields = 0;
    for (const target of targets) {
      try {
        const current = await this.currentLatexField(documentId, target);
        if (!current) continue;
        const repaired = fullyAutomaticLatexRepair(current.field, current.text);
        if (repaired === null) {
          failed.push({ key: target.key, message: 'This field no longer has a complete automatic repair. Rescan and use AI or review it.' });
          continue;
        }
        await this.saveLatexField(documentId, current, repaired);
        updatedFields += 1;
      } catch (caught) {
        failed.push({ key: target.key, message: caught instanceof Error ? caught.message : String(caught) });
      }
    }
    return { updatedFields, failed };
  }

  /** Refine at most five flagged fields per request; the client chains batches from one click. */
  async fixLatexWithAi(documentId: string, keys: string[]): Promise<LatexFixResult> {
    await this.scanLatex(documentId);
    const { questions, passages } = await this.listByDocument(documentId);
    const targets = stagedLatexFields(questions, passages).filter((field) =>
      keys.includes(field.key) && stagedLatexIssues([field]).length > 0);
    const groups = new Map<string, StagedLatexField[]>();
    for (const target of targets) {
      const groupKey = target.questionId ?? target.key;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), target]);
    }
    const results = await mapWithConcurrency([...groups.values()], 2, async (group) => {
      const groupResult: LatexFixResult = { updatedFields: 0, failed: [] };
      for (const target of group) {
        try {
          const current = await this.currentLatexField(documentId, target);
          if (!current) continue;
          const before = detectLatexInField(current.field, current.text);
          if (before.length === 0) continue;
          const mechanical = automaticLatexRepair(current.text);
          const remaining = detectLatexInField(current.field, mechanical);
          const refined = remaining.length === 0
            ? mechanical : await this.refineLatex(mechanical, remaining);
          const after = detectLatexInField(current.field, refined);
          if (!refined.trim()) {
            groupResult.failed.push({ key: target.key, message: 'The AI returned blank text; the extracted content was kept.' });
            continue;
          }
          if (!preservesExtractedContent(current.text, refined)) {
            groupResult.failed.push({ key: target.key, message: 'The AI changed or removed extracted content; no change was saved.' });
            continue;
          }
          if (refined === current.text || after.length > 0) {
            groupResult.failed.push({ key: target.key, message: 'The AI did not resolve every LaTeX issue in this field; no change was saved.' });
            continue;
          }
          await this.saveLatexField(documentId, current, refined);
          groupResult.updatedFields += 1;
        } catch (caught) {
          groupResult.failed.push({ key: target.key, message: caught instanceof Error ? caught.message : String(caught) });
        }
      }
      return groupResult;
    });
    return {
      updatedFields: results.reduce((sum, result) => sum + result.updatedFields, 0),
      failed: results.flatMap((result) => result.failed),
    };
  }

  private async currentLatexField(documentId: string, target: StagedLatexField): Promise<StagedLatexField | null> {
    if (target.questionId) {
      const question = await this.questions.findById(target.questionId);
      if (!question || question.documentId !== documentId) return null;
      return stagedLatexFields([question], []).find((field) => field.key === target.key) ?? null;
    }
    const passages = await this.questions.findPassagesByDocument(documentId);
    return stagedLatexFields([], passages).find((field) => field.key === target.key) ?? null;
  }

  private async saveLatexField(documentId: string, target: StagedLatexField, text: string): Promise<void> {
    if (target.questionId) {
      const question = await this.questions.findById(target.questionId);
      if (!question || question.documentId !== documentId) throw errors.questionNotFound(target.questionId);
      const latest = stagedLatexFields([question], []).find((field) => field.key === target.key);
      if (!latest || latest.text !== target.text) throw new Error('This field changed during the LaTeX fix. Refresh and retry.');
      const patch = questionLatexPatch(question, target.field, text);
      if (!patch) throw errors.validation({ message: 'The LaTeX field no longer exists.' });
      await this.update(question.id, patch);
      return;
    }
    const latest = await this.currentLatexField(documentId, target);
    if (!latest || latest.text !== target.text) throw new Error('This passage changed during the LaTeX fix. Refresh and retry.');
    await this.questions.updatePassage(target.key.slice(2), { text });
  }

  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to a question. */
  async update(id: string, patch: UpdateQuestion): Promise<Question> {
    const current = await this.questions.findById(id);
    if (!current) throw errors.questionNotFound(id);
    // Normalize before the one repository write, so batch and ordinary PATCH share exactly the same
    // table/choice invariant and a concurrent edit cannot be overwritten by a second repair write.
    const normalized = matrixNormalizationPatch(matrixStateAfterPatch(current, patch));
    return this.questions.update(id, { ...patch, ...normalized });
  }

  /**
   * Delete ONE question everywhere it lives (the verify "Delete" action): remove the staged row
   * (pruning its comprehension passage when it was the group's last member), refresh the document's
   * denormalized question count so the unit list stays honest, then drop its published bank copy if it
   * had been promoted. Idempotent — a double-click / retry whose staged row is already gone is a no-op
   * on staging yet still clears any bank row a partial earlier failure could have stranded (Mongo has
   * no cross-collection transaction here). The count is refreshed BEFORE the bank delete so a bank
   * failure leaves the count correct and only the bank row to reclaim on retry.
   */
  async delete(id: string): Promise<void> {
    const deleted = await this.questions.deleteById(id);
    if (deleted) {
      const remaining = await this.questions.countByDocument(deleted.documentId);
      await this.documents.setQuestionCount(deleted.documentId, remaining);
    }
    await this.bank.deleteByQuestionId(id);
  }

  /** Apply verify-screen edits (text / shared image) to one comprehension passage — fixed in ONE place. */
  updatePassage(id: string, patch: UpdatePassage): Promise<Passage> {
    return this.questions.updatePassage(id, patch);
  }

  /**
   * Manually group already-extracted questions into a new comprehension (the verify "group" action, for
   * a page whose passage the extractor missed). Creates the shared passage and links the questions; the
   * operator then re-extracts the group to read the passage off the page.
   */
  groupQuestions(documentId: string, questionIds: string[]): Promise<Passage> {
    return this.questions.groupQuestions(
      documentId,
      makePassageId(documentId, questionIds),
      questionIds,
    );
  }

  /** Dissolve a comprehension group back into standalone questions (the verify "ungroup" action). */
  ungroupPassage(passageId: string): Promise<void> {
    return this.questions.ungroupPassage(passageId);
  }

  /**
   * Apply verify-screen edits to several questions in one call — the local-first verify panel
   * sends only its dirty questions here. Each update is applied independently: one bad question
   * never blocks the rest, and every failure is reported back by id so the client can keep just
   * those marked dirty.
   */
  async batchUpdate(updates: QuestionBatchUpdate[]): Promise<BatchUpdateQuestionsResult> {
    const updated: Question[] = [];
    const failed: BatchUpdateQuestionsResult['failed'] = [];
    for (const { id, patch } of updates) {
      try {
        updated.push(await this.update(id, patch));
      } catch (caught) {
        failed.push({ id, message: caught instanceof Error ? caught.message : String(caught) });
      }
    }
    return { updated, failed };
  }

  /** Upload one cropped image to storage under `name`, returning its public URL. */
  uploadImage(input: { name: string; bytes: Buffer; contentType: string }): Promise<string> {
    if (!input.name.trim()) throw errors.validation({ message: 'Image name is required.' });
    return this.images.upload(input.name, input.bytes, input.contentType);
  }

  /**
   * Locate the figures on one page of a document and map each back to the question it belongs to.
   * Detection only — the client crops the returned bboxes out of the same page image and uploads
   * them via {@link uploadImage}, so cropping stays in exactly one place (the browser canvas). Each
   * figure is attached by printed number, then by text snippet ({@link matchFiguresToQuestions}); a
   * A figure on the immediately following page may still map to the question that began on this page.
   * `source` renders the unit's validated sibling Answer/Solution file, but still maps its printed
   * question numbers back to this question document.
   */
  async detectFigures(
    documentId: string,
    page: number,
    source?: DetectFiguresSource,
  ): Promise<DetectedFigures> {
    const questions = await this.questions.findByDocument(documentId);
    const figureSource = await this.resolveFigureSource(documentId, source);
    return this.detectOnPage(documentId, page, questions, figureSource);
  }

  /**
   * The whole-document detect: run {@link detectFigures}'s pipeline over several pages in one
   * request. Question sources include each extracted question page plus its immediately following
   * continuation page; sibling Answer/Solution sources accept every requested page because their
   * printed numbers map back to this document. Vision calls run with bounded concurrency. The first
   * page is rendered up front so the rasterizer warms its per-document cache once instead of every
   * worker re-rasterizing the PDF on a cold start. One page's failure (a transient provider 429/500)
   * is returned as that page's `ok: false` entry, never as a failure of the whole request — the
   * other pages' detections are already paid for and must reach the client.
   */
  async detectFiguresBatch(
    documentId: string,
    pages: number[],
    source?: DetectFiguresSource,
  ): Promise<DetectedFiguresBatch> {
    const questions = await this.questions.findByDocument(documentId);
    const figureSource = await this.resolveFigureSource(documentId, source);
    const questionPages = new Set(questions.map((question) => question.sourceRegion.page));
    const wanted = [...new Set(pages)]
      .sort((a, b) => a - b)
      .filter(
        (page) =>
          figureSource.target !== null || questionPages.has(page) || questionPages.has(page - 1),
      );
    const first = wanted[0];
    if (first !== undefined) await this.pages.renderPage(figureSource.documentId, first);
    const results = await mapWithConcurrency(
      wanted,
      DETECT_PAGE_CONCURRENCY,
      async (page): Promise<DetectedFiguresPage> => {
        try {
          return {
            ok: true,
            page,
            ...(await this.detectOnPage(documentId, page, questions, figureSource)),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(
            { documentId, sourceDocumentId: figureSource.documentId, page, err: message },
            'figure detection failed for one page of a batch',
          );
          return { ok: false, page, error: message };
        }
      },
    );
    return { pages: results };
  }

  /** Resolve and validate an optional sibling PDF before it can be rendered for figure detection. */
  private async resolveFigureSource(
    documentId: string,
    source?: DetectFiguresSource,
  ): Promise<FigureDetectionSource> {
    if (!source) {
      const owner = await this.documents.findById(documentId);
      if (!owner || owner.deletedAt !== null) throw errors.documentNotFound(documentId);
      if (owner.kind !== 'question') {
        throw errors.validation({
          message: 'Figures can only be detected for a question document.',
        });
      }
      return {
        documentId: owner.id,
        target: null,
        inlineAnswerFields: owner.answerLayout === 'inline',
        sourceKind: 'question',
        owner,
      };
    }
    const [owner, sibling] = await Promise.all([
      this.documents.findById(documentId),
      this.documents.findById(source.documentId),
    ]);
    if (!owner) throw errors.documentNotFound(documentId);
    if (!sibling || sibling.deletedAt !== null) throw errors.documentNotFound(source.documentId);
    if (!isSiblingFigureSource(owner, sibling, source.target)) {
      throw errors.validation({
        message:
          'Figure source must be the matching Answer or Solution upload for this question document.',
      });
    }
    const sourceKind: Exclude<TopicSourceKind, 'question'> =
      sibling.kind === 'companion'
        ? 'companion'
        : sibling.kind === 'solution'
          ? 'solution'
          : 'answer';
    return {
      documentId: sibling.id,
      target: source.target,
      inlineAnswerFields: false,
      sourceKind,
      owner,
    };
  }

  /** Detect + match one page's figures against the document's already-loaded questions. */
  private async detectOnPage(
    documentId: string,
    page: number,
    questions: Question[],
    source: FigureDetectionSource,
  ): Promise<DetectedFigures> {
    // Resolve the topic before spending a vision call. On a page from an Answer/Solution/companion
    // source this excludes same-number rows from every other topic in the question document.
    const siblingQuestions =
      source.target === null
        ? null
        : questionsForSiblingSourcePage(
            source.owner,
            questions,
            source.sourceKind as Exclude<TopicSourceKind, 'question'>,
            page,
          );
    const png = await this.pages.renderPage(source.documentId, page);
    const { width, height } = readPngSize(png);
    const { detections, questionTops, usage } = await this.detector.detect({
      png,
      width,
      height,
      inlineAnswerFields: source.inlineAnswerFields,
    });
    try {
      await this.usage.recordUsage({ source: 'detection', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record figure-detection token usage');
    }
    const onPage =
      source.target === null ? questionsForQuestionSourcePage(source.owner, questions, page) : [];
    const continuationQuestions =
      source.target === null
        ? questionsForQuestionSourcePage(source.owner, questions, page - 1)
        : (siblingQuestions ?? []);
    // The question/option labels emitted by a detector are meaningful only on a question page.
    // A sibling Answer/Solution sheet can show a worked graph beside an answer, so attach every
    // matched graphic to the selected field instead of accidentally dropping it as an option crop.
    const matchableDetections =
      source.target === null
        ? detections
        : detections.map((detection) => ({
            ...detection,
            target: 'question' as const,
            optionLabel: null,
          }));
    const matched = matchFiguresToQuestions(matchableDetections, questionTops, onPage, width, {
      continuationQuestions,
      // A grouped answer/solution source and an explicitly labelled inline field can both contain
      // several distinct figures for a single printed number. Regular question pages retain their
      // conservative one-stem/one-option claim behavior.
      allowMultipleQuestionFigures: source.target !== null || source.inlineAnswerFields,
    });
    // The detector's question/option distinction belongs to a question paper. On sibling sheets all
    // matched graphics are answer or explanation evidence, while their question id still comes from
    // the owner document's number/text ledger.
    const figures = source.target === null ? matched : asSiblingFigures(matched, source.target);
    logger.info(
      {
        documentId,
        sourceDocumentId: source.documentId,
        target: source.target,
        page,
        detected: detections.length,
        matched: figures.length,
      },
      'figure detection matched to questions',
    );
    return { imageWidth: width, imageHeight: height, figures };
  }

  /**
   * Resolve the only documents an interactive re-read may render: the question PDF itself, or a
   * live matching Answer/Solution sibling. This prevents a caller from supplying an arbitrary
   * document id and, crucially, tells the AI which source grammar it is looking at.
   */
  private async resolveReExtractSource(
    documentId: string,
    source: ReExtractSource | undefined,
    fallbackPage: number,
    questionPages: readonly number[] = [fallbackPage],
  ): Promise<ReExtractPageSource> {
    const owner = await this.documents.findById(documentId);
    if (!owner || owner.deletedAt !== null) throw errors.documentNotFound(documentId);
    if (owner.kind !== 'question') {
      throw errors.validation({
        message: 'Questions can only be re-extracted from a question document.',
      });
    }
    if (!source || source.documentId === owner.id) {
      if (source?.target) {
        throw errors.validation({
          message: 'An Answer or Solution target is only valid for a grouped companion PDF.',
        });
      }
      const page = source?.page ?? fallbackPage;
      if (source) assertReExtractPageOwnsQuestions(owner, 'question', page, questionPages);
      return {
        documentId: owner.id,
        page,
        sourceKind: 'question',
        inlineAnswers: owner.answerLayout === 'inline',
      };
    }
    const candidate = await this.documents.findById(source.documentId);
    if (!candidate || candidate.deletedAt !== null)
      throw errors.documentNotFound(source.documentId);
    if (!isSiblingReExtractSource(owner, candidate)) {
      throw errors.validation({
        message:
          'Re-extract source must be this question PDF or its matching Answer/Solution upload.',
      });
    }
    if (candidate.kind === 'companion' && !source.target) {
      throw errors.validation({
        message:
          'Choose whether this combined companion page should re-extract the Answer or the Solution.',
      });
    }
    if (candidate.kind !== 'companion' && source.target) {
      throw errors.validation({
        message: 'Only a grouped companion PDF accepts an Answer or Solution target.',
      });
    }
    const sourceKind: ReExtractSourceKind =
      candidate.kind === 'companion'
        ? 'companion'
        : candidate.kind === 'solution'
          ? 'solution'
          : 'answer';
    assertReExtractPageOwnsQuestions(owner, sourceKind, source.page, questionPages);
    return {
      documentId: candidate.id,
      page: source.page,
      sourceKind,
      ...(candidate.kind === 'companion' && source.target ? { fieldTarget: source.target } : {}),
      inlineAnswers: false,
    };
  }

  /**
   * Resolve the matching Answer/Solution page for this one question when Verify did not send its
   * currently displayed source page. Topic bindings are authoritative; legacy uploads retain the
   * same first-page fallback used by the Verify source pane.
   */
  private async defaultSupportingSources(
    owner: Document,
    questionPage: number,
  ): Promise<ReExtractSupportingSources> {
    if (owner.answerLayout === 'inline' || !owner.sessionId) return {};
    const documents = await this.documents.listBySession(owner.sessionId);
    const siblings = documents.filter((candidate) => isSiblingReExtractSource(owner, candidate));
    if (owner.answerLayout === 'combined') {
      const companion = siblings.find((candidate) => candidate.kind === 'companion');
      if (!companion) return {};
      const page = defaultSupportingSourcePage(owner, companion, questionPage, 'companion');
      if (page === null) return {};
      return {
        answer: { documentId: companion.id, page, target: 'answer' },
        solution: { documentId: companion.id, page, target: 'solution' },
      };
    }

    const answer = siblings.find((candidate) => candidate.kind === 'answer');
    const solution = siblings.find((candidate) => candidate.kind === 'solution');
    const answerPage = answer
      ? defaultSupportingSourcePage(owner, answer, questionPage, 'answer')
      : null;
    const solutionPage = solution
      ? defaultSupportingSourcePage(owner, solution, questionPage, 'solution')
      : null;
    return {
      ...(answer && answerPage !== null
        ? {
            answer: {
              documentId: answer.id,
              page: answerPage,
            },
          }
        : {}),
      ...(solution && solutionPage !== null
        ? {
            solution: {
              documentId: solution.id,
              page: solutionPage,
            },
          }
        : {}),
    };
  }

  /**
   * Resolve the Answer/Solution pages used only by a whole selected-question re-read. A UI-provided
   * page wins over the range default, while any field not supplied by the UI is still discovered from
   * the question document's linked sibling PDFs.
   */
  private async resolveSupportingReExtractSources(
    documentId: string,
    owner: Document,
    questionPage: number,
    supportingSources: ReExtractSupportingSources,
  ): Promise<{ answer: ReExtractPageSource | null; solution: ReExtractPageSource | null }> {
    const defaults = await this.defaultSupportingSources(owner, questionPage);
    const sources = { ...defaults, ...supportingSources };
    const resolve = async (
      field: 'answer' | 'solution',
      source: ReExtractSource | undefined,
    ): Promise<ReExtractPageSource | null> => {
      if (!source) return null;
      const resolved = await this.resolveReExtractSource(documentId, source, questionPage, [questionPage]);
      if (!sourceCanSupplyField(resolved, field)) {
        throw errors.validation({
          message: `The selected ${field} source does not match this question's ${field} PDF.`,
        });
      }
      return resolved;
    };
    const [answer, solution] = await Promise.all([
      resolve('answer', sources.answer),
      resolve('solution', sources.solution),
    ]);
    return { answer, solution };
  }

  /** Render and read one already-validated page while keeping source grammar out of the caller. */
  private async readReExtractSource(
    question: Question,
    source: ReExtractPageSource,
    questionType: string | null,
  ): Promise<QuestionReExtraction> {
    const png = await this.pages.renderPage(source.documentId, source.page);
    return this.reExtractor.reExtract({
      png,
      questionNumber: question.questionNumber,
      stemHint: question.stem,
      questionType,
      sourceKind: source.sourceKind,
      ...(source.fieldTarget ? { fieldTarget: source.fieldTarget } : {}),
      ...(source.inlineAnswers ? { inlineAnswers: true } : {}),
    });
  }

  /** A missing/illegible optional supporting page must never discard the selected question's read. */
  private async tryReadSupportingSource(
    question: Question,
    source: ReExtractPageSource | null,
    questionType: string | null,
    field: 'answer' | 'solution',
  ): Promise<QuestionReExtraction | null> {
    if (!source) return null;
    try {
      return await this.readReExtractSource(question, source, questionType);
    } catch (error) {
      logger.warn(
        {
          questionId: question.id,
          questionNumber: question.questionNumber,
          field,
          sourceDocumentId: source.documentId,
          sourcePage: source.page,
          err: error instanceof Error ? error.message : String(error),
        },
        'Supporting source re-extract failed; preserving the selected question read',
      );
      return null;
    }
  }

  /**
   * Re-read one already-extracted question's source page and return its fields afresh (stem,
   * options, answer, explanation) — the verify screen's "read the page again" action. The question
   * is resolved from its document (which also gives its identity: number/stem/type). By default the
   * page read is the question's own source page; `source` redirects it to another document + page —
   * the sibling answer/solution PDF for this topic — so an answer/explanation re-read reads from that
   * sheet, not the question paper. A whole-card request may also provide `supportingSources`: those
   * linked pages enrich only this question's answer/explanation without changing its source structure.
   */
  async reExtractQuestion(
    documentId: string,
    questionId: string,
    source?: ReExtractSource,
    questionTypeOverride?: string | null,
    supportingSources?: ReExtractSupportingSources,
  ): Promise<ReExtractedQuestion> {
    const questions = await this.questions.findByDocument(documentId);
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) throw errors.questionNotFound(questionId);
    const resolvedSource = await this.resolveReExtractSource(
      documentId,
      source,
      question.sourceRegion.page,
      [question.sourceRegion.page],
    );
    // When the operator has changed the type in verify (not yet saved), honour that choice so the
    // model extracts the right shape for it; otherwise fall back to the question's stored type.
    const questionType = questionTypeOverride ?? question.questionType;
    const primary = await this.readReExtractSource(question, resolvedSource, questionType);
    let answerRead: QuestionReExtraction | null = null;
    let solutionRead: QuestionReExtraction | null = null;
    // A whole-card Verify re-read is still scoped to this ONE question. The question PDF owns
    // structure; linked source PDFs enrich only its answer/explanation. Per-field reads omit this
    // object and therefore retain their existing one-source behavior.
    if (supportingSources !== undefined && resolvedSource.sourceKind === 'question') {
      const owner = await this.documents.findById(documentId);
      if (owner && owner.deletedAt === null) {
        try {
          const supporting = await this.resolveSupportingReExtractSources(
            documentId,
            owner,
            question.sourceRegion.page,
            supportingSources,
          );
          [answerRead, solutionRead] = await Promise.all([
            this.tryReadSupportingSource(question, supporting.answer, questionType, 'answer'),
            this.tryReadSupportingSource(question, supporting.solution, questionType, 'solution'),
          ]);
        } catch (error) {
          logger.warn(
            {
              questionId: question.id,
              questionNumber: question.questionNumber,
              err: error instanceof Error ? error.message : String(error),
            },
            'Supporting sources could not be resolved; preserving the selected question read',
          );
        }
      }
    }
    const usage = combinedUsage(primary.usage, [answerRead, solutionRead]);
    const merged: ReExtractedQuestion = {
      stem: primary.stem,
      options: primary.options,
      // The answer key is canonical, then a solution can backfill it, then retain an inline/marked
      // question-page answer. Worked solutions are the best explanation source.
      answer: firstNonBlank(answerRead?.answer ?? '', solutionRead?.answer ?? '', primary.answer),
      explanation: firstExplanation(
        solutionRead?.explanation ?? null,
        answerRead?.explanation ?? null,
        primary.explanation,
      ),
      match: primary.match,
    };
    try {
      await this.usage.recordUsage({ source: 'reextract', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record question re-extract token usage');
    }
    return normalizeMatrixReExtract(
      question,
      merged,
      questionType,
      resolvedSource.sourceKind,
    );
  }

  /**
   * Re-read a COMPREHENSION GROUP off its source page(s) (BLA-125). The user can update just the
   * shared passage, or the passage plus its sub-questions. The group is resolved from its `passageId`
   * within the document (its rows, source pages, and per-child types). Each re-extracted child is
   * matched back to the existing row by the model's stable member index, then printed number, then
   * position, so a duplicate/absent number never shifts another child's draft. `source` redirects the
   * read exactly as {@link reExtractQuestion} (e.g. a sibling answer/solution page); otherwise every
   * distinct question-source page that contains a member is supplied in reading order.
   */
  async reExtractGroup(
    documentId: string,
    passageId: string,
    source?: ReExtractSource,
    questionTypeOverride?: string | null,
    mode: ReExtractGroupMode = 'passage_and_questions',
  ): Promise<ReExtractedGroup> {
    const [questions, passages] = await Promise.all([
      this.questions.findByDocument(documentId),
      this.questions.findPassagesByDocument(documentId),
    ]);
    // findByDocument returns PDF reading order, which orders a group by groupOrder — so the group's
    // rows arrive in the same order the model reads its sub-questions down the page.
    const group = questions.filter((candidate) => candidate.passageId === passageId);
    const first = group[0];
    if (!first) throw errors.comprehensionGroupNotFound(passageId);
    const passageRow = passages.find((candidate) => candidate.id === passageId);
    const resolvedSource = await this.resolveReExtractSource(
      documentId,
      source,
      first.sourceRegion.page,
      group.map((question) => question.sourceRegion.page),
    );
    if (mode === 'passage_only' && resolvedSource.sourceKind !== 'question') {
      throw errors.validation({
        message:
          'Passage-only re-extraction must read the question PDF, where the passage is printed.',
      });
    }
    // A source override names one explicit sibling page. Without one, a comprehension may span
    // multiple question-PDF pages, so send each member page in reading order rather than silently
    // re-reading only the first page and losing later sub-questions.
    const sourcePages = source
      ? [resolvedSource.page]
      : mode === 'passage_only'
        ? [first.sourceRegion.page]
        : [...new Set(group.map((question) => question.sourceRegion.page))].sort((a, b) => a - b);
    const pngs = await Promise.all(
      sourcePages.map((sourcePage) => this.pages.renderPage(resolvedSource.documentId, sourcePage)),
    );
    const { passage, subQuestions, usage } = await this.reExtractor.reExtractGroup({
      pngs,
      mode,
      members: group.map((question) => ({
        questionNumber: question.questionNumber,
        stemHint: question.stem,
        // A legacy group request sent one `questionType`; only use it when an old row has no type.
        // Never let a first-child type incorrectly force every mixed child into that shape.
        questionType: question.questionType ?? questionTypeOverride ?? null,
      })),
      // A manually-created group has an empty passage until this first read. Do not falsely anchor
      // the prompt to the first question stem; the prompt instead targets the passage before it.
      passageHint: passageRow?.text.trim() ?? '',
      sourceKind: resolvedSource.sourceKind,
      ...(resolvedSource.fieldTarget ? { fieldTarget: resolvedSource.fieldTarget } : {}),
      ...(resolvedSource.inlineAnswers ? { inlineAnswers: true } : {}),
    });
    try {
      await this.usage.recordUsage({ source: 'reextract', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record comprehension group re-extract token usage');
    }
    // Fall back to the group's existing passage if the model somehow returned an empty one. The client
    // applies this passage to the group's Passage record (a single PATCH), not to every sub-question.
    const resolvedPassage = passage || (passageRow?.text ?? '');
    return {
      mode,
      passage: resolvedPassage,
      // Defend the passage-only contract even if a future adapter ignores the requested mode.
      subQuestions:
        mode === 'passage_only'
          ? []
          : matchGroupSubQuestions(group, subQuestions, resolvedSource.sourceKind),
    };
  }

  /**
   * AI-fill the PYQ paper-details form: read the whole-paper metadata off a rendered header-page
   * image (rasterized in the browser before upload) and return the fields the page prints. Records
   * the token spend like the other vision reads; a blank field simply means the page did not show it.
   */
  async extractPaperMetadata(png: Buffer): Promise<PaperMetadata> {
    const { paper, usage } = await this.paperMetadata.extract({ png });
    try {
      await this.usage.recordUsage({ source: 'paper-metadata', ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record paper-metadata token usage');
    }
    return paper;
  }

  /** Refine one field, optionally giving the model the scanner's remaining findings. */
  async refineLatex(text: string, issues: Parameters<LatexRefiner['refine']>[1] = []): Promise<string> {
    if (!text.trim()) return text;
    const { text: refined, usage } = await this.refiner.refine(text, issues);
    try {
      await this.usage.recordUsage({ source: 'latex', ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record LaTeX refiner token usage');
    }
    return refined;
  }

  /**
   * Transcribe one user-selected rectangle from the question PDF into a single matrix field. Unlike
   * page re-extraction, the browser has already cropped the source image, so adjacent rows/columns
   * cannot be read or overwritten. The document check also keeps token usage attribution honest.
   */
  async transcribeSourceArea(
    documentId: string,
    png: Buffer,
    target: TranscribeAreaTarget,
  ): Promise<string> {
    const document = await this.documents.findById(documentId);
    if (!document || document.deletedAt !== null) throw errors.documentNotFound(documentId);
    if (document.kind !== 'question') {
      throw errors.validation({
        message: 'Source-area transcription is available only for question PDFs.',
      });
    }
    const { text, usage } = await this.reExtractor.transcribeArea({ png, target });
    try {
      await this.usage.recordUsage({ source: 'area-transcribe', documentId, ...usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: message }, 'Failed to record source-area transcription token usage');
    }
    return text;
  }
}

/**
 * A stable id for a manually-created comprehension passage, derived from the document + its member
 * question ids (sorted, so it is order-independent and re-grouping the same set is idempotent). Distinct
 * from the extraction path's text-derived id — a manual group has no passage text until it is re-read.
 */
function makePassageId(documentId: string, questionIds: string[]): string {
  const seed = [...questionIds].sort().join(',');
  return createHash('sha1').update(`${documentId}\n${seed}`).digest('hex').slice(0, 24);
}

/**
 * Match a group's freshly re-extracted children back to their existing rows. The prompt's `member_index`
 * is the primary key; printed number and source order remain compatibility fallbacks for an older or
 * partial model reply. Each draft is consumed once, so duplicate question numbers cannot shift another
 * child. Rows with no matching entry are omitted and keep their current Verify draft.
 */
function matchGroupSubQuestions(
  group: Question[],
  drafts: ReExtractedSubDraft[],
  sourceKind: ReExtractSourceKind,
): ReExtractedSubQuestion[] {
  const used = new Set<number>();
  const result: ReExtractedSubQuestion[] = [];
  group.forEach((row, index) => {
    let draftIndex = drafts.findIndex((draft, i) => !used.has(i) && draft.memberIndex === index);
    if (row.questionNumber !== null) {
      if (draftIndex === -1) {
        draftIndex = drafts.findIndex(
          (draft, i) => !used.has(i) && draft.questionNumber === row.questionNumber,
        );
      }
    }
    if (draftIndex === -1 && index < drafts.length && !used.has(index)) draftIndex = index;
    const draft = draftIndex === -1 ? undefined : drafts[draftIndex];
    if (!draft) return;
    used.add(draftIndex);
    const normalized = normalizeMatrixReExtract(
      row,
      {
        stem: draft.stem,
        options: draft.options,
        answer: draft.answer,
        explanation: draft.explanation,
        // Only a matrix member may receive a rebuilt match table. A malformed/misclassified reply
        // must never attach matrix columns to another child merely because it shared a passage.
        match: row.questionType === 'matrix' ? draft.match : null,
      },
      row.questionType,
      sourceKind,
    );
    result.push({
      questionId: row.id,
      ...normalized,
    });
  });
  return result;
}
