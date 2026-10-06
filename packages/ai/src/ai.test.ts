import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChangeset } from "@morph/engine";
import { criarTreinos } from "@morph/engine/fixtures";
import { emptySpec } from "@morph/protocol";
import { loadAIConfig } from "./config.ts";
import { buildContext } from "./context.ts";
import { estimateCost } from "./cost.ts";
import type { Classification } from "./prompts/classifier.ts";
import { BUILDER_SYSTEM } from "./prompts/builder.ts";
import { chooseTier } from "./router.ts";

const r = applyChangeset(emptySpec(), criarTreinos);
assert.ok(r.ok);
const spec = r.spec;

const c = (over: Partial<Classification>): Classification => ({
  intent: "modify_tool",
  target: "treinos",
  complexity: "normal",
  progressTitle: "x",
  reply: null,
  ...over,
});

test("router: pequena mudança no FAST, ferramenta nova no MAIN, complexa no REASONING", () => {
  assert.equal(chooseTier(c({ complexity: "simple" }), 0), "fast");
  assert.equal(chooseTier(c({ intent: "create_tool", target: null }), 0), "main");
  assert.equal(chooseTier(c({ complexity: "complex" }), 0), "reasoning");
  assert.equal(chooseTier(c({ intent: "archive", complexity: "simple" }), 0), "reasoning");
});

test("router: nova tentativa sobe um nível, sem passar do topo", () => {
  assert.equal(chooseTier(c({ complexity: "simple" }), 1), "main");
  assert.equal(chooseTier(c({ complexity: "simple" }), 2), "reasoning");
  assert.equal(chooseTier(c({ complexity: "complex" }), 3), "reasoning");
});

test("contexto de criação: só nomes e ids, nada de estrutura interna nem dados", () => {
  const ctx = buildContext(spec, "create_tool", null);
  assert.ok(!ctx.text.includes("fields"));
  assert.ok(ctx.text.includes("treinos"));
});

test("contexto de mudança: a ferramenta alvo inteira", () => {
  const ctx = buildContext(spec, "modify_tool", "treinos");
  const parsed = JSON.parse(ctx.text) as { entities: unknown[]; screens: unknown[] };
  assert.equal(parsed.entities.length, 3);
  assert.equal(parsed.screens.length, 5);
});

test("custo: entrada em cache mais barata; sem preço configurado = desconhecido", () => {
  const usage = { inputTokens: 10_000, cachedTokens: 6_000, outputTokens: 2_000, reasoningTokens: 500 };
  assert.equal(estimateCost(usage, { input: 2, cached: 0.1, output: 10 }), (4_000 * 2 + 6_000 * 0.1 + 2_000 * 10) / 1e6);
  assert.equal(estimateCost(usage, undefined), null);
});

test("config: sem AI_PROVIDER a IA fica desligada; configuração pela metade é erro", () => {
  assert.equal(loadAIConfig({}), null);
  assert.throws(() => loadAIConfig({ AI_PROVIDER: "openai" }));
  const ok = loadAIConfig({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_MODEL_FAST: "a", AI_MODEL_MAIN: "b", AI_MODEL_REASONING: "c" });
  assert.deepEqual(ok?.models, { fast: "a", main: "b", reasoning: "c" });
});

test("prompt do construtor lista só componentes que existem e não muda entre chamadas (cache)", () => {
  assert.ok(BUILDER_SYSTEM.includes("field_input"));
  assert.ok(!BUILDER_SYSTEM.includes("slider"));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(BUILDER_SYSTEM), "nada de data/hora no prompt fixo");
});
