/**
 * Portable JSON backup validation and non-destructive conflict planning.
 * Pure functions are shared by preview, apply and Node regression tests.
 */
export type RestoreMode = 'skip' | 'replace' | 'keep-both';
export type BackupProject = { id: string; name: string; characters: Array<{ id: string; name: string; imageUrl?: string; upscaledImageUrl?: string }>; [key: string]: unknown };
export type PortableBackup = { format: 'paletteiq-backup'; version: 1; projects: BackupProject[]; preferences: Record<string, unknown> };
export type RestoreAction = 'create' | 'replace' | 'skip' | 'keep-both' | 'blocked';
export type RestorePlanRow = { project: BackupProject; action: RestoreAction; collisionOwner?: string };
export const MAX_BACKUP_BYTES = 10_000_000;
export const MAX_BACKUP_PROJECTS = 500;
const idPattern = /^[\\w-]{8,80}$/;

export function readPortableBackup(raw: unknown): PortableBackup {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid backup JSON');
  const value = raw as Record<string, unknown>;
  if (value.format !== 'paletteiq-backup' || value.version !== 1 ||
      !Array.isArray(value.projects) || value.projects.length > MAX_BACKUP_PROJECTS ||
      !value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences))
    throw Error('Unsupported PaletteIQ backup format or collection count');
  const seen = new Set<string>();
  for (const item of value.projects) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid collection in backup');
    const project = item as BackupProject;
    if (typeof project.id !== 'string' || !idPattern.test(project.id) ||
        typeof project.name !== 'string' || !project.name.trim() ||
        !Array.isArray(project.characters) ||
        project.characters.some(char => !char || typeof char.id !== 'string' || typeof char.name !== 'string'))
      throw Error('Invalid collection ID, name or characters in backup');
    if (seen.has(project.id)) throw Error('Backup contains duplicate collection IDs');
    seen.add(project.id);
    if (JSON.stringify(project).length > 700_000) throw Error('One collection exceeds PaletteIQ 700 KB collection limit');
  }
  return value as PortableBackup;
}

export function restorePlan(backup: PortableBackup, existing: Array<{ id: string; owner: string }>,
  destinationOwner: string, mode: RestoreMode): RestorePlanRow[] {
  if (!['skip', 'replace', 'keep-both'].includes(mode)) throw Error('Choose a conflict handling mode');
  const owners = new Map(existing.map(row => [row.id, row.owner]));
  return backup.projects.map(project => {
    const collisionOwner = owners.get(project.id);
    if (!collisionOwner) return { project, action: 'create' as const };
    if (mode === 'keep-both') return { project, action: 'keep-both' as const, collisionOwner };
    if (mode === 'skip') return { project, action: 'skip' as const, collisionOwner };
    if (collisionOwner !== destinationOwner) return { project, action: 'blocked' as const, collisionOwner };
    return { project, action: 'replace' as const, collisionOwner };
  });
}

export function backupSummary(backup: PortableBackup) {
  const characters = backup.projects.flatMap(project => project.characters);
  const thumbnails = backup.projects.reduce((sum, p) => sum + (Array.isArray(p.thumbnails) ? p.thumbnails.length : 0), 0);
  const listingImages = backup.projects.reduce((sum, p) => sum + (Array.isArray(p.listingImages) ? p.listingImages.length : 0), 0);
  return {
    collections: backup.projects.length, characters: characters.length,
    completed: characters.filter(c => c.imageUrl).length,
    upscaleReferences: characters.filter(c => c.upscaledImageUrl).length,
    thumbnails, listingImages,
    note: 'JSON contains image URLs and metadata, NOT PNG/JPG binaries. Old images require existing accessible storage.',
  };
}

/** Allow only non-secret settings keys, never encrypted API credentials. */
const preferenceKeys = new Set([
  'target','model','quality','analysisModel','output','background','variations','defaultStyle','autoSave',
  'seoProvider','seoGeminiModel','seoOpenaiModel','seoDraftFields','seoTitleMaxLength','seoAltTextCount',
  'seoFileNaming','seoPrompts','upscaleProvider','upscaleServerUrl','upscaleFactor',
  'upscaleRequireTransparency','upscaleQc','upscaleModel','upscaleCleanup','upscaleCleanupStrength',
]);
export function nonSecretPreferences(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) if (preferenceKeys.has(key)) safe[key] = value;
  safe.upscaleProvider = 'remote';
  safe.seoTitleMaxLength = 140;
  if (JSON.stringify(safe).length > 35_000) throw Error('Preferences in backup are too large');
  return safe;
}
