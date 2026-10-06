import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import * as z from "zod";
import { authenticate, createPairingCode, pairDevice, PairingThrottle, type Session } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { createRecord, deleteRecord, listChanges, updateRecord } from "./records.ts";
import { publicJob, type AiOrchestrator } from "./ai/orchestrator.ts";
import { commitChangeset, restoreTo, type ChangeResult } from "./changes.ts";
import { latestSpec, listEvolution, listVersions } from "./store.ts";

/**
 * API do app (v1). Tudo exige token, menos /v1/health e /v1/auth/pair.
 * Nunca registra corpo de requisição nem o cabeçalho Authorization no log.
 */

declare module "fastify" {
  interface FastifyRequest {
    session: Session;
  }
}

export type AppOptions = { db: Db; logger?: boolean; ai?: AiOrchestrator | null };

const PairBody = z.object({ code: z.string().min(4).max(40), deviceName: z.string().trim().min(1).max(60) }).strict();
const ChangesetBody = z.object({ changeset: z.unknown(), confirm: z.boolean().optional() }).strict();
const RecordCreateBody = z.object({ entity: z.string().min(1).max(48), data: z.unknown() }).strict();
const RecordUpdateBody = z.object({ data: z.unknown() }).strict();
const ConfirmBody = z.object({ confirm: z.literal(true) }).strict();
const AiRequestBody = z.object({ text: z.string().trim().min(2).max(500) }).strict();
const ChangesQuery = z.object({
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const VersionParam = z.object({ version: z.coerce.number().int().min(0) });
const IdParam = z.object({ id: z.uuid() });

function sendChange(reply: FastifyReply, r: ChangeResult) {
  if (r.ok) return { version: r.spec.version, spec: r.spec, level: r.level, event: r.event };
  switch (r.reason) {
    case "invalid":
      return reply.code(422).send({ error: "invalid_changeset", stage: r.stage, issues: r.issues });
    case "confirmation_required":
      return reply.code(409).send({ error: "confirmation_required", level: r.level, summary: r.summary });
    case "not_found":
      return reply.code(404).send({ error: "version_not_found" });
  }
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "bad_request", issues: error.issues.map((i) => ({ path: i.path.map(String), message: i.message })) });
}

