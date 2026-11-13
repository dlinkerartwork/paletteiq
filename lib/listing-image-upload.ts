/**
 * Transfer large rendered listing JPGs using the existing authenticated
 * thumbnail-background chunk endpoint. This avoids proxy/worker request-body
 * limits without resizing or redrawing any original collection asset.
 */
export const LISTING_UPLOAD_CHUNK_BYTES = 1_000_000;
export const LISTING_UPLOAD_LIMIT_BYTES = 20_000_000;

export async function readApiJson<T extends { error?: string }>(
  response: Response, label = 'Request'
): Promise<T> {
  const body = await response.text();
  let parsed: T;
  try {
    parsed = JSON.parse(body) as T;
  } catch {
    const brief = body.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (response.status === 413 || /payload too large/i.test(brief)) {
      throw new Error(label + ' rejected (HTTP 413: Payload Too Large). Retry using the chunked upload; the AI background is preserved.');
    }
    throw new Error(label + ' failed (HTTP ' + response.status + '): ' + (brief || 'Empty or non-JSON server response'));
  }
  if (!response.ok) throw new Error(parsed?.error || (label + ' failed (HTTP ' + response.status + ')'));
  return parsed;
}

type UploadResponse = { url?: string; error?: string; ok?: boolean };

export async function uploadListingJpg(
  projectId: string,
  filename: string,
  blob: Blob,
  fetcher: typeof fetch = fetch,
  onProgress?: (completed: number, total: number) => void
): Promise<string> {
  if (!blob.size || blob.size > LISTING_UPLOAD_LIMIT_BYTES) {
    throw new Error('Listing JPG is ' + (blob.size / 1_000_000).toFixed(1) +
      ' MB. The maximum stored render size is 20 MB; reduce JPG quality or simplify the layout.');
  }
  const send = async (form: FormData) => {
    const response = await fetcher('/api/thumbnail-background', { method: 'POST', body: form });
    return readApiJson<UploadResponse>(response, 'Listing JPG upload');
  };
  if (blob.size <= LISTING_UPLOAD_CHUNK_BYTES) {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('file', new File([blob], filename, { type: 'image/jpeg' }));
    const result = await send(form);
    if (!result.url) throw new Error('Listing JPG upload returned no saved image URL.');
    onProgress?.(1, 1);
    return result.url;
  }

  // The existing server endpoint accepts at most 30 parts of <= 1.2 MB each.
  // A 1 MB part keeps multipart overhead well below common proxy limits.
  const uploadId = crypto.randomUUID();
  const total = Math.ceil(blob.size / LISTING_UPLOAD_CHUNK_BYTES);
  for (let index = 0; index < total; index++) {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('action', 'chunk');
    form.set('uploadId', uploadId);
    form.set('count', String(total));
    form.set('index', String(index));
    const part = blob.slice(index * LISTING_UPLOAD_CHUNK_BYTES, (index + 1) * LISTING_UPLOAD_CHUNK_BYTES);
    form.set('file', new File([part], 'part-' + String(index), { type: 'application/octet-stream' }));
    await send(form);
    onProgress?.(index + 1, total);
  }
  const finish = new FormData();
  finish.set('projectId', projectId);
  finish.set('action', 'complete');
  finish.set('uploadId', uploadId);
  finish.set('count', String(total));
  const result = await send(finish);
  if (!result.url) throw new Error('Listing JPG assembly returned no saved image URL.');
  return result.url;
}
