/**
 * PUT a file's bytes straight to a Supabase signed upload URL, reporting fractional progress (0–1).
 *
 * Sends the Blob itself as the request body (the same `fileBody` contract as Supabase's signed-upload
 * API), rather than wrapping it in multipart form data. This preserves the exact PDF byte stream that
 * Cut & Upload produced all the way through temporary storage and Drive. XMLHttpRequest is used only
 * because it exposes upload progress; it does not transform the content.
 */
export function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('cache-control', '3600');
    xhr.setRequestHeader('content-type', file.type || 'application/pdf');
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
    xhr.onerror = () => {
      reject(new Error('Upload failed: network error.'));
    };
    xhr.onabort = () => {
      reject(new Error('Upload cancelled.'));
    };
    xhr.send(file);
  });
}
