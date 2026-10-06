import {
  DetectStructureResultSchema,
  type DetectStructureResult,
  type StructureDetectionProgress,
  type StructureDetectionStreamEvent,
} from '@ingest/contracts';
import { ApiError } from '../../../shared/api/api-error.js';

export function createStructureStreamReceiver(
  onProgress: (progress: StructureDetectionProgress) => void,
): {
  onEvent: (event: StructureDetectionStreamEvent) => boolean;
  onJsonResponse: (data: unknown) => void;
  result: () => DetectStructureResult;
} {
  let result: DetectStructureResult | null = null;
  return {
    onEvent: (event) => {
      if (event.type === 'error') {
        const { code, status, message, details } = event.error;
        throw new ApiError(code, status, message, details);
      }
      if (event.type === 'result') {
        result = event.data;
        return false;
      }
      onProgress(event.progress);
      return true;
    },
    onJsonResponse: (data) => {
      result = DetectStructureResultSchema.parse(data);
    },
    result: () => {
      if (!result)
        throw new ApiError(
          'STREAM_INTERRUPTED',
          502,
          'The progress connection ended before the final JSON arrived. Generation was not restarted automatically.',
        );
      return result;
    },
  };
}
