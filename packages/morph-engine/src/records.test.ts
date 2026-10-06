import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpec, type AppSpec, type Entity } from "@morph/protocol";
import { applyChangeset } from "./apply.ts";
import { adicionarRpe, criarTreinos, removerRpe } from "./fixtures/treinos.ts";
import { computeFields, recordSchema } from "./records.ts";

function entity(spec: AppSpec, id: string): Entity {
  const e = spec.entities.find((x) => x.id === id);
  assert.ok(e);
  return e;
}

function apply(spec: AppSpec, cs: unknown): AppSpec {
  const r = applyChangeset(spec, cs);
  assert.ok(r.ok);
  return r.spec;
}

const v1 = apply(emptySpec(), criarTreinos);
const v2 = apply(v1, adicionarRpe);
const v3 = apply(v2, removerRpe);
const ID = "3f1c2a4e-8b7d-4c6a-9e2f-1a2b3c4d5e6f";

test("série válida é aceita e o volume é calculado", () => {
  const data = { treino: ID, exercicio: ID, carga: 80, repeticoes: 8 };
  assert.ok(recordSchema(entity(v1, "serie"), "create").safeParse(data).success);
  assert.deepEqual(computeFields(entity(v1, "serie"), data), { volume: 640 });
});

test("volume fica vazio quando falta carga", () => {
  assert.deepEqual(computeFields(entity(v1, "serie"), { repeticoes: 8 }), { volume: null });
});

test("criação sem campo obrigatório é rejeitada", () => {
  assert.ok(!recordSchema(entity(v1, "treino"), "create").safeParse({ nome: "Peito" }).success);
});

test("data em formato errado é rejeitada", () => {
  assert.ok(!recordSchema(entity(v1, "treino"), "create").safeParse({ nome: "Peito", data: "06/10/2026" }).success);
});

test("campo calculado não pode ser gravado pelo usuário", () => {
  const r = recordSchema(entity(v1, "serie"), "update").safeParse({ volume: 9999 });
  assert.ok(!r.success);
});

test("RPE respeita os limites depois de adicionado", () => {
  const s = recordSchema(entity(v2, "serie"), "update");
  assert.ok(s.safeParse({ rpe: 8.5 }).success);
  assert.ok(!s.safeParse({ rpe: 11 }).success);
});

test("campo arquivado não aceita escrita nova", () => {
  assert.ok(!recordSchema(entity(v3, "serie"), "update").safeParse({ rpe: 8 }).success);
});

test("atualização parcial com null limpa campo opcional", () => {
  assert.ok(recordSchema(entity(v1, "serie"), "update").safeParse({ carga: null }).success);
  assert.ok(!recordSchema(entity(v1, "treino"), "update").safeParse({ nome: null }).success);
});

test("opção fora da lista de um select é rejeitada", () => {
  const s = recordSchema(entity(v1, "exercicio"), "create");
  assert.ok(s.safeParse({ nome: "Supino reto", grupo: "peito" }).success);
  assert.ok(!s.safeParse({ nome: "Supino reto", grupo: "gluteo" }).success);
});
