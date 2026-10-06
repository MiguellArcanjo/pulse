/**
 * Ferramenta de desenvolvimento (passos 3 a 5, antes da IA existir): aplica changesets
 * no servidor pela API, como se fosse um aparelho pareado. Não faz parte do app.
 *
 *   pnpm morph login <url> <código>      pareia este script (o token fica em .data/dev-cli.json)
 *   pnpm morph apply <caso|arquivo.json> [--confirm]
 *   pnpm morph undo [--confirm]           desfaz a última mudança
 *   pnpm morph versions                   lista as versões
 *   pnpm morph code                       gera um código para parear outro aparelho (ex.: o iPhone)
 *   pnpm morph ai "pedido" [--confirm]    faz um pedido à IA e acompanha as etapas
 *   pnpm morph ai-calls                   últimas chamadas à IA (modelo, tokens, custo, erro)
 *
 * Casos prontos: criar-treinos, adicionar-rpe, mostrar-recorde, remover-rpe.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { adicionarRpe, criarTreinos, mostrarRecorde, removerRpe } from "@morph/engine/fixtures";

const FIXTURES: Record<string, unknown> = {
  "criar-treinos": criarTreinos,
  "adicionar-rpe": adicionarRpe,
  "mostrar-recorde": mostrarRecorde,
  "remover-rpe": removerRpe,
};

const STATE_FILE = new URL("../.data/dev-cli.json", import.meta.url);
type State = { url: string; token: string };

const [command, ...args] = process.argv.slice(2);
const confirm = args.includes("--confirm");
const positional = args.filter((a) => !a.startsWith("--"));

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
  } catch {
    throw new Error("Faça login primeiro: pnpm morph login <url> <código>");
  }
}

async function api(state: State, method: string, path: string, body?: unknown) {
  const res = await fetch(state.url + path, {
    method,
    headers: { authorization: `Bearer ${state.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function report(r: { status: number; body: Record<string, unknown> }) {
  if (r.status === 200) {
    const event = r.body["event"] as { summary: string };
    console.log(`✅ Versão ${String(r.body["version"])} (${String(r.body["level"])}): ${event.summary}`);
  } else if (r.status === 409) {
    console.log(`⚠️  Precisa confirmar (${String(r.body["level"])}): ${String(r.body["summary"] ?? "")}`);
    console.log("   Rode de novo com --confirm.");
  } else {
    console.log(`❌ ${r.status} ${String(r.body["error"])}${r.body["stage"] ? ` (etapa: ${String(r.body["stage"])})` : ""}`);
    for (const i of (r.body["issues"] as { path: unknown[]; message: string }[] | undefined) ?? [])
      console.log(`   - ${i.path.join(".")}: ${i.message}`);
    process.exitCode = 1;
  }
}

switch (command) {
  case "login": {
    const [url, code] = positional;
    if (!url || !code) throw new Error("uso: pnpm morph login <url> <código>");
    const base = url.replace(/\/+$/, "");
    const res = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "Script de desenvolvimento" }),
    });
    if (!res.ok) throw new Error(`pareamento recusado (${res.status})`);
    const { token } = (await res.json()) as { token: string };
    await mkdir(fileURLToPath(new URL(".", STATE_FILE)), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify({ url: base, token } satisfies State));
    console.log(`✅ Pareado com ${base}`);
    break;
  }
  case "apply": {
    const [what] = positional;
    if (!what) throw new Error(`uso: pnpm morph apply <${Object.keys(FIXTURES).join("|")}|arquivo.json> [--confirm]`);
    const changeset = FIXTURES[what] ?? JSON.parse(await readFile(what, "utf8"));
    report(await api(await loadState(), "POST", "/v1/changesets", { changeset, confirm }));
    break;
  }
  case "undo": {
    const state = await loadState();
    const spec = await api(state, "GET", "/v1/spec");
    const version = Number(spec.body["version"]);
    if (version === 0) {
      console.log("Nada para desfazer: o app está na versão 0.");
      break;
    }
    report(await api(state, "POST", `/v1/versions/${version - 1}/restore`, confirm ? { confirm: true } : {}));
    break;
  }
  case "versions": {
    const r = await api(await loadState(), "GET", "/v1/versions");
    for (const v of r.body["versions"] as { version: number; level: string; source: string; summary: string }[])
      console.log(`v${v.version}  ${v.source.padEnd(7)} ${v.level.padEnd(11)} ${v.summary}`);
    break;
  }
  case "code": {
    const r = await api(await loadState(), "POST", "/v1/auth/pairing-codes", {});
    if (r.status !== 200) throw new Error(`não foi possível gerar o código (${r.status})`);
    console.log(`Código de pareamento: ${String(r.body["code"])} (vale 15 minutos, uso único)`);
    break;
  }
  case "ai": {
    const state = await loadState();
    const text = positional.join(" ");
    let r = await api(state, "POST", "/v1/ai/requests", { text });
    if (r.status !== 202) throw new Error(`pedido recusado (${r.status} ${String(r.body["error"])})`);
    let last = "";
    for (;;) {
      const stage = `${String(r.body["status"])}/${String(r.body["stage"])}`;
      if (stage !== last) console.log(`… ${stage}${r.body["progressTitle"] ? ` (${String(r.body["progressTitle"])})` : ""}`);
      last = stage;
      if (r.body["status"] !== "running") break;
      await new Promise((res) => setTimeout(res, 700));
      r = await api(state, "GET", `/v1/ai/jobs/${String(r.body["id"])}`);
    }
    if (r.body["status"] === "needs_confirmation") {
      const p = r.body["proposal"] as { summary: string; level: string };
      console.log(`⚠️  Proposta (${p.level}): ${p.summary}`);
      if (confirm) r = await api(state, "POST", `/v1/ai/jobs/${String(r.body["id"])}/confirm`, { confirm: true });
      else console.log("   Rode de novo com --confirm para aplicar.");
    }
    console.log(JSON.stringify({ status: r.body["status"], result: r.body["result"], reply: r.body["reply"], error: r.body["error"] }, null, 2));
    break;
  }
  case "ai-calls": {
    const r = await api(await loadState(), "GET", "/v1/ai/calls");
    for (const c of r.body["calls"] as Record<string, unknown>[])
      console.log(
        `${String(c["role"]).padEnd(10)} ${String(c["model"]).padEnd(14)} t${String(c["attempt"])} ${String(c["latency_ms"]).padStart(6)}ms ` +
          `in=${String(c["input_tokens"])} (cache ${String(c["cached_tokens"])}) out=${String(c["output_tokens"])} ` +
          `US$ ${String(c["cost"] ?? "?")} ${c["success"] ? "ok" : "FALHOU"} ${String(c["validation"] ?? "")} ${String(c["error"] ?? "")}`,
      );
    break;
  }
  default:
    console.log("comandos: login, apply, undo, versions, code, ai, ai-calls (veja o topo de apps/server/scripts/dev-cli.ts)");
}
