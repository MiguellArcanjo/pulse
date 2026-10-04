import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuditItem, CoreConnection, Heartbeat } from "@pulse/protocol";

const HISTORY = 60;

export interface History {
  cpu: number[];
  mem: number[];
  netRx: number[];
  netTx: number[];
}

export interface CoreView {
  connection: CoreConnection;
  heartbeat: Heartbeat | null;
  /** Últimas amostras (mais antiga primeiro) para os sparklines. */
  history: History;
  /** Auditoria recente, mais nova primeiro. */
  audit: AuditItem[];
}

const emptyHistory: History = { cpu: [], mem: [], netRx: [], netTx: [] };

function push(list: number[], value: number): number[] {
  return [...list.slice(-(HISTORY - 1)), value];
}

/** Estado do Pulse Core visto pelo Desktop (via processo Rust do Tauri). */
export function useCore(): CoreView {
  const [connection, setConnection] = useState<CoreConnection>({ state: "connecting" });
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (un: () => void) => (disposed ? un() : unlisteners.push(un));

    // Assina antes de buscar o estado inicial para não perder eventos no meio.
    void listen<CoreConnection>("core://connection", (e) => setConnection(e.payload)).then(keep);
    void listen<AuditItem[]>("core://audit", (e) => setAudit(e.payload)).then(keep);
    void listen<Heartbeat>("core://heartbeat", (e) => {
      const hb = e.payload;
      setHeartbeat(hb);
      setHistory((h) => ({
        cpu: push(h.cpu, hb.cpuPercent),
        mem: push(h.mem, (hb.memUsedBytes / hb.memTotalBytes) * 100),
        netRx: push(h.netRx, hb.netRxBytesPerSec),
        netTx: push(h.netTx, hb.netTxBytesPerSec),
      }));
    }).then(keep);

    void invoke<CoreConnection>("core_connection").then((c) => !disposed && setConnection(c));
    void invoke<AuditItem[]>("recent_audit").then(
      (a) => !disposed && setAudit((cur) => (cur.length ? cur : a)),
    );
    void invoke<Heartbeat | null>("last_heartbeat").then((hb) => {
      if (!disposed && hb) setHeartbeat((cur) => cur ?? hb);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, []);

  return { connection, heartbeat, history, audit };
}
