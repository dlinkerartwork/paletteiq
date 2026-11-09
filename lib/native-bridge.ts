import { env } from 'cloudflare:workers';

type BridgeConfig = { url: string; token: string };

function bridgeConfig(): BridgeConfig | null {
  const variables = env as unknown as Record<string, string | undefined>;
  const url = variables.PALETTEIQ_NATIVE_BRIDGE_URL;
  const token = variables.PALETTEIQ_NATIVE_BRIDGE_TOKEN;
  if (!url || !token || variables.PALETTEIQ_DESKTOP !== '1') return null;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Native bridge must use loopback');
  return { url, token };
}

async function bridgeRequest(config: BridgeConfig, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.url}${path}`, { ...init, headers: { Authorization: `Bearer ${config.token}`, ...init.headers } });
  if (!response.ok) throw new Error(`Desktop storage: ${response.status} ${(await response.text()).slice(0, 240)}`);
  return response;
}

export function nativeDatabase(): D1Database | null {
  const config = bridgeConfig();
  if (!config) return null;
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const query = async () => (await bridgeRequest(config, '/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) })).json() as Promise<{ results: Record<string, unknown>[]; meta?: unknown; success?: boolean }>;
    const statement = {
      bind(...values: unknown[]) { params = values; return this; },
      async run() { return query(); },
      async all() { return query(); },
      async first() { return (await query()).results[0] ?? null; },
      async raw() { return (await query()).results.map(row => Object.values(row)); },
    };
    return statement;
  };
  return { prepare, batch: async (statements: Array<{ all(): Promise<unknown> }>) => Promise.all(statements.map(stmt => stmt.all())) } as unknown as D1Database;
}

export function nativeAssetBucket(): R2Bucket | null {
  const config = bridgeConfig();
  if (!config) return null;
  const endpoint = (key: string) => {
    if (!/^generated\/[\w-]{1,120}\/(?:batches\/[0-9a-f-]{36}\/)?[0-9a-f-]{36}\.(?:jpg|png)$/.test(key)) throw new Error('Invalid image key');
    return `/assets/${key}`;
  };
  return {
    async put(key: string, value: ArrayBuffer | Uint8Array | string) {
      await bridgeRequest(config, endpoint(key), { method: 'PUT', body: typeof value === 'string' ? value : value instanceof Uint8Array ? new Uint8Array(value).buffer as ArrayBuffer : value });
      return { key };
    },
    async head(key: string) {
      const result = await fetch(`${config.url}${endpoint(key)}`, { method: 'HEAD', headers: { Authorization: `Bearer ${config.token}` } });
      if (result.ok) return { key };
      return env.BUCKET ? env.BUCKET.head(key) : null;
    },
    async get(key: string) {
      const result = await fetch(`${config.url}${endpoint(key)}`, { headers: { Authorization: `Bearer ${config.token}` } });
      if (result.ok) return { key, body: result.body };
      const legacy = await env.BUCKET?.get(key);
      if (!legacy) return null;
      const data = await legacy.arrayBuffer();
      await bridgeRequest(config, endpoint(key), { method: 'PUT', body: data });
      return { key, body: new Response(data).body };
    },
  } as unknown as R2Bucket;
}
