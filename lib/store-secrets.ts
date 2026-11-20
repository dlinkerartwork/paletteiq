import { env } from 'cloudflare:workers';
import { mayUseSharedProviderKey } from './store-secret-policy.ts';

/** Store users must configure their own keys unless the deployment owner opts into shared keys. */
export function sharedProviderSecret(owner: string, variable: string): string | undefined {
  const vars = env as unknown as Record<string, string | undefined>;
  if (!mayUseSharedProviderKey(owner, vars.PALETTEIQ_ALLOW_SHARED_PROVIDER_KEYS === '1')) return undefined;
  return vars[variable]?.trim() || undefined;
}
