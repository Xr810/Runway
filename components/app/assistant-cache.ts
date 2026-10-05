export const assistantCacheDatabase = (userId: string) => `opportunity-ai-chat-v1:${userId}`;

import type { AssistantMessage } from "./assistant-types";

export async function readAssistantCache(userId: string): Promise<AssistantMessage[]> {
  return accessAssistantCache(userId);
}

export async function writeAssistantCache(
  userId: string,
  messages: AssistantMessage[],
): Promise<void> {
  await accessAssistantCache(userId, messages);
}

async function accessAssistantCache(
  userId: string,
  value?: AssistantMessage[],
): Promise<AssistantMessage[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(assistantCacheDatabase(userId), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chat");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chat", value ? "readwrite" : "readonly");
      const request = value
        ? tx.objectStore("chat").put(value, "messages")
        : tx.objectStore("chat").get("messages");
      tx.oncomplete = () => resolve(value ?? request.result ?? []);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
