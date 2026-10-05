import type {
  ActionRequest,
  ActionResponse,
  ApiError,
  ClaimRequest,
  ControlSnapshot,
  SecurityPolicy,
  SecurityUpdate,
  DevicesResponse,
  PairingStatus,
  PollRequest,
  RemoteStatus,
  TokenPair,
} from "@pulse/protocol";

const DEFAULT_TIMEOUT_MS = 10_000;
/** Renova o acesso um pouco antes de vencer, para não falhar no meio de uma chamada. */
const REFRESH_MARGIN_MS = 60_000;

export class PulseApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PulseApiError";
    this.status = status;
    this.code = code;
  }

  /** O PC revogou ou não reconhece mais este dispositivo: só um novo pareamento resolve. */
  get isFatal(): boolean {
    return this.code === "device_revoked" || (this.status === 401 && this.code === "unauthorized");
  }
}

/** PC inacessível: offline, Tailscale desligado, timeout. */
export class PulseNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PulseNetworkError";
  }
}

export interface TokenStore {
  load(): Promise<TokenPair | null>;
  save(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

async function request<T>(
  url: string,
  init: { method: string; body?: unknown; bearer?: string; timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    // O fetch da Expo no iOS não usa "AbortError"; o sinal é a fonte confiável.
    throw new PulseNetworkError(
      controller.signal.aborted ? "O PC não respondeu a tempo." : "Não foi possível alcançar o PC.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (json ?? {}) as Partial<ApiError>;
    throw new PulseApiError(res.status, err.code ?? "http_error", err.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

// ---------- pareamento (sem autenticação) ----------

export function claimPairing(coreUrl: string, body: ClaimRequest): Promise<PairingStatus> {
  return request(join(coreUrl, "/v1/pairing/claim"), { method: "POST", body });
}

export function pollPairing(coreUrl: string, body: PollRequest): Promise<PairingStatus> {
  return request(join(coreUrl, "/v1/pairing/poll"), { method: "POST", body });
}

// ---------- cliente autenticado ----------

export class PulseClient {
  readonly baseUrl: string;
  private readonly store: TokenStore;
  private tokens: TokenPair | null = null;
  private refreshing: Promise<TokenPair> | null = null;

  constructor(baseUrl: string, store: TokenStore) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.store = store;
  }

  private async current(): Promise<TokenPair> {
    if (!this.tokens) this.tokens = await this.store.load();
    if (!this.tokens) throw new PulseApiError(401, "unauthorized", "Este iPhone não está pareado.");
    return this.tokens;
  }

  /**
   * Renovação única por vez: chamadas simultâneas esperam a mesma promessa.
   * Reapresentar um token já girado faz o Core revogar o dispositivo.
   */
  private refresh(): Promise<TokenPair> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const old = await this.current();
        try {
          const next = await request<TokenPair>(join(this.baseUrl, "/v1/auth/refresh"), {
            method: "POST",
            body: { refreshToken: old.refreshToken },
          });
          this.tokens = next;
          await this.store.save(next);
          return next;
        } catch (e) {
          if (e instanceof PulseApiError && e.code === "refresh_superseded") {
            // Outra renovação ganhou a corrida; o par novo já foi salvo por ela.
            this.tokens = await this.store.load();
            if (this.tokens) return this.tokens;
          }
          throw e;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  /** Token de acesso válido por pelo menos mais um minuto. */
  async accessToken(): Promise<string> {
    const t = await this.current();
    if (t.accessExpiresAtMs - Date.now() > REFRESH_MARGIN_MS) return t.accessToken;
    return (await this.refresh()).accessToken;
  }

  private async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = join(this.baseUrl, path);
    try {
      return await request<T>(url, { method, body, bearer: await this.accessToken() });
    } catch (e) {
      if (e instanceof PulseApiError && e.code === "token_expired") {
        return request<T>(url, { method, body, bearer: (await this.refresh()).accessToken });
      }
      throw e;
    }
  }

  status(): Promise<RemoteStatus> {
    return this.authed("GET", "/v1/status");
  }

  devices(): Promise<DevicesResponse> {
    return this.authed("GET", "/v1/devices");
  }

  control(): Promise<ControlSnapshot> {
    return this.authed("GET", "/v1/control");
  }

  /** Pode voltar `confirmationRequired`: confirme com o usuário e chame de novo com o id. */
  action(req: ActionRequest): Promise<ActionResponse> {
    return this.authed("POST", "/v1/actions", req);
  }

  security(): Promise<SecurityPolicy> {
    return this.authed("GET", "/v1/security");
  }

  setSecurity(update: SecurityUpdate): Promise<SecurityPolicy> {
    return this.authed("PUT", "/v1/security", update);
  }

  /** Desfaz o pareamento deste iPhone no PC e apaga as credenciais locais. */
  async unpair(): Promise<void> {
    try {
      await this.authed("POST", "/v1/devices/me/revoke");
    } finally {
      this.tokens = null;
      await this.store.clear();
    }
  }

  streamUrl(): string {
    return `${this.baseUrl.replace(/^http/i, "ws")}/v1/stream`;
  }
}
