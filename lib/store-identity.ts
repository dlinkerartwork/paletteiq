/** Pure account/store primitives; never use a client supplied store owner key. */
export const normalizeEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validAccountEmail = (email: string) =>
  email.length >= 5 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 12 && value.length <= 128;
export const validStoreName = (value: unknown) =>
  typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 90;
export const scopeForStore = (accountId: string, storeId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(accountId) || !/^[0-9a-f-]{36}$/.test(storeId))
    throw Error('Invalid account/store identifier');
  return 'user_' + accountId.replace(/-/g, '') + '_store_' + storeId.replace(/-/g, '');
};
