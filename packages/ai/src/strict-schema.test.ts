import { test } from "node:test";
import assert from "node:assert/strict";
import { adicionarRpe, criarTreinos, mostrarRecorde, removerRpe } from "@morph/engine/fixtures";
import { Changeset } from "@morph/protocol";
import { fromStrict, toStrictSchema } from "./strict-schema.ts";

const { schema, original } = toStrictSchema(Changeset);

/** Visita cada (sub)schema; os nomes dentro de `properties` são campos, não palavras-chave. */
function walk(o: unknown, fn: (node: Record<string, unknown>) => void) {
  if (o && typeof o === "object") {
    if (!Array.isArray(o)) fn(o as Record<string, unknown>);
    for (const [k, v] of Object.entries(o)) {
      if (k === "properties" || k === "$defs") for (const sub of Object.values(v as object)) walk(sub, fn);
      else walk(v, fn);
    }
  }
}

test("schema estrito: só palavras-chave aceitas e todo objeto fechado com todos os campos obrigatórios", () => {
  const forbidden = ["oneOf", "prefixItems", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "propertyNames"];
  walk(schema, (n) => {
    for (const k of forbidden) assert.ok(!(k in n), `palavra-chave proibida: ${k}`);
    if (n["type"] === "object" && n["properties"]) {
      assert.equal(n["additionalProperties"], false);
      assert.deepEqual([...(n["required"] as string[])].sort(), Object.keys(n["properties"] as object).sort());
    }
    if (n["type"] === "object" && !n["properties"]) assert.fail("objeto sem propriedades (record) deveria virar lista");
  });
});

test("schema estrito ficou bem menor que o original", () => {
  const size = JSON.stringify(schema).length;
  assert.ok(size < 30_000, `tamanho ${size}`);
});

/**
 * Ida e volta: um changeset válido, escrito como a IA escreveria no modo estrito
 * (pares no lugar de mapas), volta exatamente ao original.
 */
function strictify(v: unknown): unknown {
  // Converte `params: {a: x}` em `[{key: "a", value: x}]` (o único mapa do protocolo).
  if (Array.isArray(v)) return v.map(strictify);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (k === "params" && o["kind"] === "navigate" && val && typeof val === "object" && !Array.isArray(val))
        out[k] = Object.entries(val).map(([key, value]) => ({ key, value: strictify(value) }));
      else out[k] = strictify(val);
    }
    return out;
  }
  return v;
}

for (const [name, cs] of Object.entries({ criarTreinos, adicionarRpe, mostrarRecorde, removerRpe })) {
  test(`ida e volta sem perda: ${name}`, () => {
    const back = fromStrict(strictify(cs), original);
    assert.deepEqual(back, JSON.parse(JSON.stringify(cs)));
    assert.ok(Changeset.safeParse(back).success);
  });
}

test("nulls nos opcionais somem na volta, mas null obrigatório (parent da raiz) fica", () => {
  const v = {
    intent: "modify_tool",
    target: "treinos",
    summary: "x",
    operations: [
      { type: "ADD_COMPONENT", screen: "treinos_home", parent: null, index: null, node: { id: "d", type: "divider", priority: null } },
    ],
  };
  const back = fromStrict(v, original) as { operations: Record<string, unknown>[] };
  assert.deepEqual(back.operations[0], { type: "ADD_COMPONENT", screen: "treinos_home", parent: null, node: { id: "d", type: "divider" } });
  assert.ok(Changeset.safeParse(back).success);
});
