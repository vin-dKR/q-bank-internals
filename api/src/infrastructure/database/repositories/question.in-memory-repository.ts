import { randomUUID } from 'node:crypto';
import type { Question, UpdateQuestion } from '@ingest/contracts';
import { type NewQuestion, type QuestionRepository, sortByPdfOrder } from '../../../modules/questions/index.js';

/** Dev/test adapter for {@link QuestionRepository}. Holds extracted questions per document in a Map. */
export class InMemoryQuestionRepository implements QuestionRepository {
  private readonly byDocument = new Map<string, Question[]>();

  replaceForDocument(documentId: string, questions: NewQuestion[]): Promise<number> {
    const now = new Date().toISOString();
    const rows: Question[] = questions.map((question) => ({
      id: randomUUID(),
      documentId,
      questionNumber: question.questionNumber,
      path: question.path,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      match: question.match,
      explanation: question.explanation,
      images: question.images,
      isQuestionImage: false,
      questionImage: null,
      isOptionImage: false,
      optionImages: [],
      explanationImages: [],
      imageCrops: [],
      questionType: question.questionType,
      sectionName: question.sectionName,
      topic: question.topic,
      flagged: false,
      isPyq: question.isPyq,
      pyqExam: question.pyqExam,
      pyqYear: question.pyqYear,
      paper: question.paper,
      sourceRegion: question.sourceRegion,
      createdAt: now,
      updatedAt: now,
    }));
    this.byDocument.set(documentId, rows);
    return Promise.resolve(rows.length);
  }

  findByDocument(documentId: string): Promise<Question[]> {
    return Promise.resolve(sortByPdfOrder(this.byDocument.get(documentId) ?? []));
  }

  deleteByDocument(documentId: string): Promise<void> {
    this.byDocument.delete(documentId);
    return Promise.resolve();
  }

  update(id: string, patch: UpdateQuestion): Promise<Question> {
    for (const [documentId, rows] of this.byDocument) {
      const existing = rows.find((row) => row.id === id);
      if (!existing) continue;
      const index = rows.indexOf(existing);
      const updated: Question = {
        ...existing,
        ...(patch.stem !== undefined ? { stem: patch.stem } : {}),
        ...(patch.options !== undefined ? { options: patch.options } : {}),
        ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
        ...(patch.match !== undefined ? { match: patch.match } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
        ...(patch.images !== undefined ? { images: patch.images } : {}),
        ...(patch.isQuestionImage !== undefined ? { isQuestionImage: patch.isQuestionImage } : {}),
        ...(patch.questionImage !== undefined ? { questionImage: patch.questionImage } : {}),
        ...(patch.isOptionImage !== undefined ? { isOptionImage: patch.isOptionImage } : {}),
        ...(patch.optionImages !== undefined ? { optionImages: patch.optionImages } : {}),
        ...(patch.explanationImages !== undefined ? { explanationImages: patch.explanationImages } : {}),
        ...(patch.imageCrops !== undefined ? { imageCrops: patch.imageCrops } : {}),
        ...(patch.questionType !== undefined ? { questionType: patch.questionType } : {}),
        ...(patch.sectionName !== undefined ? { sectionName: patch.sectionName } : {}),
        ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
        ...(patch.pyqExam !== undefined ? { pyqExam: patch.pyqExam } : {}),
        ...(patch.pyqYear !== undefined ? { pyqYear: patch.pyqYear } : {}),
        ...(patch.paper !== undefined ? { paper: patch.paper } : {}),
        ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
        updatedAt: new Date().toISOString(),
      };
      const next = [...rows];
      next[index] = updated;
      this.byDocument.set(documentId, next);
      return Promise.resolve(updated);
    }
    throw new Error(`Question ${id} not found in the in-memory store.`);
  }
}
