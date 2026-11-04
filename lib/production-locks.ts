// Guards concurrent requests in the same desktop Worker process. This complements
// durable pending Batch checks in SQLite; it is not a distributed lock.
const active = new Set<string>();

export function acquireProductionLocks(owner: string, projectId: string, characterIds: string[]): (() => void) | null {
  const keys = [...new Set(characterIds)].map(id => JSON.stringify([owner, projectId, id]));
  if (keys.some(key => active.has(key))) return null;
  for (const key of keys) active.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of keys) active.delete(key);
  };
}
