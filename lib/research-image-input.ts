/**
 * The OpenAI background worker cannot always download Etsy-hosted image URLs.
 * Fetch verified Etsy assets server-side and supply data URLs instead.
 * A failure is explicit: never silently omit a user-selected reference.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;

export function isEtsyImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'etsystatic.com' || url.hostname.endsWith('.etsystatic.com')) &&
      !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function safeRejectedImageResearch(job?: {
  status: string; responseId?: string; error?: string;
}): boolean {
  // A definitive OpenAI 400 response was rejected before generating a
  // background response ID. Other failures may have incurred charges.
  return Boolean(job && job.status === 'failed' && !job.responseId &&
    /^OpenAI background research failed to start \(HTTP 400\):/.test(job.error || '') &&
    /Unable to download content from the provided URL/.test(job.error || ''));
}

export async function fetchResearchImageDataUrls(
  urls: string[],
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  if (!urls.length || urls.length > 24 || urls.some(url => !isEtsyImageUrl(url))) {
    throw Error('Select 1–24 genuine HTTPS Etsy image references');
  }
  // Download at most three references at once. The earlier sequential loop
  // delayed *all* paid Research workers before any of them could start.
  // Preserve the original reference order and enforce the same shared budget.
  let totalBytes = 0;
  let nextIndex = 0;
  const output: string[] = new Array(urls.length);
  async function prepareOne(index: number): Promise<void> {
    const response = await fetcher(urls[index], {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif' },
    });
    if (!response.ok || !response.body || (response.status >= 300 && response.status < 400)) {
      throw Error('Could not retrieve Etsy reference image ' + (index + 1) +
        ' (HTTP ' + response.status + '). Re-load the images and try again.');
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(mime)) {
      await response.body.cancel().catch(() => {});
      throw Error('Etsy reference image ' + (index + 1) + ' has unsupported content type');
    }
    const advertised = Number(response.headers.get('content-length') || 0);
    if (advertised > MAX_IMAGE_BYTES) {
      await response.body.cancel().catch(() => {});
      throw Error('Etsy reference image ' + (index + 1) + ' exceeds the bounded image input budget');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let imageBytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        imageBytes += value.byteLength;
        // JavaScript executes each increment synchronously. All parallel
        // downloads therefore share one strict total memory/transfer budget.
        totalBytes += value.byteLength;
        if (imageBytes > MAX_IMAGE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
          throw Error('Etsy reference image ' + (index + 1) + ' exceeds the bounded image input budget');
        }
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!imageBytes) throw Error('Etsy reference image ' + (index + 1) + ' is empty');
    const fragments: string[] = [];
    for (const chunk of chunks) {
      for (let offset = 0; offset < chunk.length; offset += 8192)
        fragments.push(String.fromCharCode(...chunk.subarray(offset, offset + 8192)));
    }
    const binary = fragments.join('');
    const valid = mime === 'image/jpeg' ? binary.startsWith('\xff\xd8\xff')
      : mime === 'image/png' ? binary.startsWith('\x89PNG\r\n\x1a\n')
      : mime === 'image/webp' ? binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP'
      : binary.startsWith('GIF87a') || binary.startsWith('GIF89a');
    if (!valid) throw Error('Etsy reference image ' + (index + 1) + ' is not a valid ' + mime + ' image');
    output[index] = 'data:' + mime + ';base64,' + btoa(binary);
  }
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      await prepareOne(index);
    }
  }));
  return output;
}
