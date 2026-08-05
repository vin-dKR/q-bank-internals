import { UploadedImageSchema } from '@ingest/contracts';
import { request } from './http-client.js';

/**
 * Upload one cropped PNG to the publish-ready bucket under `name`, returning its public URL. The one
 * crop-upload path (§6.4), shared by the verify crop workspace and the published-bank fix flow. Keyed
 * on a question id only to namespace the stored object — the endpoint just stages the bytes.
 */
export function uploadCrop(questionId: string, name: string, blob: Blob): Promise<{ url: string }> {
  const form = new FormData();
  form.append('name', name);
  form.append('file', blob, `${name}.png`);
  return request(`/questions/${questionId}/images`, {
    method: 'POST',
    body: form,
    schema: UploadedImageSchema,
  });
}
