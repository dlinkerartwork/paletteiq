import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { studioSettings } from '@/db/schema';
import { parseGeminiKeyring } from '@/lib/gemini-keyring';

const master = () => (env as unknown as Record<string, string | undefined>).STUDIO_CREDENTIAL_ENCRYPTION_KEY;
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], x => parseInt(x, 16));
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function key() {
  const raw = master();
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) throw new Error('Encryption key not configured');
  return crypto.subtle.importKey('raw', hexToBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCredential(value: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) }, await key(), data);
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(value: string, owner: string) {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid encrypted secret');
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(owner) }, await key(), decode(ciphertext));
  return new TextDecoder().decode(result);
}

export async function userCredential(owner: string, provider: 'etsy' | 'openai' | 'gemini') {
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
  const encrypted = provider === 'etsy' ? rows[0]?.etsyCredential : provider === 'gemini' ? rows[0]?.geminiCredential : rows[0]?.openaiCredential;
  return encrypted ? decryptCredential(encrypted, owner) : null;
}

export async function userGeminiKeys(owner: string): Promise<string[]> {
  return parseGeminiKeyring(await userCredential(owner, 'gemini'));
}
