import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError, MorphApi, pull, upsertLocal, type AiJob, type EvolutionEvent, type RecordRow, type Snapshot } from "@morph/client";
import { diffSpecs, RecordIndex, type RecordData, type SpecDiff } from "@morph/engine";
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

/** Última mudança de estrutura recebida (base das animações do Motion). */
export type LastChange = { diff: SpecDiff; version: number; at: number };

type MorphActions = {
  lastChange: LastChange | null;
  pair(serverUrl: string, code: string): Promise<void>;
  unpair(): Promise<void>;
  refresh(): Promise<void>;
  createRecord(entity: string, data: RecordData): Promise<RecordRow>;
  updateRecord(id: string, data: RecordData): Promise<RecordRow>;
  deleteRecord(id: string): Promise<void>;
  /** Linha do tempo do Evolution (vem do servidor). */
  evolution(): Promise<{ events: EvolutionEvent[]; counts: { tools: number; automations: number; integrations: number } }>;
  /** Desfazer: volta ao conteúdo da versão indicada (gera uma versão nova) e sincroniza. */
  restore(version: number): Promise<void>;
  /** IA: acesso direto à API para a tela de criação acompanhar o pedido. */
  ai: {
    request(text: string): Promise<AiJob>;
    job(id: string): Promise<AiJob>;
    confirm(id: string): Promise<AiJob>;
    decline(id: string): Promise<AiJob>;
  };
};

const Ctx = createContext<(MorphState & MorphActions) | null>(null);

export function MorphProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MorphState>({ status: "loading" });
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
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
      const prev = snapshotRef.current;
      const next = await pull(api.current, prev);
      if (prev && next.version !== prev.version)
        setLastChange({ diff: diffSpecs(prev.spec, next.spec), version: next.version, at: Date.now() });
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

  const need = useCallback(() => {
    if (!api.current) throw new Error("sem sessão");
    return api.current;
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      lastChange,
      pair,
      unpair,
      refresh,
      createRecord: (entity: string, data: RecordData) => write((a) => a.createRecord(entity, data)),
      updateRecord: (id: string, data: RecordData) => write((a) => a.updateRecord(id, data)),
      evolution: async () => {
        if (!api.current) throw new Error("sem sessão");
        return api.current.evolution();
      },
      restore: async (version: number) => {
        if (!api.current) throw new Error("sem sessão");
        await api.current.restore(version);
        await refresh();
      },
      ai: {
        request: (text: string) => need().aiRequest(text),
        job: (id: string) => need().aiJob(id),
        confirm: (id: string) => need().aiConfirm(id),
        decline: (id: string) => need().aiDecline(id),
      },
      deleteRecord: async (id: string) => {
        if (!api.current) throw new Error("sem sessão");
        await api.current.deleteRecord(id);
        const snap = snapshotRef.current;
        if (snap) setSnapshot({ ...snap, records: snap.records.filter((r) => r.id !== id) }, "idle");
      },
    }),
    [state, lastChange, pair, unpair, refresh, write, setSnapshot, need],
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
