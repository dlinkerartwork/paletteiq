export function parseGeminiKeyring(value: string | null): string[] {
  if (!value) return [];
  let items: unknown;
  try { items = JSON.parse(value); } catch { return [value]; }
  if (!Array.isArray(items)) return [value];
  return items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10);
}

export const serializeGeminiKeyring = (items: string[]) => JSON.stringify([...new Set(items)].slice(0, 10));

// Quota/rate limiting is account/key dependent. Transient 503 and model 404 are
// not quota failures, and must not trigger rotation to another API key.
export function isGeminiQuotaExhausted(status: number, errorStatus?: string): boolean {
  return status === 429 || errorStatus === 'RESOURCE_EXHAUSTED';
}

export function isGeminiModelUnavailable(status: number, message: string): boolean {
  return status === 404 && /model|not found|no longer available|not supported/i.test(message);
}
