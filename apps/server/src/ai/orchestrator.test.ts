import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AIConfig, AIProvider, StructuredRequest, StructuredResult } from "@morph/ai";
import { adicionarRpe, criarTreinos, removerRpe } from "@morph/engine/fixtures";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { createPairingCode } from "../auth.ts";
import type { Db } from "../db/db.ts";
import { migrate } from "../db/migrate.ts";
import { pgliteDb } from "../db/pglite.ts";
import { AiOrchestrator } from "./orchestrator.ts";

/**
 * O orquestrador de ponta a ponta com um fornecedor ROTEIRIZADO (só para teste): cada
 * chamada devolve a próxima resposta da fila. Prova o pipeline sem gastar créditos:
 * validação, nova tentativa subindo de modelo, confirmação, recusa, indisponibilidade.
 */

const config: AIConfig = {
  provider: "openai",
  apiKey: "teste",
  models: { fast: "m-fast", main: "m-main", reasoning: "m-reasoning" },
  prices: { "m-main": { input: 2, cached: 0.1, output: 10 } },
};

class ScriptedProvider implements AIProvider {
  readonly name = "roteiro";
  readonly calls: { model: string; schemaName: string; input: string }[] = [];
  private queue: StructuredResult[] = [];

  push(...r: StructuredResult[]) {
    this.queue.push(...r);
  }

  async generateStructured(req: StructuredRequest): Promise<StructuredResult> {
    this.calls.push({ model: req.model, schemaName: req.schemaName, input: req.input });
    const next = this.queue.shift();
    if (!next) throw new Error("roteiro vazio");
    if (next.ok) req.onPartial?.(JSON.stringify(next.json));
    return next;
  }
}

const usage = { inputTokens: 1000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 0 };
const ok = (json: unknown): StructuredResult => ({ ok: true, json, usage, model: "x", latencyMs: 5 });
const cls = (intent: string, target: string | null, complexity = "normal", reply: string | null = null) =>
  ok({ intent, target, complexity, progressTitle: "sua ferramenta", reply });

/** Como a IA escreve no modo estrito: mapas viram pares {key, value}. */
function strictify(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strictify);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (k === "params" && o["kind"] === "navigate" && val && !Array.isArray(val) && typeof val === "object")
        out[k] = Object.entries(val).map(([key, value]) => ({ key, value }));
      else out[k] = strictify(val);
    }
    return out;
  }
  return v;
}

let db: Db;
let app: FastifyInstance;
let provider: ScriptedProvider;
let token = "";

before(async () => {
  db = await pgliteDb("memory://");
  await migrate(db);
  provider = new ScriptedProvider();
  app = buildApp({ db, ai: new AiOrchestrator(db, provider, config) });
  await app.ready();
  const { code } = await createPairingCode(db);
  const r = await app.inject({ method: "POST", url: "/v1/auth/pair", payload: { code, deviceName: "t" } });
  token = (r.json() as { token: string }).token;
});

after(async () => {
  await app.close();
  await db.close();
});

async function call(method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.json() as Record<string, any> };
}

