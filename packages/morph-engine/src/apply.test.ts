import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpec, type AppSpec, type Node } from "@morph/protocol";
import { applyChangeset, restoreVersion, type ApplyResult } from "./apply.ts";
import { adicionarRpe, criarTreinos, mostrarRecorde, removerRpe } from "./fixtures/treinos.ts";
import type { Issue } from "./issues.ts";

function ok(result: ApplyResult): AppSpec {
  if (!result.ok) assert.fail(`esperava sucesso, veio ${result.stage}:\n${fmt(result.issues)}`);
  return result.spec;
}

function fail(result: ApplyResult) {
  if (result.ok) assert.fail("esperava falha, mas o changeset foi aceito");
  return result;
}

function fmt(issues: Issue[]) {
  return issues.map((i) => `  [${i.code}] ${i.path.join(".")}: ${i.message}`).join("\n");
}

function findNode(nodes: readonly Node[], id: string): Node | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if ("children" in n) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function screen(spec: AppSpec, id: string) {
  const s = spec.screens.find((x) => x.id === id);
  assert.ok(s, `tela ${id}`);
  return s;
}

const comTreinos = () => ok(applyChangeset(emptySpec(), criarTreinos));
const comRpe = () => ok(applyChangeset(comTreinos(), adicionarRpe));

// ---------- fluxo do MVP ----------

test("'Quero controlar meus treinos' cria ferramenta, entidades, telas e navegação", () => {
  const r = applyChangeset(emptySpec(), criarTreinos);
  const spec = ok(r);
  assert.equal(spec.version, 1);
  assert.deepEqual(spec.tools.map((x) => x.id), ["treinos"]);
  assert.deepEqual(spec.entities.map((x) => x.id), ["exercicio", "treino", "serie"]);
  assert.equal(spec.screens.length, 5);
  assert.deepEqual(spec.navigation, ["treinos"]);
  assert.equal(r.ok && r.level, "SAFE_ACTION");
});

test("'Adicione RPE' cria o campo e o coloca na tela atual, sem mexer no resto", () => {
  const antes = comTreinos();
  const r = applyChangeset(antes, adicionarRpe);
  const depois = ok(r);
  assert.equal(depois.version, 2);
  assert.equal(r.ok && r.level, "SAFE_ACTION");

  const serie = depois.entities.find((e) => e.id === "serie");
  assert.ok(serie?.fields.some((f) => f.id === "rpe" && f.status === "active"));

  const card = findNode(screen(depois, "treino_sessao").root, "serie_card");
  assert.ok(card && "children" in card);
  assert.deepEqual(card.children.map((c) => c.id), ["serie_exercicio", "serie_carga", "serie_reps", "serie_rpe"]);

  // Telas que não foram tocadas ficam idênticas.
  assert.deepEqual(screen(depois, "treinos_home"), screen(antes, "treinos_home"));
});

test("'Mostre meu recorde' adiciona o selo no card da série, na posição pedida", () => {
  const spec = ok(applyChangeset(comRpe(), mostrarRecorde));
  const card = findNode(screen(spec, "treino_sessao").root, "serie_card");
  assert.ok(card && "children" in card);
  assert.equal(card.children[1]?.id, "serie_recorde");
});

test("'Não quero mais RPE' arquiva o campo (dados ficam) e pede confirmação", () => {
  const r = applyChangeset(comRpe(), removerRpe);
  const spec = ok(r);
  assert.equal(r.ok && r.level, "CONFIRM");
  const rpe = spec.entities.find((e) => e.id === "serie")?.fields.find((f) => f.id === "rpe");
  assert.equal(rpe?.status, "archived");
  assert.equal(findNode(screen(spec, "treino_sessao").root, "serie_rpe"), undefined);
});

test("rollback: restaurar a versão anterior gera versão nova com o conteúdo antigo", () => {
  const v1 = comTreinos();
  const v2 = ok(applyChangeset(v1, adicionarRpe));
  const r = restoreVersion(v2, v1);
  assert.ok(r.ok);
  assert.equal(r.spec.version, 3);
  assert.deepEqual({ ...r.spec, version: 1 }, v1);
});

test("o id de um campo arquivado não pode ser reaproveitado (os dados antigos usam esse id)", () => {
  const semRpe = ok(applyChangeset(comRpe(), removerRpe));
  const r = fail(applyChangeset(semRpe, adicionarRpe));
  assert.equal(r.stage, "operations");
  assert.equal(r.issues[0]?.code, "id_reused");
});

// ---------- tudo ou nada ----------

test("falha não altera a spec original nem aplica parte das operações", () => {
  const spec = comTreinos();
  const antes = structuredClone(spec);
  const r = fail(
    applyChangeset(spec, {
      ...adicionarRpe,
      operations: [...adicionarRpe.operations, { type: "ADD_FIELD", entity: "workout_set", field: adicionarRpe.operations[0]!.field }],
    }),
  );
  assert.equal(r.stage, "operations");
  assert.deepEqual(spec, antes);
});

// ---------- saídas inválidas da IA ----------

test("componente inventado é rejeitado no schema", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Slider 3D",
      operations: [{ type: "ADD_COMPONENT", screen: "treinos_home", parent: null, node: { id: "x", type: "slider_3d" } }],
    }),
  );
  assert.equal(r.stage, "schema");
});

test("Skill inventada é rejeitada no schema", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Conectar GitHub",
      operations: [{ type: "CONNECT_SKILL", skill: "github" }],
    }),
  );
  assert.equal(r.stage, "schema");
});

test("texto livre no lugar de um changeset é rejeitado", () => {
  assert.equal(fail(applyChangeset(emptySpec(), "Claro! Criei sua ferramenta de treinos.")).stage, "schema");
});

