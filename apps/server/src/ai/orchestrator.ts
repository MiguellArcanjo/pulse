import { randomUUID } from "node:crypto";
import {
  BUILDER_SYSTEM,
  BUILDER_VERSION,
  buildContext,
  builderInput,
  chooseTier,
  Classification,
  CLASSIFIER_SYSTEM,
  CLASSIFIER_VERSION,
  classifierInput,
  estimateCost,
  fromStrict,
  toStrictSchema,
  type AIConfig,
  type AIProvider,
  type StructuredResult,
} from "@morph/ai";
import { applyChangeset, type Issue } from "@morph/engine";
import { Changeset, type PermissionLevel } from "@morph/protocol";
import { commitChangeset } from "../changes.ts";
import type { Db } from "../db/db.ts";
import { latestSpec } from "../store.ts";

/**
 * AI Orchestrator: UNDERSTAND → PLAN → VALIDATE → (PREVIEW) → EXECUTE → RECORD.
 * A IA só propõe; o engine valida; mudanças sensíveis esperam confirmação; tudo é
 * gravado pelo mesmo caminho do resto do app (commitChangeset) e vira evento no Evolution.
 *
 * Cada pedido vira um "job" em memória que o app acompanha (etapas reais do processo).
 */

export type Stage = "understanding" | "choosing" | "data" | "interface" | "finishing";

export type Job = {
  id: string;
  userId: string;
  text: string;
  status: "running" | "done" | "needs_confirmation" | "declined" | "not_supported" | "failed";
  stage: Stage;
  /** Tipo de pedido, depois de entendido (create_tool, modify_tool...). */
  intent: string | null;
  progressTitle: string | null;
  /** Resposta ao usuário quando o pedido não é suportado. */
  reply: string | null;
  error: string | null;
  /** Proposta aguardando confirmação (nível CONFIRM). */
  proposal: { summary: string; level: PermissionLevel; changeset: Changeset } | null;
  result: { version: number; summary: string; target: string | null; home: string | null } | null;
  createdAt: number;
};

/** Mudar vira tentativa extra (com o erro do validador) no máximo uma vez. */
const MAX_ATTEMPTS = 2;
/** Proteção dos créditos: pedidos por usuário por hora. */
const MAX_REQUESTS_PER_HOUR = 30;
const JOB_TTL_MS = 30 * 60_000;

const CHANGESET_SCHEMA = toStrictSchema(Changeset);
const CLASSIFICATION_SCHEMA = toStrictSchema(Classification);

export class AiOrchestrator {
  private readonly jobs = new Map<string, Job>();
  private readonly recent = new Map<string, number[]>();
  private readonly db: Db;
  private readonly provider: AIProvider;
  private readonly config: AIConfig;

  constructor(db: Db, provider: AIProvider, config: AIConfig) {
    this.db = db;
    this.provider = provider;
    this.config = config;
  }

  get(userId: string, id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job && job.userId === userId ? job : undefined;
  }

  /** Começa um pedido. Devolve o job ou o motivo de recusa. */
  start(userId: string, text: string): { ok: true; job: Job } | { ok: false; reason: "busy" | "rate_limited" } {
    this.cleanup();
    if ([...this.jobs.values()].some((j) => j.userId === userId && j.status === "running")) return { ok: false, reason: "busy" };
    const now = Date.now();
    const times = (this.recent.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= MAX_REQUESTS_PER_HOUR) return { ok: false, reason: "rate_limited" };
    this.recent.set(userId, [...times, now]);

    const job: Job = {
      id: randomUUID(),
      userId,
      text,
      status: "running",
      stage: "understanding",
      intent: null,
      progressTitle: null,
      reply: null,
      error: null,
      proposal: null,
      result: null,
      createdAt: now,
    };
    this.jobs.set(job.id, job);
    void this.run(job).catch((err: unknown) => {
      job.status = "failed";
      job.error = "Algo deu errado ao criar. Nada foi mudado.";
      console.error("[ai] job falhou", err instanceof Error ? err.message : err);
    });
    return { ok: true, job };
  }