async function ask(text: string) {
  const start = await call("POST", "/v1/ai/requests", { text });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  for (let i = 0; i < 200; i++) {
    const j = await call("GET", `/v1/ai/jobs/${start.body["id"]}`);
    if (j.body["status"] !== "running") return j.body;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("job não terminou");
}

test("'Quero controlar meus treinos': entende, cria, aplica e vira evento no Evolution", async () => {
  provider.push(cls("create_tool", null), ok(strictify(criarTreinos)));
  const job = await ask("Quero controlar meus treinos");
  assert.equal(job["status"], "done", JSON.stringify(job));
  assert.deepEqual(job["result"], { version: 1, summary: criarTreinos.summary, target: "treinos", home: "treinos_home" });
  // Modelo rápido para entender, principal para criar.
  assert.deepEqual(provider.calls.map((c) => c.model), ["m-fast", "m-main"]);

  const evo = await call("GET", "/v1/evolution");
  assert.equal(evo.body["events"][0]["kind"], "tool_created");
});

test("a IA não vê dados do usuário: só a estrutura", async () => {
  await call("POST", "/v1/records", { entity: "exercicio", data: { nome: "Supino secreto" } });
  provider.calls.length = 0;
  provider.push(cls("modify_tool", "treinos", "simple"), ok(adicionarRpe));
  const job = await ask("Quero adicionar RPE");
  assert.equal(job["status"], "done");
  assert.ok(provider.calls.every((c) => !c.input.includes("Supino secreto")));
  // Mudança pequena vai para o modelo rápido.
  assert.equal(provider.calls[1]?.model, "m-fast");
});

test("componente inventado: recusado pelo validador, nova tentativa sobe de modelo e corrige", async () => {
  provider.calls.length = 0;
  const inventado = {
    intent: "modify_tool",
    target: "treinos",
    summary: "Slider",
    operations: [{ type: "ADD_COMPONENT", screen: "treinos_home", parent: null, index: null, node: { id: "s", type: "slider_3d" } }],
  };
  const certo = {
    intent: "modify_tool",
    target: "treinos",
    summary: "Linha divisória no topo",
    operations: [{ type: "ADD_COMPONENT", screen: "treinos_home", parent: null, index: 1, node: { id: "linha", type: "divider" } }],
  };
  provider.push(cls("modify_tool", "treinos", "simple"), ok(inventado), ok(certo));
  const job = await ask("Coloca um slider 3D");
  assert.equal(job["status"], "done", JSON.stringify(job));
  assert.deepEqual(provider.calls.map((c) => c.model), ["m-fast", "m-fast", "m-main"]);
  // A segunda tentativa recebeu os problemas do validador.
  assert.match(provider.calls[2]?.input ?? "", /recusada pelo validador/);

  const rows = await db.query<{ validation: string | null; attempt: number; success: boolean }>(
    "SELECT validation, attempt, success FROM ai_calls WHERE role = 'builder' ORDER BY created_at DESC LIMIT 2",
  );
  assert.deepEqual(rows.map((r) => [r.attempt, r.validation, r.success]).sort(), [
    [0, "schema", false],
    [1, "ok", true],
  ]);
});

test("duas propostas inválidas: aborta e nada é aplicado", async () => {
  const before = await call("GET", "/v1/spec");
  const ruim = { intent: "modify_tool", target: "treinos", summary: "x", operations: [{ type: "ARCHIVE_FIELD", entity: "nada", field: "x" }] };
  provider.push(cls("modify_tool", "treinos"), ok(ruim), ok(ruim));
  const job = await ask("Tira o campo nada");
  assert.equal(job["status"], "failed");
  assert.equal((await call("GET", "/v1/spec")).body["version"], before.body["version"]);
});

test("remover RPE: proposta pede confirmação; recusar não muda nada; aceitar aplica", async () => {
  const v = (await call("GET", "/v1/spec")).body["version"] as number;
  provider.push(cls("modify_tool", "treinos"), ok(removerRpe));
  let job = await ask("Não quero mais registrar RPE");
  assert.equal(job["status"], "needs_confirmation");
  assert.equal(job["proposal"]["level"], "CONFIRM");
  assert.equal((await call("POST", `/v1/ai/jobs/${job["id"]}/decline`, {})).body["status"], "declined");
  assert.equal((await call("GET", "/v1/spec")).body["version"], v);

  provider.push(cls("modify_tool", "treinos"), ok(removerRpe));
  job = await ask("Não quero mais registrar RPE");
  const confirmed = await call("POST", `/v1/ai/jobs/${job["id"]}/confirm`, { confirm: true });
  assert.equal(confirmed.body["status"], "done");
  assert.equal((await call("GET", "/v1/spec")).body["version"], v + 1);
});

test("pedido fora do que o app faz: resposta gentil, nenhuma mudança, sem chamar o construtor", async () => {
  provider.calls.length = 0;
  provider.push(cls("not_supported", null, "simple", "Integração com o Spotify ainda não existe."));
  const job = await ask("Conecta meu Spotify");
  assert.equal(job["status"], "not_supported");
  assert.match(job["reply"], /Spotify/);
  assert.equal(provider.calls.length, 1);
});

test("IA fora do ar: falha avisando, app segue funcionando", async () => {
  provider.push({ ok: false, reason: "unavailable", message: "503", latencyMs: 3 });
  const job = await ask("Quero controlar minhas leituras");
  assert.equal(job["status"], "failed");
  assert.match(job["error"], /indisponível/);
  assert.equal((await call("GET", "/v1/spec")).status, 200);
});

test("custo do mês: soma o que tem preço configurado", async () => {
  const u = await call("GET", "/v1/ai/usage");
  assert.equal(u.body["enabled"], true);
  assert.ok(u.body["calls"] > 0);
  assert.ok(u.body["costUsd"] > 0);
});

test("sem IA configurada: 503 e o resto da API normal", async () => {
  const plain = buildApp({ db });
  await plain.ready();
  const r = await plain.inject({ method: "POST", url: "/v1/ai/requests", headers: { authorization: `Bearer ${token}` }, payload: { text: "oi tudo bem" } });
  assert.equal(r.statusCode, 503);
  await plain.close();
});
