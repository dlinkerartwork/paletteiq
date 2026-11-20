/**
 * Deploy separately from the PaletteIQ desktop worker:
 *   npx wrangler deploy --config wrangler.cloud-automation-cron.jsonc
 *
 * Configure AUTOMATION_TARGET_URL as the HTTPS origin of a deployed PaletteIQ
 * app that uses persistent Cloudflare D1 + R2, and install the SAME secret in
 * both Workers using wrangler secret put PALETTEIQ_CLOUD_AUTOMATION_SECRET.
 * No desktop session cookies or OpenAI keys are stored here.
 */
interface CronEnv {
  AUTOMATION_TARGET_URL?: string;
  PALETTEIQ_CLOUD_AUTOMATION_SECRET?: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: CronEnv, _ctx: ExecutionContext) {
    const origin = env.AUTOMATION_TARGET_URL;
    const secret = env.PALETTEIQ_CLOUD_AUTOMATION_SECRET;
    if (!origin || !secret || secret.length < 32) {
      throw Error('Cloud automation target or signed scheduler secret is missing');
    }
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || url.hostname === 'localhost') {
      throw Error('Cloud automation target must be an HTTPS origin');
    }
    const timestamp = String(Date.now());
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(timestamp + ':paletteiq-full-automation-v1')));
    const signature = Array.from(mac, byte => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetch(new URL('/api/full-automation', url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paletteiq-cloud-timestamp': timestamp,
        'x-paletteiq-cloud-signature': signature,
      },
      body: JSON.stringify({ action: 'cloud-tick' }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw Error('PaletteIQ cloud automation tick HTTP ' + response.status);
    const result = await response.json() as { error?: string; results?: Array<{ error?: string }> };
    if (result.error) throw Error(result.error);
    for (const item of result.results || []) {
      if (item.error) console.warn('PaletteIQ automation paused or failed:', item.error);
    }
  },
};
