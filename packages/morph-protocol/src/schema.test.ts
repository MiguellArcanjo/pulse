import { test } from "node:test";
import assert from "node:assert/strict";
import { AppSpec, Changeset, Condition, Formula, Node, emptySpec } from "./index.ts";

test("app vazio é uma spec válida", () => {
  assert.ok(AppSpec.safeParse(emptySpec()).success);
});

test("fórmula aninhada com operação de enum no discriminador", () => {
  const r = Formula.safeParse({
    op: "mul",
    args: [{ op: "field", field: "carga" }, { op: "add", args: [{ op: "field", field: "reps" }, { op: "const", value: 1 }] }],
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("condições com operadores agrupados", () => {
  assert.ok(Condition.safeParse({ op: "gte", field: "data", value: { kind: "literal", value: 3 } }).success);
  assert.ok(Condition.safeParse({ op: "within", field: "data", period: "this_week" }).success);
  assert.ok(Condition.safeParse({ op: "not_empty", field: "data" }).success);
  assert.ok(!Condition.safeParse({ op: "within", field: "data" }).success);
});

test("árvore de componentes recursiva", () => {
  const r = Node.safeParse({
    id: "raiz",
    type: "stack",
    children: [
      { id: "titulo", type: "heading", text: { kind: "text", text: "Oi" } },
      { id: "linha", type: "row", children: [{ id: "d", type: "divider" }] },
    ],
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("componente inventado é rejeitado", () => {
  const r = Node.safeParse({ id: "x", type: "slider_3d" });
  assert.ok(!r.success);
});

test("propriedade de estilo livre é rejeitada (a IA não escolhe cor)", () => {
  const r = Node.safeParse({ id: "x", type: "divider", color: "#ff00ff" });
  assert.ok(!r.success);
});

test("ids com formato inválido são rejeitados", () => {
  const r = Node.safeParse({ id: "Treino Hoje", type: "divider" });
  assert.ok(!r.success);
  assert.deepEqual(r.error?.issues[0]?.path, ["id"]);
});

test("automações e skills ainda não existem: spec com elas é rejeitada", () => {
  const spec = { ...emptySpec(), skills: [{ id: "github" }] };
  assert.ok(!AppSpec.safeParse(spec).success);
});

test("operação inventada (conectar skill) é rejeitada", () => {
  const r = Changeset.safeParse({
    intent: "modify_tool",
    target: null,
    summary: "Conectar GitHub",
    operations: [{ type: "CONNECT_SKILL", skill: "github" }],
  });
  assert.ok(!r.success);
});

test("changeset vazio é rejeitado", () => {
  assert.ok(!Changeset.safeParse({ intent: "modify_tool", target: null, summary: "nada", operations: [] }).success);
});
