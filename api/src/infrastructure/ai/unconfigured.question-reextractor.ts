import { errors } from '../../shared/errors/error-catalog.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import type {
  GroupReExtraction,
  QuestionReExtraction,
  QuestionReExtractor,
  SourceAreaTranscription,
  TranscribeRegionInput,
} from '../../modules/questions/index.js';

/** Null-object {@link QuestionReExtractor} used when no OpenAI key is set — fails loudly on use. */
export class UnconfiguredQuestionReExtractor implements QuestionReExtractor {
  reExtract(): Promise<QuestionReExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  reExtractGroup(): Promise<GroupReExtraction> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  transcribeArea(): Promise<SourceAreaTranscription> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }

  transcribeRegion(_input: TranscribeRegionInput): Promise<{ text: string; usage: AiTokenUsage }> {
    return Promise.reject(errors.extractionFailed('OPENAI_API_KEY is not configured.'));
  }
}
