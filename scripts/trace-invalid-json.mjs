// Opt-in diagnostic preload for startup failures originating inside Vinext,
// Vite, Wrangler or Cloudflare plugins. Never change request behavior.
const originalJson = Response.prototype.json;

function safeLocation(raw) {
  try {
    const url = new URL(raw);
    return url.protocol + '//' + url.hostname + url.pathname;
  } catch { return '<unknown>'; }
}

Response.prototype.json = async function(...args) {
  let candidate = null;
  try { candidate = this.clone(); } catch { /* body already consumed */ }
  try {
    return await originalJson.apply(this, args);
  } catch (error) {
    if (error instanceof SyntaxError) {
      let preview = '<unavailable>';
      try {
        const payload = candidate ? await candidate.text() : '';
        // Preserve only the first line, redact tokens, email and URLs.
        preview = payload.slice(0, 120).split(/\r?\n/)[0]
          .replace(/sk-[\w-]+/gi, '<api-key-redacted>')
          .replace(/bearer\s+[^\s]+/gi, 'Bearer <redacted>')
          .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email-redacted>')
          .replace(/https?:\/\/[^\s"'<>]+/g, '<url-redacted>');
      } catch { /* retain original error */ }
      process.stderr.write('[PaletteIQ JSON DIAG] status=' + this.status +
        ' endpoint=' + safeLocation(this.url) +
        ' content-type=' + (this.headers.get('content-type') || 'unknown') +
        ' preview=' + JSON.stringify(preview) + '\n');
    }
    throw error;
  }
};
