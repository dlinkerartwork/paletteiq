import { env } from 'cloudflare:workers';

/**
 * Read-only local discovery. This is not a cross-origin API proxy: users must
 * navigate to the desktop origin for all authenticated collection operations.
 * No credentials, image URLs, collection IDs or API keys are exposed.
 */
const DESKTOP_HOST = '127.0.0.1';
const DESKTOP_PORT = '18763';
const loopbackOrigin = (origin: string): boolean => {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) &&
      (u.port === '' || /^[0-9]{1,5}$/.test(u.port) && Number(u.port) >= 1 && Number(u.port) <= 65535) &&
      u.username === '' && u.password === '' && u.pathname === '/' && !u.search && !u.hash;
  } catch { return false; }
};

function discovery(req: Request) {
  const u = new URL(req.url);
  const desktop = (env as unknown as Record<string,string|undefined>).PALETTEIQ_DESKTOP === '1' &&
    u.protocol === 'http:' && u.hostname === DESKTOP_HOST && u.port === DESKTOP_PORT;
  const origin = req.headers.get('origin') || '';
  const cors = desktop && loopbackOrigin(origin);
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });
  if (cors) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Cache-Control, Pragma, Content-Type');
    headers.set('Access-Control-Allow-Private-Network', 'true');
  }
  return { desktop, cors, headers };
}

export async function GET(req:Request) {
  const { desktop, headers } = discovery(req);
  // A non-desktop or remote target must never impersonate the shared runtime.
  return Response.json({
    service:'paletteiq-local-workspace',mode:desktop?'desktop-shared':'independent',
    shared:desktop,protocol:1,
  },{headers,status:desktop?200:404});
}

export async function OPTIONS(req:Request) {
  const {desktop,cors,headers}=discovery(req);
  return new Response(null,{status:desktop&&cors?204:403,headers});
}
