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


/**
 * One complete, circular pass through the configured keys per operation.
 * The next call starts at the next key, including wrapping back to key 1.
 * This cursor is an in-memory optimization, scoped to the store; a fresh
 * worker isolate safely starts from key 1 again.
 */
const nextGeminiKeyByOwner = new Map<string, number>();
export function geminiKeyCycle(owner: string, keys: string[]): string[] {
  const unique = [...new Set(keys.map(key => key.trim()).filter(Boolean))];
  if (!unique.length) return [];
  const start = (nextGeminiKeyByOwner.get(owner) ?? 0) % unique.length;
  nextGeminiKeyByOwner.set(owner, (start + 1) % unique.length);
  return [...unique.slice(start), ...unique.slice(0, start)];
}

/** Do not confuse model, permission, and provider failures with exhausted quota. */
export function isGeminiQuotaResponse(status: number, detail: string): boolean {
  if (status === 429) return true;
  try {
    const error = (JSON.parse(detail) as { error?: { status?: string; message?: string } }).error;
    return error?.status === 'RESOURCE_EXHAUSTED' ||
      (status === 403 && /quota (?:exceeded|exhausted)|rate limit exceeded/i.test(error?.message ?? ''));
  } catch {
    return status === 403 && /quota (?:exceeded|exhausted)|rate limit exceeded/i.test(detail);
  }
}

export const GEMINI_ALL_KEYS_EXHAUSTED = 'All configured Gemini API keys have exhausted their quotas. Add or replenish a key in Settings, then retry.';
