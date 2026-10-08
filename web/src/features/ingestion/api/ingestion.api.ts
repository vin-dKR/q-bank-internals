import type {
  ChapterUploadMetadata,
  PaperMetadata,
  SignedUploadRequest,
  UploadChapterRequest,
  UploadChapterResponse,
  DetectStructureRequest,
  DetectStructureResult,
  StructureEstimate,
  StructureEstimateRequest,
  StructureCropOcrBatchResult,
  StructureCropOcrResult,
  StructureDetectionProgress,
} from '@ingest/contracts';
import {
  ExtractPaperMetadataResultSchema,
  SignedUploadTargetSchema,
  UploadChapterResponseSchema,
  DetectStructureResultSchema,
  StructureEstimateSchema,
  StructureCropOcrBatchResultSchema,
  StructureCropOcrResultSchema,
  StructureDetectionStreamEventSchema,
} from '@ingest/contracts';
import { request, requestEvents } from '../../../shared/api/http-client.js';
import { uploadToSignedUrl } from '../../../shared/api/signed-upload.js';
import { createStructureStreamReceiver } from './structure-stream-receiver.js';

/** Feature-scoped call to the ingestion endpoint. The only place this feature hits the network. */
export const ingestionApi = {
  estimateStructure: (input: StructureEstimateRequest): Promise<StructureEstimate> =>
    request('/ingestion/estimate-structure', {
      method: 'POST',
      body: input,
      schema: StructureEstimateSchema,
    }),
  /** Each crop is temporary; OCR removes it after returning editable text. */
  readStructureCrop: async (png: Blob, cropId: string): Promise<StructureCropOcrResult> => {
    const target = await request('/ingestion/signed-upload', {
      method: 'POST',
      body: { fileName: `structure-crop-${cropId}.png` } satisfies SignedUploadRequest,
      schema: SignedUploadTargetSchema,
    });
    await uploadToSignedUrl(target.uploadUrl, png);
    return request('/ingestion/structure-crop-ocr', {
      method: 'POST',
      body: { storagePath: target.path, cropId },
      schema: StructureCropOcrResultSchema,
    });
  },
  /** Upload a small group in parallel, then let one warm worker read them in their saved order. */
  readStructureCrops: async (
    crops: readonly { cropId: string; png: Blob }[],
  ): Promise<StructureCropOcrBatchResult> => {
    const uploadAttempts = await Promise.all(
      crops.map(async ({ cropId, png }) => {
        try {
          const target = await request('/ingestion/signed-upload', {
            method: 'POST',
            body: { fileName: `structure-crop-${cropId}.png` } satisfies SignedUploadRequest,
            schema: SignedUploadTargetSchema,
          });
          await uploadToSignedUrl(target.uploadUrl, png);
          return { cropId, storagePath: target.path, error: null };
        } catch (error) {
          return {
            cropId,
            storagePath: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const uploaded = uploadAttempts.flatMap((item) =>
      item.storagePath ? [{ cropId: item.cropId, storagePath: item.storagePath }] : [],
    );
    const failed = new Map(
      uploadAttempts.flatMap((item) =>
        item.error ? [[item.cropId, { cropId: item.cropId, result: null, error: item.error }]] : [],
      ),
    );
    if (!uploaded.length)
      return {
        crops: crops.map(
          (crop) =>
            failed.get(crop.cropId) ?? {
              cropId: crop.cropId,
              result: null,
              error: 'The OCR upload did not complete. Run OCR again.',
            },
        ),
      };
    const response = await request('/ingestion/structure-crops-ocr', {
      method: 'POST',
      body: { crops: uploaded },
      schema: StructureCropOcrBatchResultSchema,
    });
    const byId = new Map(response.crops.map((item) => [item.cropId, item]));
    return {
      crops: crops.map(
        (crop) =>
          byId.get(crop.cropId) ??
          failed.get(crop.cropId) ?? {
            cropId: crop.cropId,
            result: null,
            error: 'The OCR upload did not complete. Run OCR again.',
          },
      ),
    };
  },
  detectStructure: async (
    input: DetectStructureRequest,
    onProgress?: (progress: StructureDetectionProgress) => void,
  ): Promise<DetectStructureResult> => {
    if (!onProgress)
      return request('/ingestion/detect-structure', {
        method: 'POST',
        body: input,
        schema: DetectStructureResultSchema,
      });
    const receiver = createStructureStreamReceiver(onProgress);
    await requestEvents('/ingestion/detect-structure', {
      method: 'POST',
      body: input,
      schema: StructureDetectionStreamEventSchema,
      onEvent: receiver.onEvent,
      onJsonResponse: receiver.onJsonResponse,
    });
    return receiver.result();
  },
  /**
   * Upload one built chapter PDF in three steps: (1) get a signed slot, (2) PUT the bytes straight to
   * storage with progress, (3) finalize by reference. The bytes never transit our serverless function,
   * so a chapter larger than the ~4.5 MB request-body limit still uploads. `onProgress` reports 0–1.
   */
  uploadChapter: async (
    pdfBytes: Uint8Array,
    metadata: ChapterUploadMetadata,
    onProgress?: (fraction: number) => void,
  ): Promise<UploadChapterResponse> => {
    const fileName = `${metadata.chapter.trim() || metadata.exam.trim() || 'paper'}-${metadata.kind}.pdf`;
    const target = await request('/ingestion/signed-upload', {
      method: 'POST',
      body: { fileName } satisfies SignedUploadRequest,
      schema: SignedUploadTargetSchema,
    });
    const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
    await uploadToSignedUrl(target.uploadUrl, blob, onProgress);
    return request('/ingestion', {
      method: 'POST',
      body: { storagePath: target.path, metadata } satisfies UploadChapterRequest,
      schema: UploadChapterResponseSchema,
    });
  },

  /**
   * AI-fill the PYQ paper-details form: send a rendered header-page PNG to the vision endpoint and get
   * back the whole-paper metadata it could read. Used pre-upload, so it posts the image directly
   * rather than referencing a stored document.
   */
  extractPaperMetadata: async (headerPng: Blob): Promise<PaperMetadata> => {
    const form = new FormData();
    form.append('file', headerPng, 'paper-header.png');
    const result = await request('/questions/paper-metadata', {
      method: 'POST',
      body: form,
      schema: ExtractPaperMetadataResultSchema,
    });
    return result.paper;
  },
};