  /** Usuário confirmou a proposta (nível CONFIRM). */
  async confirm(job: Job): Promise<void> {
    if (job.status !== "needs_confirmation" || !job.proposal) return;
    job.status = "running";
    job.stage = "finishing";
    await this.commit(job, job.proposal.changeset, true);
  }

  decline(job: Job): void {
    if (job.status === "needs_confirmation") {
      job.status = "declined";
      job.proposal = null;
    }
  }

  // -------------------------------------------------------------------------

  private async run(job: Job): Promise<void> {
    const spec = await latestSpec(this.db, job.userId);

    // 1. UNDERSTAND (modelo rápido)
    const tools = spec.tools.filter((t) => t.status === "active").map((t) => ({ id: t.id, name: t.name, description: t.description }));
    const cls = await this.call(job, {
      role: "classifier",
      version: CLASSIFIER_VERSION,
      model: this.config.models.fast,
      attempt: 0,
      system: CLASSIFIER_SYSTEM,
      input: classifierInput(job.text, tools),
      schema: CLASSIFICATION_SCHEMA,
      categories: ["nomes das ferramentas"],
    });
    if (!cls.ok) return this.fail(job, cls);
    const parsed = Classification.safeParse(fromStrict(cls.json, CLASSIFICATION_SCHEMA.original));
    if (!parsed.success) return this.fail(job, { ok: false, reason: "invalid_json", message: "classificação inválida", latencyMs: 0 });
    const c = parsed.data;
    job.progressTitle = c.progressTitle;
    job.intent = c.intent;
    if (c.intent === "not_supported") {
      job.status = "not_supported";
      job.reply = c.reply ?? "Isso o Morph ainda não sabe fazer.";
      return;
    }

    // 2. PLAN + 3. VALIDATE (com uma nova tentativa, subindo de modelo)
    const target = c.target && spec.tools.some((t) => t.id === c.target) ? c.target : null;
    const ctx = buildContext(spec, c.intent, target);
    let issues: Issue[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      job.stage = "choosing";
      const tier = chooseTier(c, attempt);
      const res = await this.call(job, {
        role: "builder",
        version: BUILDER_VERSION,
        model: this.config.models[tier],
        attempt,
        system: BUILDER_SYSTEM,
        input: builderInput({ request: job.text, intent: c.intent, context: ctx.text, previousIssues: issues.length ? describe(issues) : undefined }),
        schema: CHANGESET_SCHEMA,
        categories: ctx.categories,
        onPartial: (t) => {
          // Etapas reais: o que a IA está escrevendo agora.
          if (/"type":\s*"(CREATE_SCREEN|ADD_COMPONENT|UPDATE_COMPONENT|MOVE_COMPONENT)"/.test(t)) job.stage = "interface";
          else if (/"type":\s*"(CREATE_ENTITY|ADD_FIELD|UPDATE_FIELD|ARCHIVE_FIELD)"/.test(t)) job.stage = "data";
        },
        validate: (json) => {
          const candidate = fromStrict(json, CHANGESET_SCHEMA.original);
          const dry = applyChangeset(spec, candidate);
          return dry.ok ? { stage: "ok", issues: [] } : { stage: dry.stage, issues: dry.issues };
        },
      });
      if (!res.ok) return this.fail(job, res);

      const candidate = fromStrict(res.json, CHANGESET_SCHEMA.original);
      const dry = applyChangeset(spec, candidate);
      if (!dry.ok) {
        issues = dry.issues;
        continue;
      }

      // 4. PREVIEW: mudança sensível espera o usuário.
      if (dry.level === "CONFIRM" || dry.level === "CRITICAL") {
        job.status = "needs_confirmation";
        job.proposal = { summary: dry.changeset.summary, level: dry.level, changeset: dry.changeset };
        return;
      }
      // 5. EXECUTE + 6. RECORD
      job.stage = "finishing";
      return this.commit(job, dry.changeset, false);
    }
    job.status = "failed";
    job.error = "Não consegui montar uma mudança válida para esse pedido. Nada foi mudado. Tente explicar de outro jeito.";
  }

