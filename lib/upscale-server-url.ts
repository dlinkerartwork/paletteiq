/** Normalize user-supplied GPU endpoints. Only explicit LAN IPs and localhost are allowed. */
export function normalizeUpscaleServerUrl(input: unknown): string | null {
  if (input === '') return '';
  if (typeof input !== 'string' || input.length > 200 || input.trim() !== input) return null;
  let parsed: URL;
  try { parsed = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) return null;
  const host = parsed.hostname;
  if (host !== 'localhost') {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
    const [a, b] = parts.map(Number);
    const privateIp = a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 127 && b === 0);
    if (!privateIp) return null;
  }
  return parsed.origin;
}
