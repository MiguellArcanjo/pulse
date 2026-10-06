import type { Issue, RecordData } from "@morph/engine";
import type { AppSpec, PermissionLevel } from "@morph/protocol";

/** Respostas da API v1 (ver apps/server/src/app.ts). */

export type RecordRow = {
  id: string;
  entity: string;
  data: RecordData;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

export type EvolutionEvent = {
  id: string;
  version: number;
  kind: "app_started" | "tool_created" | "tool_modified" | "reorganized" | "archived" | "restored";
  summary: string;
  target: string | null;
  createdAt: string;
};

export type ChangeResponse = { version: number; spec: AppSpec; level: PermissionLevel; event: EvolutionEvent };

/** Erro da API com o status HTTP e o corpo (ex.: `issues` de validação). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: { error?: string; issues?: Issue[]; level?: PermissionLevel; summary?: string };

  constructor(status: number, body: ApiError["body"]) {
    super(`API ${status}: ${body.error ?? "erro"}`);
    this.status = status;
    this.body = body;
  }

  /** Sem rede, servidor fora do ar ou tempo esgotado. */
  get offline(): boolean {
    return this.status === 0;
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export class MorphApi {
  private readonly base: string;
  private readonly token: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; token?: string | null; fetch?: FetchLike; timeoutMs?: number }) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  withToken(token: string): MorphApi {
    return new MorphApi({ baseUrl: this.base, token, fetch: this.fetchImpl, timeoutMs: this.timeoutMs });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: { status: number; text(): Promise<string> };
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, { error: "offline" });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};
    if (res.status >= 400) throw new ApiError(res.status, json as ApiError["body"]);
    return json as T;
  }

  health() {
    return this.call<{ ok: boolean }>("GET", "/v1/health");
  }

  pair(code: string, deviceName: string) {
    return this.call<{ token: string; deviceId: string }>("POST", "/v1/auth/pair", { code, deviceName });
  }

  spec() {
    return this.call<{ version: number; spec: AppSpec }>("GET", "/v1/spec");
  }

  changes(cursor: string | null, limit = 500) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return this.call<{ records: RecordRow[]; cursor: string | null; hasMore: boolean }>("GET", `/v1/records?${q.toString()}`);
  }

  createRecord(entity: string, data: RecordData) {
    return this.call<RecordRow>("POST", "/v1/records", { entity, data });
  }

  updateRecord(id: string, data: RecordData) {
    return this.call<RecordRow>("PATCH", `/v1/records/${id}`, { data });
  }

  deleteRecord(id: string) {
    return this.call<Record<string, never>>("DELETE", `/v1/records/${id}`, { confirm: true });
  }

  evolution() {
    return this.call<{ events: EvolutionEvent[]; counts: { tools: number; automations: number; integrations: number } }>(
      "GET",
      "/v1/evolution",
    );
  }

  restore(version: number) {
    return this.call<ChangeResponse>("POST", `/v1/versions/${version}/restore`, { confirm: true });
  }
}
