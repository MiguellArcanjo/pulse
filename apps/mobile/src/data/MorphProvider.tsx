import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, MorphApi, pull, upsertLocal, type RecordRow, type Snapshot } from "@morph/client";
import { RecordIndex, type RecordData } from "@morph/engine";
import { clearSession, loadSession, loadSnapshot, saveSession, saveSnapshot } from "./storage";

/**
 * Estado do app: sessão com o servidor, snapshot local (spec + registros) e as
 * escritas. A tela sempre renderiza a partir do snapshot local; a rede só o atualiza.
 */

export type SyncState = "idle" | "syncing" | "offline" | "error";

type MorphState =
  | { status: "loading" }
  | { status: "unpaired" }
  | {
      status: "ready";
      snapshot: Snapshot | null;
      index: RecordIndex;
      sync: SyncState;
      serverUrl: string;
    };

type MorphActions = {
  pair(serverUrl: string, code: string): Promise<void>;
  unpair(): Promise<void>;
  refresh(): Promise<void>;
  createRecord(entity: string, data: RecordData): Promise<RecordRow>;
  updateRecord(id: string, data: RecordData): Promise<RecordRow>;
  deleteRecord(id: string): Promise<void>;
};

const Ctx = createContext<(MorphState & MorphActions) | null>(null);

export function MorphProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MorphState>({ status: "loading" });
  const api = useRef<MorphApi | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);

  const setSnapshot = useCallback((snapshot: Snapshot | null, sync: SyncState) => {
    snapshotRef.current = snapshot;
    setState((s) =>
      s.status === "ready"
        ? { ...s, snapshot, index: new RecordIndex(snapshot?.records ?? []), sync }
        : s,
    );
    if (snapshot) void saveSnapshot(snapshot);
  }, []);

  const refresh = useCallback(async () => {
    if (!api.current) return;
    setState((s) => (s.status === "ready" ? { ...s, sync: "syncing" } : s));
    try {
      const next = await pull(api.current, snapshotRef.current);
      setSnapshot(next, "idle");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Token revogado ou inválido: volta para o pareamento.
        await clearSession();
        api.current = null;
        snapshotRef.current = null;
        setState({ status: "unpaired" });
        return;
      }
      setState((s) => (s.status === "ready" ? { ...s, sync: err instanceof ApiError && err.offline ? "offline" : "error" } : s));
    }
  }, [setSnapshot]);

  // Abertura: mostra o que está salvo e sincroniza em seguida.
  useEffect(() => {
    void (async () => {
      const session = await loadSession();
      if (!session) {
        setState({ status: "unpaired" });
        return;
      }
      api.current = new MorphApi({ baseUrl: session.serverUrl, token: session.token });
      const snapshot = await loadSnapshot();
      snapshotRef.current = snapshot;
      setState({ status: "ready", snapshot, index: new RecordIndex(snapshot?.records ?? []), sync: "syncing", serverUrl: session.serverUrl });
      await refresh();
    })();
  }, [refresh]);

  // Voltou para o app: sincroniza.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const pair = useCallback(
    async (serverUrl: string, code: string) => {
      const base = new MorphApi({ baseUrl: serverUrl });
      const { token } = await base.pair(code, "iPhone");
      await saveSession({ serverUrl, token });
      api.current = base.withToken(token);
      snapshotRef.current = null;
      setState({ status: "ready", snapshot: null, index: new RecordIndex([]), sync: "syncing", serverUrl });
      await refresh();
    },
    [refresh],
  );

  const unpair = useCallback(async () => {
    await clearSession();
    api.current = null;
    snapshotRef.current = null;
    setState({ status: "unpaired" });
  }, []);

  const write = useCallback(
    async (fn: (api: MorphApi) => Promise<RecordRow>) => {
      if (!api.current) throw new Error("sem sessão");
      const row = await fn(api.current);
      const snap = snapshotRef.current;
      if (snap) setSnapshot(upsertLocal(snap, row), "idle");
      return row;
    },
    [setSnapshot],
  );

  const value = useMemo(
    () => ({
      ...state,
      pair,
      unpair,
      refresh,
      createRecord: (entity: string, data: RecordData) => write((a) => a.createRecord(entity, data)),
      updateRecord: (id: string, data: RecordData) => write((a) => a.updateRecord(id, data)),
      deleteRecord: async (id: string) => {
        if (!api.current) throw new Error("sem sessão");
        await api.current.deleteRecord(id);
        const snap = snapshotRef.current;
        if (snap) setSnapshot({ ...snap, records: snap.records.filter((r) => r.id !== id) }, "idle");
      },
    }),
    [state, pair, unpair, refresh, write, setSnapshot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMorph() {
  const v = useContext(Ctx);
  if (!v) throw new Error("MorphProvider ausente");
  return v;
}

/** Atalho para telas que só existem com o app pronto. */
export function useReady() {
  const m = useMorph();
  if (m.status !== "ready") throw new Error("app não está pronto");
  return m;
}

/** Mensagem curta, em português, para um erro de escrita. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.offline) return "Sem conexão com o servidor. Nada foi salvo.";
    const first = err.body.issues?.[0];
    if (first) return `Não foi possível salvar: ${first.message}`;
    return `O servidor recusou (${err.status}).`;
  }
  return "Algo deu errado. Tente de novo.";
}
