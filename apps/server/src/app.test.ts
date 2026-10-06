import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { adicionarRpe, criarTreinos, removerRpe } from "@morph/engine/fixtures";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createPairingCode } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { migrate } from "./db/migrate.ts";
import { pgliteDb } from "./db/pglite.ts";

/**
 * Fluxo do MVP pela API, com um Postgres de verdade (PGlite) só na memória:
 * parear → app vazio → criar Treinos → registrar treino → RPE → remover RPE → desfazer.
 * Os testes rodam em ordem e cada um parte do estado deixado pelo anterior.
 */

let db: Db;
let app: FastifyInstance;
let token = "";
const ids: Record<string, string> = {};

before(async () => {
  db = await pgliteDb("memory://");
  await migrate(db);
  app = buildApp({ db });
  await app.ready();
});

after(async () => {
  await app.close();
  await db.close();
});

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, auth = true) {
  const res = await app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
    headers: auth ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: res.body ? (res.json() as Record<string, any>) : {} };
}

test("health responde sem token", async () => {
  assert.deepEqual((await call("GET", "/v1/health", undefined, false)).body, { ok: true });
});

test("sem token não entra", async () => {
  assert.equal((await call("GET", "/v1/spec", undefined, false)).status, 401);
  token = "token-inventado";
  assert.equal((await call("GET", "/v1/spec")).status, 401);
});

test("pareamento: código errado falha, código certo vale uma vez só", async () => {
  assert.equal((await call("POST", "/v1/auth/pair", { code: "AAAAA-BBBBB", deviceName: "iPhone" }, false)).status, 401);

  const { code } = await createPairingCode(db);
  const ok = await call("POST", "/v1/auth/pair", { code: code.toLowerCase(), deviceName: "iPhone do Miguel" }, false);
  assert.equal(ok.status, 200);
  token = ok.body["token"];
  assert.ok(token.length >= 40);

  assert.equal((await call("POST", "/v1/auth/pair", { code, deviceName: "Outro" }, false)).status, 401);
});

test("aparelho pareado gera código para outro aparelho", async () => {
  assert.equal((await call("POST", "/v1/auth/pairing-codes", {}, false)).status, 401);
  const r = await call("POST", "/v1/auth/pairing-codes", {});
  assert.equal(r.status, 200);
  const other = await call("POST", "/v1/auth/pair", { code: r.body["code"], deviceName: "Script" }, false);
  assert.equal(other.status, 200);
});

test("o token não fica guardado no banco, só o hash", async () => {
  const rows = await db.query<{ token_hash: string }>("SELECT token_hash FROM devices");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.token_hash !== token));
});

test("app começa vazio, na versão 0", async () => {
  const r = await call("GET", "/v1/spec");
  assert.equal(r.status, 200);
  assert.equal(r.body["version"], 0);
  assert.deepEqual(r.body["spec"]["tools"], []);
});

test("'Quero controlar meus treinos' vira a versão 1 e um evento no Evolution", async () => {
  const r = await call("POST", "/v1/changesets", { changeset: criarTreinos });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["version"], 1);
  assert.equal(r.body["event"]["kind"], "tool_created");

  const evo = await call("GET", "/v1/evolution");
  assert.deepEqual(evo.body["events"].map((e: any) => e.kind), ["tool_created", "app_started"]);
  assert.deepEqual(evo.body["counts"], { tools: 1, automations: 0, integrations: 0 });
});

