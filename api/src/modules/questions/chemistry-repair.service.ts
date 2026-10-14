import { isDeepStrictEqual } from 'node:util';
import { chemistrySourceOptionText, chemistrySourceText, chemistryTranscriptionOptionText, type ChemistryExtraction, type ChemistryRepairResult, type Question, type UpdateQuestion } from '@ingest/contracts';
import type { DocumentRepository } from '../documents/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionRepository } from './questions.repository.js';

type RepairIssue = ChemistryRepairResult['unresolved'][number];

function restoreField(
  question: Question,
  field: ChemistryExtraction['visuals'][number]['field'],
  current: string,
  candidate: string | undefined,
  issues: RepairIssue[],
  optionLabel?: string,
): string {
  if (candidate === undefined || !candidate.trim()) {
    if ((!current.trim() || current.includes('[See source diagram]')) && question.chemistry?.visuals.some((visual) => visual.field === field)) {
      issues.push({ questionId: question.id, field, message: `${optionLabel ? `Option ${optionLabel}` : field} has no saved molecular transcription. Read this field again or add a manual source figure if recognition is unavailable.` });
      return current.replaceAll('[See source diagram]', '').trim();
    }
    return current;
  }
  if (optionLabel !== undefined) {
    const printed = /^\s*(?:\(([^()]+)\)|([A-Za-z0-9]+)[.)])\s*/.exec(candidate);
    const candidateLabel = printed?.[1] ?? printed?.[2];
    if (candidateLabel && candidateLabel.trim().toUpperCase() !== optionLabel.trim().toUpperCase()) {
      issues.push({ questionId: question.id, field, message: `Option ${optionLabel}'s saved candidate belongs to a different printed choice. Your current text was kept.` });
      return current;
    }
  }
  const extracted = optionLabel === undefined ? candidate : chemistryTranscriptionOptionText(candidate, optionLabel);
  const sourceText = optionLabel === undefined ? chemistrySourceText(candidate) : chemistrySourceOptionText(candidate, optionLabel);
  if (!current.trim() || current === sourceText || current === extracted) return extracted;
  // Candidate restoration converts only the previous extractor output. A teacher's wording or
  // corrected molecule must never be reverted to an older prediction.
  return current;
}

function restoreTranscription(question: Question, chemistry: ChemistryExtraction, issues: RepairIssue[]): UpdateQuestion {
  const evidenceUrls = new Set(chemistry.visuals.flatMap((visual) => visual.cropUrl ? [visual.cropUrl] : []));
  const fieldUrls = (field: ChemistryExtraction['visuals'][number]['field']): Set<string> => new Set(chemistry.visuals.filter((visual) => visual.field === field).flatMap((visual) => visual.cropUrl ? [visual.cropUrl] : []));
  const stemUrls = fieldUrls('stem');
  const answerUrls = fieldUrls('answer');
  const explanationUrls = fieldUrls('explanation');
  const questionImages = (question.questionImage ?? '').split(',').map((url) => url.trim()).filter((url) => url && !stemUrls.has(url));
  const optionImages = question.optionImages.map((url, index) => {
    const label = question.options[index]?.label;
    const isExtracted = chemistry.visuals.some((visual) => visual.field === 'option' && visual.cropUrl === url && visual.optionLabel?.trim().replace(/[()]/g, '').toUpperCase() === label?.trim().toUpperCase());
    return isExtracted ? '' : url;
  });
  return {
    stem: restoreField(question, 'stem', question.stem, chemistry.candidateStem, issues),
    options: question.options.map((option, index) => ({
      ...option,
      body: restoreField(question, 'option', option.body, chemistry.candidateOptions[index], issues, option.label),
    })),
    answer: restoreField(question, 'answer', question.answer, chemistry.candidateAnswer, issues),
    explanation: restoreField(question, 'explanation', question.explanation ?? '', chemistry.candidateExplanation, issues) || null,
    questionImage: questionImages.length ? questionImages.join(',') : null,
    isQuestionImage: question.isQuestionImage && questionImages.length > 0,
    optionImages: optionImages.some(Boolean) ? optionImages : [],
    isOptionImage: question.isOptionImage && optionImages.some(Boolean),
    answerImages: question.answerImages.filter((url) => !answerUrls.has(url)),
    explanationImages: question.explanationImages.filter((url) => !explanationUrls.has(url)),
    imageCrops: question.imageCrops.filter((crop) => !evidenceUrls.has(crop.url)),
    chemistry: { ...chemistry, representation: 'transcription', status: 'needs_review' },
  };
}

/** Restore saved SMILES locally; source evidence remains available for checking and manual fallback. */
export class ChemistryRepairService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly documents: DocumentRepository,
  ) {}

  async repair(documentId: string, questionId?: string): Promise<ChemistryRepairResult> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.kind !== 'question' || document.deletedAt !== null) throw errors.validation({ message: 'Chemistry recovery requires an active question PDF.' });
    const all = await this.questions.findByDocument(documentId);
    const selected = questionId ? all.filter((question) => question.id === questionId) : all;
    if (questionId && selected.length === 0) throw errors.questionNotFound(questionId);
    const result: ChemistryRepairResult = { updated: [], unchanged: 0, unresolved: [] };
    for (const question of selected) {
      const chemistry = question.chemistry;
      if (!chemistry || chemistry.representation === 'transcription') { result.unchanged += 1; continue; }
      const patch = restoreTranscription(question, chemistry, result.unresolved);
      const latest = await this.questions.findById(question.id);
      if (!latest || !isDeepStrictEqual(question, latest)) {
        result.unresolved.push({ questionId: question.id, field: 'stem', message: 'This question changed during recovery. Refresh before retrying; your current edits were kept.' });
        result.unchanged += 1;
        continue;
      }
      result.updated.push(await this.questions.update(question.id, patch));
    }
    return result;
  }
}