test("referência a entidade inexistente é rejeitada", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "RPE",
      operations: [{ type: "ADD_FIELD", entity: "workout_set", field: adicionarRpe.operations[0]!.field }],
    }),
  );
  assert.equal(r.stage, "operations");
  assert.equal(r.issues[0]?.code, "not_found");
});

test("arquivar campo ainda usado na tela é rejeitado (a IA precisa tirar os componentes)", () => {
  const r = fail(
    applyChangeset(comRpe(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Tirar RPE",
      operations: [{ type: "ARCHIVE_FIELD", entity: "serie", field: "rpe" }],
    }),
  );
  assert.equal(r.stage, "semantic");
  assert.ok(r.issues.every((i) => i.code === "archived"));
  assert.equal(r.issues.length, 2);
});

test("soma de campo de texto é rejeitada", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Soma de nomes",
      operations: [
        {
          type: "ADD_COMPONENT",
          screen: "treinos_home",
          parent: "resumo",
          node: {
            id: "soma_nomes",
            type: "stat",
            label: "nomes",
            value: { kind: "aggregate", fn: "sum", field: "nome", query: { entity: "treino" } },
          },
        },
      ],
    }),
  );
  assert.equal(r.stage, "semantic");
  assert.equal(r.issues[0]?.code, "type_mismatch");
});

test("campo de entrada solto na tela (fora de formulário) é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Campo solto",
      operations: [{ type: "ADD_COMPONENT", screen: "treinos_home", parent: null, node: { id: "solto", type: "field_input", field: "nome" } }],
    }),
  );
  assert.equal(r.issues[0]?.code, "out_of_scope");
});

test("ler campo de item onde não há item é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Título",
      operations: [
        { type: "ADD_COMPONENT", screen: "treinos_home", parent: null, node: { id: "t", type: "heading", text: { kind: "field", path: ["nome"] } } },
      ],
    }),
  );
  assert.equal(r.issues[0]?.code, "out_of_scope");
});

test("navegar sem o parâmetro obrigatório da tela é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Atalho",
      operations: [{ type: "CREATE_ACTION", action: { id: "atalho", toolId: "treinos", kind: "navigate", screen: "treino_sessao" } }],
    }),
  );
  assert.equal(r.stage, "semantic");
  assert.match(r.issues[0]?.message ?? "", /falta o parâmetro "treino"/);
});

test("parâmetro de tela com nome reservado pela navegação é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Tela com parâmetro reservado",
      operations: [
        {
          type: "CREATE_SCREEN",
          screen: {
            id: "detalhe",
            toolId: "treinos",
            title: "Detalhe",
            params: [{ id: "screen", entity: "treino" }],
            root: [{ id: "d", type: "divider" }],
          },
        },
      ],
    }),
  );
  assert.equal(r.issues[0]?.code, "reserved_id");
});

test("id de componente repetido na mesma tela é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Duplicado",
      operations: [{ type: "ADD_COMPONENT", screen: "treinos_home", parent: null, node: { id: "cabecalho", type: "divider" } }],
    }),
  );
  assert.equal(r.issues[0]?.code, "duplicate_id");
});

test("formulário de criação sem campo obrigatório é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Tirar nome",
      operations: [{ type: "REMOVE_COMPONENT", screen: "treino_novo", node: "form_treino_nome" }],
    }),
  );
  assert.equal(r.issues[0]?.code, "incomplete_form");
});

test("campo novo obrigatório é rejeitado (registros antigos não têm valor)", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "modify_tool",
      target: "treinos",
      summary: "Local",
      operations: [
        { type: "ADD_FIELD", entity: "treino", field: { id: "local", label: "Local", type: "text", required: true, status: "active" } },
      ],
    }),
  );
  assert.equal(r.stage, "operations");
});

test("ferramenta cuja tela inicial não existe é rejeitada", () => {
  const r = fail(
    applyChangeset(emptySpec(), {
      intent: "create_tool",
      target: "notas",
      summary: "Notas",
      operations: [
        { type: "CREATE_TOOL", tool: { id: "notas", name: "Notas", icon: "note", accent: "yellow", home: "notas_home", status: "active" } },
      ],
    }),
  );
  assert.equal(r.stage, "semantic");
  assert.equal(r.issues[0]?.code, "not_found");
});

test("mover componente para dentro dele mesmo é rejeitado", () => {
  const r = fail(
    applyChangeset(comTreinos(), {
      intent: "reorganize",
      target: "treinos",
      summary: "Mover",
      operations: [{ type: "MOVE_COMPONENT", screen: "treinos_home", node: "semana", parent: "semana_grafico" }],
    }),
  );
  assert.equal(r.stage, "operations");
});

test("mover e reordenar componentes mantém os ids (base do Motion)", () => {
  const spec = ok(
    applyChangeset(comTreinos(), {
      intent: "reorganize",
      target: "treinos",
      summary: "Últimos treinos antes da semana",
      operations: [{ type: "MOVE_COMPONENT", screen: "treinos_home", node: "ultimos", parent: null, index: 2 }],
    }),
  );
  assert.deepEqual(
    screen(spec, "treinos_home").root.map((n) => n.id),
    ["cabecalho", "treino_hoje", "ultimos", "semana", "resumo"],
  );
});

test("arquivar ferramenta pede confirmação e a tira da navegação", () => {
  const r = applyChangeset(comTreinos(), { intent: "archive", target: "treinos", summary: "Arquivar", operations: [{ type: "ARCHIVE_TOOL", tool: "treinos" }] });
  const spec = ok(r);
  assert.equal(r.ok && r.level, "CONFIRM");
  assert.deepEqual(spec.navigation, []);
});
