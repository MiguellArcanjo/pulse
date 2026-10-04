import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { PulseClient, PulseStream, type StreamState } from "@pulse/client";
import type { AuditItem, Heartbeat, RemoteStatus } from "@pulse/protocol";
import {
  clearSession,
  loadCache,
  loadSession,
  saveCache,
  saveSession,
  tokenStore,
  type StoredSession,
} from "./storage";

const HISTORY = 60;
const AUDIT_KEEP = 30;
const CACHE_EVERY_MS = 10_000;

export interface Pulse {
  /** `undefined` enquanto lê o Keychain na abertura. */
  paired: { coreUrl: string; deviceId: string } | null | undefined;
  client: PulseClient | null;
  connection: StreamState;
  status: RemoteStatus | null;
  heartbeat: Heartbeat | null;
  cpuHistory: number[];
  audit: AuditItem[];
  /** Quando os dados exibidos foram recebidos do PC pela última vez. */
  lastUpdateMs: number | null;
  /** Motivo de um desemparelhamento forçado (ex.: revogado no PC). */
  unpairedReason: string | null;
  completePairing(session: StoredSession): Promise<void>;
  unpair(): Promise<void>;
  reconnect(): void;
}

const Ctx = createContext<Pulse | null>(null);

export function usePulse(): Pulse {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePulse fora do SessionProvider");
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [paired, setPaired] = useState<Pulse["paired"]>(undefined);
  const [client, setClient] = useState<PulseClient | null>(null);
  const [connection, setConnection] = useState<StreamState>({ kind: "connecting", attempt: 0 });
  const cache = useMemo(loadCache, []);
  const [status, setStatus] = useState<RemoteStatus | null>(cache?.status ?? null);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(cache?.heartbeat ?? null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>(cache?.audit ?? []);
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(cache?.savedAtMs ?? null);
  const [unpairedReason, setUnpairedReason] = useState<string | null>(null);
  const streamRef = useRef<PulseStream | null>(null);
  const lastCacheRef = useRef(0);
  const viewRef = useRef({ status, heartbeat, audit });
  viewRef.current = { status, heartbeat, audit };

  const resetView = useCallback(() => {
    setStatus(null);
    setHeartbeat(null);
    setCpuHistory([]);
    setAudit([]);
    setLastUpdateMs(null);
  }, []);

  const adopt = useCallback((s: StoredSession | null) => {
    if (!s) {
      setPaired(null);
      setClient(null);
      return;
    }
    setPaired({ coreUrl: s.coreUrl, deviceId: s.deviceId });
    setClient(new PulseClient(s.coreUrl, tokenStore({ coreUrl: s.coreUrl, deviceId: s.deviceId })));
  }, []);

  useEffect(() => {
    void loadSession().then(adopt);
  }, [adopt]);

  const forget = useCallback(
    async (reason: string | null) => {
      streamRef.current?.stop();
      streamRef.current = null;
      await clearSession();
      resetView();
      setUnpairedReason(reason);
      adopt(null);
    },
    [adopt, resetView],
  );

  // Stream: liga quando pareado; pausa em segundo plano (o iOS derruba o socket de qualquer jeito).
  useEffect(() => {
    if (!client) return;
    const stream = new PulseStream(client, {
      onState: (s) => {
        setConnection(s);
        if (s.kind === "revoked") void forget("O acesso deste iPhone foi revogado no PC.");
      },
      onReady: (st) => {
        setStatus(st);
        if (st.heartbeat) setHeartbeat(st.heartbeat);
        setLastUpdateMs(Date.now());
      },
      onHeartbeat: (hb) => {
        setHeartbeat(hb);
        setCpuHistory((h) => [...h.slice(-(HISTORY - 1)), hb.cpuPercent]);
        const now = Date.now();
        setLastUpdateMs(now);
        if (now - lastCacheRef.current > CACHE_EVERY_MS) {
          lastCacheRef.current = now;
          saveCache({ savedAtMs: now, ...viewRef.current, heartbeat: hb });
        }
      },
      onAudit: (item) =>
        setAudit((list) =>
          list.some((a) => a.id === item.id) ? list : [item, ...list].slice(0, AUDIT_KEEP),
        ),
    });
    streamRef.current = stream;
    stream.start();

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        // Parado em segundo plano: inicia. Se já rodava, força nova tentativa já.
        if (!stream.start()) stream.reconnectNow();
      } else if (s === "background") {
        stream.stop();
      }
    });
    return () => {
      sub.remove();
      stream.stop();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [client, forget]);

  const completePairing = useCallback(
    async (s: StoredSession) => {
      await saveSession(s);
      resetView();
      setUnpairedReason(null);
      adopt(s);
    },
    [adopt, resetView],
  );

  const unpair = useCallback(async () => {
    try {
      await client?.unpair();
    } catch {
      // Sem conexão com o PC: apaga localmente mesmo assim; o PC mostra o
      // dispositivo até ele ser revogado lá.
    }
    await forget(null);
  }, [client, forget]);

  const reconnect = useCallback(() => streamRef.current?.reconnectNow(), []);

  const value: Pulse = {
    paired,
    client,
    connection,
    status,
    heartbeat,
    cpuHistory,
    audit,
    lastUpdateMs,
    unpairedReason,
    completePairing,
    unpair,
    reconnect,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
