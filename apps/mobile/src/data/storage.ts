import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import type { Snapshot } from "@morph/client";

/**
 * O que fica no aparelho:
 * - token de acesso e endereço do servidor → SecureStore (Keychain);
 * - spec + registros (snapshot) → SQLite local, para abrir sem rede e sem IA.
 */

const SESSION_KEY = "morph.session";
const SNAPSHOT_KEY = "morph.snapshot";

export type StoredSession = { serverUrl: string; token: string };

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await Storage.removeItem(SNAPSHOT_KEY);
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const raw = await Storage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await Storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}
