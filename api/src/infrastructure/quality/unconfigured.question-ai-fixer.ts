import type { AppError } from '../../shared/errors/app-error.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { AiFixOutput, ChapterChoiceOutput, QuestionAiFixer } from '../../modules/quality/index.js';

function notConfigured(): AppError {
  return errors.extractionFailed('the AI fixer is not configured. Set OPENAI_API_KEY to fix questions with AI.');
}

/** Null-object {@link QuestionAiFixer} for a deployment with no OpenAI key: fails loudly, never silently. */
export class UnconfiguredQuestionAiFixer implements QuestionAiFixer {
  fix(): Promise<AiFixOutput> {
    return Promise.reject(notConfigured());
  }

  chooseChapter(): Promise<ChapterChoiceOutput> {
    return Promise.reject(notConfigured());
  }
}
