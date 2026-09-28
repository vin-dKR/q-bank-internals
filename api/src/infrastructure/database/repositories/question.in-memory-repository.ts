import { randomUUID } from 'node:crypto';
import type { Passage, Question, UpdatePassage, UpdateQuestion } from '@ingest/contracts';
import {
  aiFilledAfterEdit,
  type NewPassage,
  type NewQuestion,
  type QuestionRepository,
  sortByPdfOrder,
} from '../../../modules/questions/index.js';

/** Dev/test adapter for {@link QuestionRepository}. Holds extracted questions + passages per document. */
export class InMemoryQuestionRepository implements QuestionRepository {
  private readonly byDocument = new Map<string, Question[]>();
  private readonly passagesByDocument = new Map<string, Passage[]>();

  replaceDocument(documentId: string, passages: NewPassage[], questions: NewQuestion[]): Promise<number> {
    const now = new Date().toISOString();
    this.passagesByDocument.set(
      documentId,
      passages.map((passage) => ({
        id: passage.id,
        documentId,
        text: passage.text,
        passageImage: passage.passageImage,
        imageCrops: passage.imageCrops,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const rows: Question[] = questions.map((question) => ({
      id: randomUUID(),
      documentId,
      questionNumber: question.questionNumber,
      path: question.path,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      match: question.match,
      passageId: question.passageId,
      groupOrder: question.groupOrder,
      explanation: question.explanation,
      images: question.images,
      isQuestionImage: false,
      questionImage: null,
      isOptionImage: false,
      optionImages: [],
      answerImages: [],
      explanationImages: [],
      imageCrops: [],
      questionType: question.questionType,
      level: question.level,
      sectionName: question.sectionName,
      topic: question.topic,
      aiFilled: question.aiFilled,
      className: question.className,
      subject: question.subject,
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

  findById(id: string): Promise<Question | null> {
    for (const rows of this.byDocument.values()) {
      const question = rows.find((row) => row.id === id);
      if (question) return Promise.resolve(question);
    }
    return Promise.resolve(null);
  }

  findPassagesByDocument(documentId: string): Promise<Passage[]> {
    return Promise.resolve([...(this.passagesByDocument.get(documentId) ?? [])]);
  }

  deleteByDocument(documentId: string): Promise<void> {
    this.byDocument.delete(documentId);
    this.passagesByDocument.delete(documentId);
    return Promise.resolve();
  }

  deleteById(id: string): Promise<Question | null> {
    for (const [documentId, rows] of this.byDocument) {
      const existing = rows.find((row) => row.id === id);
      if (!existing) continue;
      this.byDocument.set(documentId, rows.filter((row) => row.id !== id));
      // Drop the shared passage if this was its group's last member (mirrors the Prisma adapter).
      if (existing.passageId !== null) {
        const stillUsed = (this.byDocument.get(documentId) ?? []).some(
          (row) => row.passageId === existing.passageId,
        );
        if (!stillUsed) {
          const passages = this.passagesByDocument.get(documentId) ?? [];
          this.passagesByDocument.set(documentId, passages.filter((p) => p.id !== existing.passageId));
        }
      }
      return Promise.resolve(existing);
    }
    return Promise.resolve(null);
  }

  countByDocument(documentId: string): Promise<number> {
    return Promise.resolve((this.byDocument.get(documentId) ?? []).length);
  }

  update(id: string, patch: UpdateQuestion): Promise<Question> {
    for (const [documentId, rows] of this.byDocument) {
      const existing = rows.find((row) => row.id === id);
      if (!existing) continue;
      const index = rows.indexOf(existing);
      const aiFilled = aiFilledAfterEdit(existing, patch);
      const updated: Question = {
        ...existing,
        ...(aiFilled !== undefined ? { aiFilled } : {}),
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
        ...(patch.answerImages !== undefined ? { answerImages: patch.answerImages } : {}),
        ...(patch.explanationImages !== undefined ? { explanationImages: patch.explanationImages } : {}),
        ...(patch.imageCrops !== undefined ? { imageCrops: patch.imageCrops } : {}),
        ...(patch.questionType !== undefined ? { questionType: patch.questionType } : {}),
        ...(patch.level !== undefined ? { level: patch.level } : {}),
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

  updatePassage(id: string, patch: UpdatePassage): Promise<Passage> {
    for (const [documentId, rows] of this.passagesByDocument) {
      const existing = rows.find((row) => row.id === id);
      if (!existing) continue;
      const index = rows.indexOf(existing);
      const updated: Passage = {
        ...existing,
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.passageImage !== undefined ? { passageImage: patch.passageImage } : {}),
        ...(patch.imageCrops !== undefined ? { imageCrops: patch.imageCrops } : {}),
        updatedAt: new Date().toISOString(),
      };
      const next = [...rows];
      next[index] = updated;
      this.passagesByDocument.set(documentId, next);
      return Promise.resolve(updated);
    }
    throw new Error(`Passage ${id} not found in the in-memory store.`);
  }

  groupQuestions(documentId: string, passageId: string, questionIds: string[]): Promise<Passage> {
    const now = new Date().toISOString();
    const passage: Passage = {
      id: passageId,
      documentId,
      text: '',
      passageImage: null,
      imageCrops: [],
      createdAt: now,
      updatedAt: now,
    };
    const existing = (this.passagesByDocument.get(documentId) ?? []).filter((p) => p.id !== passageId);
    this.passagesByDocument.set(documentId, [...existing, passage]);

    const order = new Map(questionIds.map((id, index) => [id, index] as const));
    const rows = (this.byDocument.get(documentId) ?? []).map((q) =>
      order.has(q.id) ? { ...q, passageId, groupOrder: order.get(q.id) ?? null } : q,
    );
    this.byDocument.set(documentId, rows);
    this.pruneEmptyPassages(documentId);
    return Promise.resolve(passage);
  }

  ungroupPassage(passageId: string): Promise<void> {
    for (const [documentId, passages] of this.passagesByDocument) {
      if (!passages.some((p) => p.id === passageId)) continue;
      const rows = (this.byDocument.get(documentId) ?? []).map((q) =>
        q.passageId === passageId ? { ...q, passageId: null, groupOrder: null } : q,
      );
      this.byDocument.set(documentId, rows);
      this.passagesByDocument.set(documentId, passages.filter((p) => p.id !== passageId));
      break;
    }
    return Promise.resolve();
  }

  /** Drop passages that no question references any more (e.g. after a regroup emptied an old group). */
  private pruneEmptyPassages(documentId: string): void {
    const used = new Set(
      (this.byDocument.get(documentId) ?? [])
        .map((q) => q.passageId)
        .filter((id): id is string => id !== null),
    );
    const kept = (this.passagesByDocument.get(documentId) ?? []).filter((p) => used.has(p.id));
    this.passagesByDocument.set(documentId, kept);
  }
}