test("changeset inválido é recusado e não muda a versão", async () => {
  const r = await call("POST", "/v1/changesets", {
    changeset: { intent: "modify_tool", target: "treinos", summary: "x", operations: [{ type: "ARCHIVE_FIELD", entity: "nada", field: "x" }] },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body["stage"], "operations");
  assert.equal((await call("GET", "/v1/spec")).body["version"], 1);
});

test("registrar um treino: exercício, treino e série", async () => {
  const ex = await call("POST", "/v1/records", { entity: "exercicio", data: { nome: "Supino reto", grupo: "peito" } });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  ids["exercicio"] = ex.body["id"];

  const tr = await call("POST", "/v1/records", { entity: "treino", data: { nome: "Peito + Tríceps", data: "2026-10-06" } });
  assert.equal(tr.status, 201);
  ids["treino"] = tr.body["id"];

  const se = await call("POST", "/v1/records", {
    entity: "serie",
    data: { treino: ids["treino"], exercicio: ids["exercicio"], carga: 80, repeticoes: 8 },
  });
  assert.equal(se.status, 201, JSON.stringify(se.body));
  ids["serie"] = se.body["id"];
});

test("referência para a entidade errada é recusada", async () => {
  const r = await call("POST", "/v1/records", {
    entity: "serie",
    data: { treino: ids["exercicio"], exercicio: ids["exercicio"] },
  });
  assert.equal(r.status, 400);
  assert.match(r.body["issues"][0]["message"], /treino/);
});

test("dado com tipo errado é recusado", async () => {
  const r = await call("PATCH", `/v1/records/${ids["serie"]}`, { data: { carga: "oitenta" } });
  assert.equal(r.status, 400);
});

test("RPE: campo novo aceita valor e guarda junto com o resto", async () => {
  assert.equal((await call("POST", "/v1/changesets", { changeset: adicionarRpe })).body["version"], 2);
  const r = await call("PATCH", `/v1/records/${ids["serie"]}`, { data: { rpe: 8.5 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body["data"], { treino: ids["treino"], exercicio: ids["exercicio"], carga: 80, repeticoes: 8, rpe: 8.5 });
});

test("remover RPE pede confirmação; confirmado, o valor antigo continua guardado", async () => {
  const sem = await call("POST", "/v1/changesets", { changeset: removerRpe });
  assert.equal(sem.status, 409);
  assert.equal(sem.body["level"], "CONFIRM");

  const com = await call("POST", "/v1/changesets", { changeset: removerRpe, confirm: true });
  assert.equal(com.status, 200);
  assert.equal(com.body["version"], 3);

  assert.equal((await call("PATCH", `/v1/records/${ids["serie"]}`, { data: { rpe: 9 } })).status, 400);
  const sync = await call("GET", "/v1/records");
  const serie = sync.body["records"].find((r: any) => r.id === ids["serie"]);
  assert.equal(serie.data.rpe, 8.5);
});

test("desfazer: volta o RPE (versão nova, histórico intacto)", async () => {
  assert.equal((await call("POST", "/v1/versions/2/restore", {})).status, 409);
  const r = await call("POST", "/v1/versions/2/restore", { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["version"], 4);
  assert.match(r.body["event"]["summary"], /^Desfeito: RPE deixa de ser registrado/);

  assert.equal((await call("PATCH", `/v1/records/${ids["serie"]}`, { data: { rpe: 9 } })).status, 200);
  const versions = await call("GET", "/v1/versions");
  assert.deepEqual(versions.body["versions"].map((v: any) => v.version), [4, 3, 2, 1, 0]);
});

test("sincronização em páginas e remoção chegando como 'apagado'", async () => {
  const p1 = await call("GET", "/v1/records?limit=2");
  assert.equal(p1.body["records"].length, 2);
  assert.equal(p1.body["hasMore"], true);
  const p2 = await call("GET", `/v1/records?limit=2&cursor=${encodeURIComponent(p1.body["cursor"])}`);
  assert.equal(p2.body["records"].length, 1);
  assert.equal(p2.body["hasMore"], false);

  assert.equal((await call("DELETE", `/v1/records/${ids["exercicio"]}`, {})).status, 409);
  assert.equal((await call("DELETE", `/v1/records/${ids["exercicio"]}`, { confirm: true })).status, 204);
  const p3 = await call("GET", `/v1/records?cursor=${encodeURIComponent(p2.body["cursor"])}`);
  assert.deepEqual(p3.body["records"].map((r: any) => [r.id, r.deleted]), [[ids["exercicio"], true]]);
});