  private async commit(job: Job, changeset: Changeset, confirm: boolean): Promise<void> {
    const r = await commitChangeset(this.db, job.userId, changeset, { confirm, source: "ai" });
    if (!r.ok) {
      job.status = "failed";
      job.error = "A mudança não pôde ser aplicada (o app mudou nesse meio-tempo?). Nada foi mudado.";
      return;
    }
    const tool = changeset.target ? r.spec.tools.find((t) => t.id === changeset.target) : undefined;
    job.result = { version: r.spec.version, summary: changeset.summary, target: tool?.id ?? null, home: tool?.home ?? null };
    job.status = "done";
  }

  private fail(job: Job, res: Extract<StructuredResult, { ok: false }>): void {
    job.status = "failed";
    job.error =
      res.reason === "unavailable"
        ? "A IA está indisponível agora. Seu app continua funcionando; tente de novo em instantes."
        : res.reason === "refusal"
          ? "A IA recusou esse pedido."
          : "A IA não conseguiu responder. Nada foi mudado.";
  }

  /** Uma chamada ao fornecedor, sempre registrada em ai_calls. */
  private async call(
    job: Job,
    a: {
      role: "classifier" | "builder";
      version: string;
      model: string;
      attempt: number;
      system: string;
      input: string;
      schema: { schema: Record<string, unknown> };
      categories: string[];
      onPartial?: (t: string) => void;
      validate?: (json: unknown) => { stage: string; issues: Issue[] };
    },
  ): Promise<StructuredResult> {
    const res = await this.provider.generateStructured({
      model: a.model,
      system: a.system,
      input: a.input,
      schemaName: a.role === "builder" ? "morph_changeset" : "morph_classification",
      jsonSchema: a.schema.schema,
      ...(a.onPartial ? { onPartial: a.onPartial } : {}),
    });
    const validation = res.ok && a.validate ? a.validate(res.json).stage : null;
    const usage = res.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 };
    await this.db.query(
      `INSERT INTO ai_calls (id, user_id, request_id, provider, model, role, prompt_version, attempt, latency_ms,
         input_tokens, cached_tokens, output_tokens, reasoning_tokens, estimated_cost_usd, success, validation, error, context_categories)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        job.userId,
        job.id,
        this.provider.name,
        a.model,
        a.role,
        a.version,
        a.attempt,
        res.latencyMs,
        usage.inputTokens,
        usage.cachedTokens,
        usage.outputTokens,
        usage.reasoningTokens,
        estimateCost(usage, this.config.prices[a.model]),
        res.ok && (validation === null || validation === "ok"),
        validation,
        res.ok ? null : `${res.reason}: ${res.message}`.slice(0, 300),
        a.categories,
      ],
    );
    return res;
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (now - j.createdAt > JOB_TTL_MS) this.jobs.delete(id);
  }
}

/** Problemas do validador em texto curto, para a IA corrigir. */
function describe(issues: Issue[]): string {
  return issues
    .slice(0, 15)
    .map((i) => `- ${i.path.join(".")}: ${i.message}`)
    .join("\n");
}

/** Visão do job para o app (sem a proposta crua). */
export function publicJob(j: Job) {
  return {
    id: j.id,
    status: j.status,
    stage: j.stage,
    intent: j.intent,
    progressTitle: j.progressTitle,
    reply: j.reply,
    error: j.error,
    proposal: j.proposal ? { summary: j.proposal.summary, level: j.proposal.level } : null,
    result: j.result,
  };
}
