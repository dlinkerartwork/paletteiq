/** Blocks account-scoped stores from silently consuming platform-level paid API keys. */
export function isIsolatedStoreOwner(owner: string): boolean {
  return /^user_[0-9a-f]{32}_store_[0-9a-f]{32}$/.test(owner);
}
export function mayUseSharedProviderKey(owner: string, explicitOptIn: boolean): boolean {
  return !isIsolatedStoreOwner(owner) || explicitOptIn;
}
