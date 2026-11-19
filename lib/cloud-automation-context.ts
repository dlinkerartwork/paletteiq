import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

// This context is populated ONLY by the authenticated cloud scheduler route.
// Never accept an owner identity from a browser header, body, or query string.
const identity = new AsyncLocalStorage<ChatGPTUser>();

export function runWithCloudAutomationUser<T>(user: ChatGPTUser, callback: () => Promise<T>): Promise<T> {
  return identity.run(user, callback);
}

export function cloudAutomationUser(): ChatGPTUser | undefined {
  return identity.getStore();
}
