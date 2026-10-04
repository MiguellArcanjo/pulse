// Onde o iPhone guarda o que precisa entre aberturas.
//
// - Credenciais (tokens + endereço do Core): Keychain via SecureStore,
//   WHEN_UNLOCKED_THIS_DEVICE_ONLY (não vão para backup nem outro aparelho).
// - Cache de exibição (último status/heartbeat): arquivo comum, sem segredos,
//   sempre mostrado com "Última atualização".

import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import type { AuditItem, Heartbeat, RemoteStatus, TokenPair } from "@pulse/protocol";
import type { TokenStore } from "@pulse/client";

const KC = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const SESSION_KEY = "pulse.session.v1";

export interface StoredSession {
  coreUrl: string;
  deviceId: string;
  tokens: TokenPair;
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, KC);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), KC);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, KC);
  clearCache();
}

/** TokenStore do @pulse/client que mantém os tokens dentro da sessão no Keychain. */
export function tokenStore(base: Omit<StoredSession, "tokens">): TokenStore {
  return {
    load: async () => (await loadSession())?.tokens ?? null,
    save: (tokens) => saveSession({ ...base, tokens }),
    clear: clearSession,
  };
}

// ---------- cache não secreto ----------

export interface CachedView {
  savedAtMs: number;
  status: RemoteStatus | null;
  heartbeat: Heartbeat | null;
  audit: AuditItem[];
}

const CACHE = new File(Paths.document, "view-cache.json");

export function loadCache(): CachedView | null {
  try {
    return CACHE.exists ? (JSON.parse(CACHE.textSync()) as CachedView) : null;
  } catch {
    return null;
  }
}

export function saveCache(view: CachedView): void {
  try {
    if (!CACHE.exists) CACHE.create();
    CACHE.write(JSON.stringify(view));
  } catch {
    // Cache é conveniência: falhar não pode derrubar o app.
  }
}

function clearCache(): void {
  try {
    if (CACHE.exists) CACHE.delete();
  } catch {
    // idem
  }
}
