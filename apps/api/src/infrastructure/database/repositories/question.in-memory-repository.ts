import type { NewQuestion, QuestionRepository } from '../../../modules/questions/index.js';

/** Dev/test adapter for {@link QuestionRepository}. Holds extracted questions per document in a Map. */
export class InMemoryQuestionRepository implements QuestionRepository {
  private readonly byDocument = new Map<string, NewQuestion[]>();

  replaceForDocument(documentId: string, questions: NewQuestion[]): Promise<number> {
    this.byDocument.set(documentId, questions);
    return Promise.resolve(questions.length);
  }
}
