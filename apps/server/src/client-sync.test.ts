import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ApiError, MorphApi, pull, upsertLocal, type Snapshot } from "@morph/client";
import { RecordIndex, resolveValue, formatResolved } from "@morph/engine";
import { adicionarRpe, criarTreinos } from "@morph/engine/fixtures";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createPairingCode } from "./auth.ts";
import { commitChangeset } from "./changes.ts";
import type { Db } from "./db/db.ts";
import { migrate } from "./db/migrate.ts";
import { pgliteDb } from "./db/pglite.ts";

/**
 * O cliente do app (@morph/client) contra o servidor escutando numa porta de verdade:
 * parear, sincronizar, gravar, apagar, e o que acontece quando o servidor some.
 */

let db: Db;
let app: FastifyInstance;
let api: MorphApi;
let snapshot: Snapshot | null = null;

before(async () => {
  db = await pgliteDb("memory://");
  await migrate(db);
  app = buildApp({ db });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  api = new MorphApi({ baseUrl: `http://127.0.0.1:${port}` });
});

after(async () => {
  await db.close();
});

test("pareia e baixa o app vazio", async () => {
  const { code } = await createPairingCode(db);
  const { token } = await api.pair(code, "Teste");
  api = api.withToken(token);
  snapshot = await pull(api, null);
  assert.equal(snapshot.version, 0);
  assert.equal(snapshot.records.length, 0);
});

test("depois de criar Treinos, a sincronização traz a spec nova", async () => {
  const [user] = await db.query<{ id: string }>("SELECT id FROM users");
  assert.ok(user);
  const r = await commitChangeset(db, user.id, criarTreinos, { confirm: false, source: "dev" });
  assert.ok(r.ok);
  snapshot = await pull(api, snapshot);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.spec.tools[0]?.name, "Treinos");
});

test("gravar pelo cliente e calcular a tela com os dados locais", async () => {
  assert.ok(snapshot);
  const ex = await api.createRecord("exercicio", { nome: "Supino reto" });
  const tr = await api.createRecord("treino", { nome: "Peito + Tríceps", data: "2026-10-06" });
  const se = await api.createRecord("serie", { treino: tr.id, exercicio: ex.id, carga: 80, repeticoes: 8 });
  snapshot = upsertLocal(upsertLocal(upsertLocal(snapshot, ex), tr), se);

  const volume = resolveValue(
    { kind: "aggregate", fn: "sum", field: "volume", format: "compact", query: { entity: "serie" } },
    { spec: snapshot.spec, records: new RecordIndex(snapshot.records), now: new Date(2026, 9, 6, 20), params: {} },
  );
  assert.equal(formatResolved(volume, new Date()), "640 kg");
});

test("sincronizar de novo não duplica nada", async () => {
  snapshot = await pull(api, snapshot);
  assert.equal(snapshot.records.length, 3);
});

test("erro de validação chega com os detalhes", async () => {
  const serie = snapshot?.records.find((r) => r.entity === "serie");
  assert.ok(serie);
  await assert.rejects(api.updateRecord(serie.id, { rpe: 8 }), (err: unknown) => {
    // RPE ainda não existe nesta versão do app.
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 400);
    assert.ok(err.body.issues && err.body.issues.length > 0);
    return true;
  });
});

test("campo novo (RPE) passa a ser aceito depois da mudança", async () => {
  const [user] = await db.query<{ id: string }>("SELECT id FROM users");
  assert.ok(user && (await commitChangeset(db, user.id, adicionarRpe, { confirm: false, source: "dev" })).ok);
  snapshot = await pull(api, snapshot);
  const serie = snapshot.records.find((r) => r.entity === "serie");
  assert.ok(serie);
  const updated = await api.updateRecord(serie.id, { rpe: 8 });
  assert.equal(updated.data["rpe"], 8);
});

test("apagar some do aparelho na próxima sincronização", async () => {
  assert.ok(snapshot);
  const ex = snapshot.records.find((r) => r.entity === "exercicio");
  assert.ok(ex);
  await api.deleteRecord(ex.id);
  snapshot = await pull(api, snapshot);
  assert.equal(snapshot.records.some((r) => r.id === ex.id), false);
});

test("servidor fora do ar: erro 'offline' e o snapshot local continua", async () => {
  await app.close();
  const before = snapshot;
  await assert.rejects(pull(api, snapshot), (err: unknown) => err instanceof ApiError && err.offline);
  assert.equal(snapshot, before);
});
