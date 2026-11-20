import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { paletteStores } from '@/db/schema';
import { getAccountSession, assertSameOrigin } from '@/lib/palette-accounts';
import { hasNativeWorkspaceImport, runNativeWorkspaceImport } from '@/lib/native-bridge';

const noStore = { 'Cache-Control': 'private, no-store' };
const error = (message: string, status = 400) =>
  Response.json({ error: message }, { status, headers: noStore });

export async function GET() {
  const session = await getAccountSession();
  if (!session) return error('Sign in to import a Desktop workspace', 401);
  try {
    return Response.json({ desktop: hasNativeWorkspaceImport(), activeStoreId: session.activeStoreId },
      { headers: noStore });
  } catch { return Response.json({ desktop:false },{ headers:noStore }); }
}

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return error('Cross-site workspace import request denied', 403);
  const session = await getAccountSession();
  if (!session) return error('Sign in to import a Desktop workspace', 401);
  if (!hasNativeWorkspaceImport()) return error('Workspace ZIP import requires PaletteIQ Desktop', 501);
  let body: {
    action?: unknown; selectionId?: unknown; storeId?: unknown;
    mode?: unknown; allowMissing?: unknown; importPreferences?: unknown;
  };
  try {
    if (Number(req.headers.get('content-length') || 0) > 5000)
      return error('Unexpected oversized request', 413);
    body = await req.json() as typeof body;
  } catch { return error('Invalid JSON request'); }
  if (!['select','preview','apply','cancel'].includes(String(body.action)))
    return error('Choose a workspace import action');
  const action = body.action as 'select' | 'preview' | 'apply' | 'cancel';
  const selectionId = typeof body.selectionId === 'string' ? body.selectionId : undefined;
  if (action !== 'select' && (!selectionId || !/^[0-9a-f-]{36}$/.test(selectionId)))
    return error('Select a workspace ZIP first');
  let storeId: string | undefined;
  let mode: 'skip'|'replace'|'keep-both'|undefined;
  if (action === 'preview' || action === 'apply') {
    if (typeof body.storeId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.storeId) ||
      !['skip','replace','keep-both'].includes(String(body.mode)))
      return error('Select the destination store and duplicate rule');
    const owned = await getDb().select({ id:paletteStores.id }).from(paletteStores)
      .where(and(eq(paletteStores.id,body.storeId),eq(paletteStores.accountId,session.accountId))).limit(1);
    if (!owned.length) return error('Destination store does not belong to this account', 403);
    storeId = owned[0].id;
    mode = body.mode as 'skip'|'replace'|'keep-both';
  }
  if (action === 'apply' && (typeof body.allowMissing !== 'boolean' ||
    typeof body.importPreferences !== 'boolean'))
    return error('Choose missing-image and settings import options');
  try {
    const response = await runNativeWorkspaceImport({
      action, accountId:session.accountId, selectionId, storeId, mode,
      allowMissing:body.allowMissing === true, importPreferences:body.importPreferences === true,
    });
    return Response.json(response.body,{status:response.status,headers:noStore});
  } catch (cause) {
    console.error('[PaletteIQ Desktop Workspace ZIP Import]',cause);
    return error('Desktop import bridge failed; check Desktop logs', 502);
  }
}
