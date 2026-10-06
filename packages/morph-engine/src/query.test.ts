import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpec, type AppSpec, type Node } from "@morph/protocol";
import { applyChangeset } from "./apply.ts";
import { adicionarRpe, criarTreinos, recordeNode } from "./fixtures/treinos.ts";
import { formatDuration, formatNumber, formatRelativeDate, formatResolved } from "./format.ts";
import { chartBuckets, periodRange, RecordIndex, resolveValue, runQuery, type EvalContext, type StoredRecord } from "./query.ts";

function apply(spec: AppSpec, cs: unknown): AppSpec {
  const r = applyChangeset(spec, cs);
  assert.ok(r.ok);
  return r.spec;
}

const spec = apply(apply(emptySpec(), criarTreinos), adicionarRpe);

// Terça-feira, 6 de outubro de 2026, 20h (horário local).
const NOW = new Date(2026, 9, 6, 20, 0, 0);
const iso = (d: Date) => d.toISOString();

let n = 0;
function rec(entity: string, data: Record<string, unknown>, created = NOW): StoredRecord {
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id, entity, data, createdAt: iso(created), updatedAt: iso(created) };
}

const supino = rec("exercicio", { nome: "Supino reto", grupo: "peito" });
const triceps = rec("exercicio", { nome: "Tríceps corda", grupo: "triceps" });
const hoje = rec("treino", { nome: "Peito + Tríceps", data: "2026-10-06" });
const sabado = rec("treino", { nome: "Costas + Bíceps", data: "2026-10-03" });
const segunda = rec("treino", { nome: "Pernas", data: "2026-10-05" });
const semanaPassada = new Date(2026, 8, 30, 19);
const s1 = rec("serie", { treino: hoje.id, exercicio: supino.id, carga: 80, repeticoes: 8, rpe: 8 });
const s2 = rec("serie", { treino: hoje.id, exercicio: supino.id, carga: 100, repeticoes: 5 });
const s3 = rec("serie", { treino: hoje.id, exercicio: triceps.id, carga: 30, repeticoes: 12 });
const antiga = rec("serie", { treino: sabado.id, exercicio: supino.id, carga: 70, repeticoes: 10 }, semanaPassada);

const records = new RecordIndex([supino, triceps, hoje, sabado, segunda, s1, s2, s3, antiga]);
const ctx: EvalContext = { spec, records, now: NOW, params: {} };

function node(screenId: string, id: string): Node {
  const find = (nodes: readonly Node[]): Node | undefined => {
    for (const x of nodes) {
      if (x.id === id) return x;
      if ("children" in x) {
        const f = find(x.children);
        if (f) return f;
      }
    }
    return undefined;
  };
  const found = find(spec.screens.find((s) => s.id === screenId)?.root ?? []);
  assert.ok(found, id);
  return found;
}

test("semana começa na segunda", () => {
  const [start, end] = periodRange("this_week", NOW);
  assert.equal(start.getDate(), 5);
  assert.equal(end.getDate(), 12);
});

test("'Treino de hoje' encontra o treino com a data de hoje e conta as séries", () => {
  const hero = node("treinos_home", "treino_hoje");
  assert.equal(hero.type, "hero_card");
  if (hero.type !== "hero_card" || !hero.query || !hero.meta) return;
  const [item] = runQuery(hero.query, ctx);
  assert.equal(item?.id, hoje.id);
  const meta = resolveValue(hero.meta, { ...ctx, item });
  assert.equal(formatResolved(meta, NOW), "3 séries");
  const umaSerie = { ...ctx, records: new RecordIndex([hoje, s1]) };
  assert.equal(formatResolved(resolveValue(hero.meta, { ...umaSerie, item }), NOW), "1 série");
});

test("resumo da semana: treinos, volume (calculado) e progresso", () => {
  const value = (id: string) => {
    const n = node("treinos_home", id);
    assert.equal(n.type, "stat");
    return n.type === "stat" ? formatResolved(resolveValue(n.value, ctx), NOW) : "";
  };
  // Treinos com data nesta semana: segunda (5) e terça (6). Sábado (3) é da semana passada.
  assert.equal(value("resumo_treinos"), "2");
  // Volume desta semana: 80×8 + 100×5 + 30×12 = 1500 kg → 1,5 t
  assert.equal(value("resumo_volume"), "1,5 t");
  // Semana passada: 70×10 = 700 → +114%
  assert.equal(value("resumo_progresso"), "+114%");
});

test("gráfico da semana: 7 barras de segunda a domingo, com hoje marcado", () => {
  const chart = node("treinos_home", "semana_grafico");
  assert.equal(chart.type, "chart");
  if (chart.type !== "chart") return;
  const buckets = chartBuckets(runQuery(chart.query, ctx), chart.groupBy, chart.measure, ctx);
  assert.deepEqual(buckets.map((b) => b.label), ["S", "T", "Q", "Q", "S", "S", "D"]);
  assert.deepEqual(buckets.map((b) => b.value), [1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(buckets.map((b) => b.current), [false, true, false, false, false, false, false]);
});

test("'Últimos treinos' ordena por data e mostra data relativa", () => {
  const list = node("treinos_home", "ultimos_lista");
  assert.equal(list.type, "list");
  if (list.type !== "list" || !list.item.subtitle) return;
  const rows = runQuery(list.query, ctx);
  assert.deepEqual(rows.map((r) => r.data["nome"]), ["Peito + Tríceps", "Pernas", "Costas + Bíceps"]);
  const subtitle = list.item.subtitle;
  assert.deepEqual(
    rows.map((r) => formatResolved(resolveValue(subtitle, { ...ctx, item: r }), NOW)),
    ["Hoje", "Ontem", "3 dias atrás"],
  );
});

test("sessão: séries do treino aberto, com nome do exercício pela referência", () => {
  const sessionCtx = { ...ctx, params: { treino: hoje.id } };
  const repeat = node("treino_sessao", "series");
  assert.equal(repeat.type, "repeat");
  if (repeat.type !== "repeat") return;
  const rows = runQuery(repeat.query, sessionCtx);
  assert.equal(rows.length, 3);
  const heading = node("treino_sessao", "serie_exercicio");
  if (heading.type !== "heading") return assert.fail();
  assert.equal(formatResolved(resolveValue(heading.text, { ...sessionCtx, item: rows[2] }), NOW), "Tríceps corda");
});

test("recorde: maior carga do mesmo exercício (inclusive de outros treinos)", () => {
  if (recordeNode.type !== "badge") return assert.fail();
  const text = formatResolved(resolveValue(recordeNode.text, { ...ctx, item: s1 }), NOW);
  assert.equal(text, "Recorde 100 kg");
});

test("formatação em português", () => {
  assert.equal(formatNumber(12400.5), "12.400,5");
  assert.equal(formatNumber(-3), "−3");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(80), "1h 20min");
  assert.equal(formatRelativeDate("2026-09-20", NOW), "2 semanas atrás");
  assert.equal(formatRelativeDate("2026-07-01", NOW), "1 jul");
});

test("tendência sem base anterior fica vazia (não inventa número)", () => {
  const r = resolveValue(
    { kind: "trend", fn: "count", dateField: "data", period: "month", query: { entity: "treino" } },
    { ...ctx, records: new RecordIndex([hoje]) },
  );
  assert.equal(formatResolved(r, NOW), "—");
});
