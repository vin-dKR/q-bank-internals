/**
 * PUT a file's bytes straight to a Supabase signed upload URL, reporting fractional progress (0–1).
 *
 * Mirrors what `@supabase/storage-js` `uploadToSignedUrl` sends for a Blob — a multipart body carrying
 * `cacheControl` + the file, with an `x-upsert` header — but over `XMLHttpRequest` so upload progress is
 * observable (`fetch` cannot report it). This is the transport that lets a large chapter PDF go browser →
 * storage directly, bypassing the serverless request-body limit that caps a multipart upload to our API.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed (${String(xhr.status)}).`));
      }
    };
    xhr.onerror = () => { reject(new Error('Upload failed: network error.')); };
    xhr.onabort = () => { reject(new Error('Upload cancelled.')); };
    xhr.send(form);
  });
}
