import type { AuditItem, Heartbeat, RemoteStatus, SecurityPolicy, StreamServerMsg } from "@pulse/protocol";
import { PulseApiError, type PulseClient } from "./http.ts";

/** Códigos de fechamento definidos pelo Core (crates/pulse-core/src/remote_api.rs). */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_REVOKED = 4403;

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** O Core manda heartbeat a cada segundo; silêncio maior que isso é conexão morta. */
const SILENCE_TIMEOUT_MS = 15_000;

export type StreamState =
  | { kind: "connecting"; attempt: number }
  | { kind: "online" }
  | { kind: "offline"; reason: string; retryInMs: number }
  /** Não adianta reconectar: o dispositivo foi revogado. */
  | { kind: "revoked" };

export interface StreamHandlers {
  onState(state: StreamState): void;
  onReady(status: RemoteStatus): void;
  onHeartbeat(hb: Heartbeat): void;
  onAudit(item: AuditItem): void;
  /** Política de segurança (após `ready` e a cada mudança). */
  onPolicy?(policy: SecurityPolicy): void;
}

/**
 * WebSocket `/v1/stream` com reconexão automática (backoff exponencial com jitter),
 * detecção de conexão silenciosa e retomada da auditoria pelo último id recebido.
 */
export class PulseStream {
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private lastAuditId: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly client: PulseClient;
  private readonly handlers: StreamHandlers;

  constructor(client: PulseClient, handlers: StreamHandlers) {
    this.client = client;
    this.handlers = handlers;
  }

  /** Inicia se estiver parado. Retorna `false` se já estava rodando. */
  start(): boolean {
    if (!this.stopped) return false;
    this.stopped = false;
    void this.connect();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  /** Reconecta já (ex.: app voltou ao primeiro plano ou a rede mudou). */
  reconnectNow(): void {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.clearTimers();
    this.attempt = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    void this.connect();
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.retryTimer = this.silenceTimer = null;
  }

  private armSilenceTimer(ws: WebSocket): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.ws === ws) ws.close();
    }, SILENCE_TIMEOUT_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.attempt += 1;
    this.handlers.onState({ kind: "connecting", attempt: this.attempt });

    let token: string;
    try {
      token = await this.client.accessToken();
    } catch (e) {
      if (e instanceof PulseApiError && e.isFatal) return this.revoked();
      return this.scheduleRetry(e instanceof Error ? e.message : String(e));
    }
    if (this.stopped) return;

    const ws = new WebSocket(this.client.streamUrl());
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", accessToken: token, sinceAuditId: this.lastAuditId }));
      this.armSilenceTimer(ws);
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.armSilenceTimer(ws);
      let msg: StreamServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as StreamServerMsg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          opened = true;
          this.attempt = 0;
          this.handlers.onState({ kind: "online" });
          this.handlers.onReady(msg.status);
          break;
        case "heartbeat":
          this.handlers.onHeartbeat(msg.heartbeat);
          break;
        case "audit":
          this.lastAuditId = Math.max(this.lastAuditId ?? 0, msg.item.id);
          this.handlers.onAudit(msg.item);
          break;
        case "policy":
          this.handlers.onPolicy?.(msg.policy);
          break;
        case "error":
          // O fechamento vem logo em seguida; o código de close decide o que fazer.
          break;
      }
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      if (ev.code === CLOSE_REVOKED) return this.revoked();
      if (ev.code === CLOSE_UNAUTHORIZED) {
        // Token pode ter vencido entre a leitura e o uso: uma nova tentativa renova.
        return this.scheduleRetry("Sessão expirada; renovando.");
      }
      this.scheduleRetry(opened ? "Conexão com o PC perdida." : "Não foi possível alcançar o PC.");
    };

    ws.onerror = () => {
      // O onclose sempre vem depois; tratamos tudo lá.
    };
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, this.attempt - 1));
    const retryInMs = Math.round(base / 2 + Math.random() * (base / 2));
    this.handlers.onState({ kind: "offline", reason, retryInMs });
    this.retryTimer = setTimeout(() => void this.connect(), retryInMs);
  }

  private revoked(): void {
    this.stopped = true;
    this.clearTimers();
    this.handlers.onState({ kind: "revoked" });
  }
}
