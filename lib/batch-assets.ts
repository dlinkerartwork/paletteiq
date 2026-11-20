// Each Batch has its own immutable asset location. A delayed Batch import
// must never overwrite a newer image stored under the character's legacy key.
const UUID = /^[0-9a-f-]{36}$/;
export function batchAssetKey(owner: string, characterId: string, format: 'png' | 'jpg', batchId: string): string {
  if (!UUID.test(characterId) || !UUID.test(batchId)) throw new Error('Invalid Batch asset identifier');
  return `generated/${owner}/batches/${batchId}/${characterId}.${format}`;
}
export function batchAssetUrl(characterId: string, format: 'png' | 'jpg', batchId: string): string {
  if (!UUID.test(characterId) || !UUID.test(batchId)) throw new Error('Invalid Batch asset identifier');
  return `/api/images/${characterId}?format=${format}&batch=${batchId}`;
}
