import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpec, type AppSpec } from "@morph/protocol";
import { applyChangeset } from "./apply.ts";
import { diffSpecs } from "./diff.ts";
import { adicionarRpe, criarTreinos, mostrarRecorde, removerRpe } from "./fixtures/treinos.ts";

function apply(spec: AppSpec, cs: unknown): AppSpec {
  const r = applyChangeset(spec, cs);
  assert.ok(r.ok);
  return r.spec;
}

const v1 = apply(emptySpec(), criarTreinos);
const v2 = apply(v1, adicionarRpe);

test("criar a ferramenta: ferramenta nova e todas as telas como 'surgiram'", () => {
  const d = diffSpecs(emptySpec(), v1);
  assert.deepEqual(d.tools.added, ["treinos"]);
  assert.equal(Object.keys(d.screens).length, 5);
});

test("RPE: só o campo novo surge, em cada tela onde entrou; nada mais é marcado", () => {
  const d = diffSpecs(v1, v2);
  assert.deepEqual(d.screens, {
    treino_sessao: { added: ["serie_rpe"], removed: [], updated: [], moved: [] },
    serie_nova: { added: ["form_serie_rpe"], removed: [], updated: [], moved: [] },
  });
});

test("recorde inserido no meio não marca os irmãos como movidos", () => {
  const d = diffSpecs(v2, apply(v2, mostrarRecorde));
  assert.deepEqual(d.screens["treino_sessao"], { added: ["serie_recorde"], removed: [], updated: [], moved: [] });
});

test("remover RPE: o campo some das duas telas", () => {
  const d = diffSpecs(v2, apply(v2, removerRpe));
  assert.deepEqual(d.screens["treino_sessao"]?.removed, ["serie_rpe"]);
  assert.deepEqual(d.screens["serie_nova"]?.removed, ["form_serie_rpe"]);
});

test("reorganizar: o bloco movido é marcado como movido", () => {
  const moved = apply(v1, {
    intent: "reorganize",
    target: "treinos",
    summary: "Últimos treinos antes da semana",
    operations: [{ type: "MOVE_COMPONENT", screen: "treinos_home", node: "ultimos", parent: null, index: 2 }],
  });
  const d = diffSpecs(v1, moved);
  assert.ok(d.screens["treinos_home"]?.moved.includes("ultimos"));
  assert.deepEqual(d.screens["treinos_home"]?.added, []);
});

test("mudar o conteúdo de um componente o marca como atualizado (o pai não)", () => {
  const next = apply(v1, {
    intent: "modify_tool",
    target: "treinos",
    summary: "Título",
    operations: [
      {
        type: "UPDATE_COMPONENT",
        screen: "treinos_home",
        node: { id: "semana_grafico", type: "chart", variant: "bar", query: { entity: "treino" }, groupBy: { field: "data", bucket: "weekday" }, measure: { fn: "count" } },
      },
    ],
  });
  assert.deepEqual(diffSpecs(v1, next).screens["treinos_home"]?.updated, ["semana_grafico"]);
});