export function buildApp({ db, logger = false, ai = null }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: logger ? { redact: ["req.headers.authorization"] } : false,
    // Na Heroku o tráfego chega pelo roteador dela (proxy).
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });
  const throttle = new PairingThrottle();

  app.get("/v1/health", async () => ({ ok: true }));

  app.post("/v1/auth/pair", async (req, reply) => {
    if (throttle.blocked()) return reply.code(429).send({ error: "too_many_attempts" });
    const body = PairBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    const result = await pairDevice(db, body.data.code, body.data.deviceName);
    if (!result) {
      throttle.fail();
      return reply.code(401).send({ error: "invalid_code" });
    }
    return result;
  });

  // ---------------- rotas autenticadas ----------------
  app.register(async (api) => {
    api.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const session = token ? await authenticate(db, token) : null;
      if (!session) return reply.code(401).send({ error: "unauthorized" });
      req.session = session;
    });

    /** Um aparelho já pareado gera código para parear outro (ex.: o script de dev ou um iPhone novo). */
    api.post("/v1/auth/pairing-codes", async () => {
      const { code, expiresAt } = await createPairingCode(db);
      return { code, expiresAt: expiresAt.toISOString() };
    });

    api.get("/v1/spec", async (req) => {
      const spec = await latestSpec(db, req.session.userId);
      return { version: spec.version, spec };
    });

    /**
     * Aplica um changeset. No MVP só vem do script de desenvolvimento (source "dev");
     * no passo 6, a IA usa o mesmo caminho por dentro do servidor.
     * Mudanças de nível CONFIRM exigem `confirm: true`.
     */
    api.post("/v1/changesets", async (req, reply) => {
      const body = ChangesetBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, body.error);
      const r = await commitChangeset(db, req.session.userId, body.data.changeset, { confirm: body.data.confirm === true, source: "dev" });
      return sendChange(reply, r);
    });

    api.get("/v1/versions", async (req) => ({ versions: await listVersions(db, req.session.userId) }));

    /** Desfazer: volta ao conteúdo de uma versão anterior (gerando uma versão nova). */
    api.post("/v1/versions/:version/restore", async (req, reply) => {
      const params = VersionParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      const confirm = ConfirmBody.safeParse(req.body).success;
      return sendChange(reply, await restoreTo(db, req.session.userId, params.data.version, { confirm }));
    });

    api.get("/v1/evolution", async (req) => {
      const { userId } = req.session;
      const spec = await latestSpec(db, userId);
      return {
        events: await listEvolution(db, userId),
        counts: {
          tools: spec.tools.filter((t) => t.status === "active").length,
          automations: spec.automations.length,
          integrations: spec.skills.length,
        },
      };
    });

    // ---------------- IA (passo 6) ----------------
    // Sem configuração de IA, estas rotas respondem 503 e o resto do app segue normal.

    api.post("/v1/ai/requests", async (req, reply) => {
      if (!ai) return reply.code(503).send({ error: "ai_unavailable" });
      const body = AiRequestBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, body.error);
      const r = ai.start(req.session.userId, body.data.text);
      if (!r.ok) return reply.code(r.reason === "busy" ? 409 : 429).send({ error: r.reason });
      return reply.code(202).send(publicJob(r.job));
    });

    api.get("/v1/ai/jobs/:id", async (req, reply) => {
      const params = IdParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      const job = ai?.get(req.session.userId, params.data.id);
      if (!job) return reply.code(404).send({ error: "not_found" });
      return publicJob(job);
    });

    /** Proposta de nível CONFIRM: o usuário aplica ou recusa. */
    api.post("/v1/ai/jobs/:id/confirm", async (req, reply) => {
      const params = IdParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      if (!ConfirmBody.safeParse(req.body).success) return reply.code(409).send({ error: "confirmation_required" });
      const job = ai?.get(req.session.userId, params.data.id);
      if (!job || !ai) return reply.code(404).send({ error: "not_found" });
      await ai.confirm(job);
      return publicJob(job);
    });

    api.post("/v1/ai/jobs/:id/decline", async (req, reply) => {
      const params = IdParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      const job = ai?.get(req.session.userId, params.data.id);
      if (!job || !ai) return reply.code(404).send({ error: "not_found" });
      ai.decline(job);
      return publicJob(job);
    });

    /** Últimas chamadas à IA: só metadados técnicos (modelo, tokens, custo, validação, erro). */
    api.get("/v1/ai/calls", async (req) => {
      const rows = await db.query(
        `SELECT created_at, role, prompt_version, model, attempt, latency_ms, input_tokens, cached_tokens,
                output_tokens, reasoning_tokens, estimated_cost_usd::text AS cost, success, validation, error
           FROM ai_calls WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [req.session.userId],
      );
      return { calls: rows };
    });

    /** Custo da IA no mês (a partir de ai_calls). */
    api.get("/v1/ai/usage", async (req) => {
      const rows = await db.query<{ calls: number; cost: string | null; unknown: number }>(
        `SELECT count(*)::int AS calls, sum(estimated_cost_usd)::text AS cost,
                count(*) FILTER (WHERE estimated_cost_usd IS NULL)::int AS unknown
           FROM ai_calls WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
        [req.session.userId],
      );
      const r = rows[0];
      return { enabled: ai !== null, calls: r?.calls ?? 0, costUsd: r?.cost ? Number(r.cost) : 0, callsWithoutPrice: r?.unknown ?? 0 };
    });

    // ---------------- registros ----------------

    api.get("/v1/records", async (req, reply) => {
      const q = ChangesQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply, q.error);
      return listChanges(db, req.session.userId, q.data.cursor ?? null, q.data.limit);
    });

    api.post("/v1/records", async (req, reply) => {
      const body = RecordCreateBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, body.error);
      const { userId } = req.session;
      const spec = await latestSpec(db, userId);
      const r = await createRecord(db, userId, spec, body.data.entity, body.data.data);
      if (!r.ok) return reply.code(r.status).send({ error: "invalid_record", issues: r.issues });
      return reply.code(201).send(r.record);
    });

    api.patch("/v1/records/:id", async (req, reply) => {
      const params = IdParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = RecordUpdateBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, body.error);
      const { userId } = req.session;
      const spec = await latestSpec(db, userId);
      const r = await updateRecord(db, userId, spec, params.data.id, body.data.data);
      if (!r.ok) return reply.code(r.status).send({ error: r.status === 404 ? "not_found" : "invalid_record", issues: r.issues });
      return r.record;
    });

    /** Apagar um registro é CONFIRM: o app pergunta antes e manda `confirm: true`. */
    api.delete("/v1/records/:id", async (req, reply) => {
      const params = IdParam.safeParse(req.params);
      if (!params.success) return badRequest(reply, params.error);
      if (!ConfirmBody.safeParse(req.body).success) return reply.code(409).send({ error: "confirmation_required", level: "CONFIRM" });
      const ok = await deleteRecord(db, req.session.userId, params.data.id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    });
  });

  return app;
}
