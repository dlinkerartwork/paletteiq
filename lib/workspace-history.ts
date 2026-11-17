/** In-app workspace entries backed by the browser's native history stack. */
export const STUDIO_DISABLED_TABS = ['thumbnails', 'listing-images'] as const;
export function isStudioTabEnabled(tab: string): boolean {
  return !(STUDIO_DISABLED_TABS as readonly string[]).includes(tab);
}
/** Keyboard shortcuts, identical to common desktop browser navigation keys. */
export type WorkspaceShortcut = 'back' | 'forward' | 'refresh';
export function workspaceShortcut(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): WorkspaceShortcut | null {
  const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
  if (!shiftKey && altKey && !ctrlKey && !metaKey) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
  }
  if (!altKey && (key === 'F5' && !shiftKey && !ctrlKey && !metaKey ||
    key.toLowerCase() === 'r' && !shiftKey && (ctrlKey !== metaKey))) return 'refresh';
  return null;
}
export type WorkspaceRoute = { tab: string; projectId: string };
export type WorkspaceHistoryEntry = WorkspaceRoute & { index: number; session: string };

export const WORKSPACE_TAB_IDS = [
  'overview', 'collections', 'multi-production', 'settings', 'analysis', 'characters',
  'prompts', 'production', 'listing', // Thumbnail Designer and Listing Studio are temporarily disabled.
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
