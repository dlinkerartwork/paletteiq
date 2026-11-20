import { getChatGPTUser } from '@/app/chatgpt-auth';
import { assertSameOrigin } from '@/lib/palette-accounts';
import { nativeSmtpOperation, supportsNativeSmtp } from '@/lib/native-bridge';

function privateJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return privateJson({ error: 'Sign in required' }, 401);
  if (!supportsNativeSmtp()) return privateJson({ available: false, configured: false });
  try {
    return privateJson(await nativeSmtpOperation(user.userId, { action: 'status' }));
  } catch (error) {
    // Do not expose exception bodies or native bridge tokens to the browser.
    // Return actionable categories without reflecting credentials.
    const reason = error instanceof Error ? error.message : String(error);
    const category = /Invalid active PaletteIQ store owner|Invalid store ID/.test(reason)
      ? 'store-identity'
      : /Desktop storage: 401/.test(reason) ? 'native-auth'
      : /Desktop storage: 400/.test(reason) ? 'native-request'
      : /fetch failed|ECONNREFUSED|ETIMEDOUT|TimeoutError|AbortError/i.test(reason)
        ? 'native-unreachable' : 'native-error';
    console.warn('Desktop SMTP settings status check failed:', category);
    const message = category === 'store-identity'
      ? 'SMTP store identity rejected. Update PaletteIQ Desktop and restart it completely.'
      : category === 'native-auth'
        ? 'Desktop SMTP native bridge authorization failed. Quit Desktop completely and restart.'
        : category === 'native-unreachable'
          ? 'Desktop SMTP local backend is unreachable. Quit Desktop completely and restart.'
          : 'Desktop SMTP local backend returned an error. Restart the updated Desktop app.';
    return privateJson({ error: message, code: category }, 503);
  }
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return privateJson({ error: 'Sign in required' }, 401);
  if (!assertSameOrigin(req)) return privateJson({ error: 'Cross-site SMTP request denied' }, 403);
  if (!supportsNativeSmtp()) return privateJson({
    error: 'SMTP settings are available in PaletteIQ Desktop only.',
  }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return privateJson({ error: 'Invalid SMTP request' }, 400); }
  if (!['save', 'reset', 'test'].includes(String(body.action))) {
    return privateJson({ error: 'Unknown SMTP action' }, 400);
  }
  const operation: Record<string, unknown> = { action: body.action };
  if (body.action === 'save') {
    if (typeof body.host !== 'string' || body.host.length > 253 ||
        !Number.isSafeInteger(body.port) || ![465, 587].includes(Number(body.port)) ||
        typeof body.username !== 'string' || body.username.length > 254 ||
        typeof body.sender !== 'string' || body.sender.length > 254 ||
        (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 1024))) {
      return privateJson({ error: 'Invalid SMTP host, TLS port or sender values' }, 422);
    }
    Object.assign(operation, {
      host: body.host, port: body.port, username: body.username,
      sender: body.sender, password: body.password || '',
    });
  }
  if (body.action === 'test') {
    // A valid session cannot turn this endpoint into an arbitrary mail relay.
    // Only the signed-in account's own email address may receive test mail.
    operation.recipient = user.email;
  }
  try {
    return privateJson(await nativeSmtpOperation(user.userId, operation));
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    return privateJson({ error: description.slice(0, 260) }, 422);
  }
}
