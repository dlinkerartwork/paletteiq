/** In-app workspace entries backed by the browser's native history stack. */
export type WorkspaceRoute = { tab: string; projectId: string };
export type WorkspaceHistoryEntry = WorkspaceRoute & { index: number; session: string };

export const WORKSPACE_TAB_IDS = [
  'overview', 'collections', 'multi-production', 'settings', 'analysis', 'characters',
  'prompts', 'production', 'listing', 'thumbnails', 'listing-images',
] as const;

export function isWorkspaceRoute(value: unknown): value is WorkspaceRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<WorkspaceRoute>;
  return typeof v.tab === 'string' && (WORKSPACE_TAB_IDS as readonly string[]).includes(v.tab)
    && typeof v.projectId === 'string' && /^[\w-]{1,100}$/.test(v.projectId);
}
export function routeEquals(a: WorkspaceRoute, b: WorkspaceRoute): boolean {
  return a.tab === b.tab && a.projectId === b.projectId;
}
export function readWorkspaceHistoryState(value: unknown, session: string): WorkspaceHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const outer = value as { paletteiqWorkspace?: unknown };
  const entry = outer.paletteiqWorkspace;
  if (!isWorkspaceRoute(entry) || typeof entry !== 'object') return null;
  const full = entry as WorkspaceHistoryEntry;
  return full.session === session && Number.isSafeInteger(full.index) && full.index >= 0 ? full : null;
}
export function workspaceHash(route: WorkspaceRoute): string {
  return '#paletteiq/' + encodeURIComponent(route.tab) + '/' + encodeURIComponent(route.projectId);
}
export function routeFromWorkspaceHash(hash: string): WorkspaceRoute | null {
  const match = /^#paletteiq\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) return null;
  try {
    const route = { tab: decodeURIComponent(match[1]), projectId: decodeURIComponent(match[2]) };
    return isWorkspaceRoute(route) ? route : null;
  } catch { return null; }
}
