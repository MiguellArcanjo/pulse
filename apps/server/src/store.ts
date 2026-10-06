import { randomUUID } from "node:crypto";
import { AppSpec, emptySpec, type Changeset, type PermissionLevel } from "@morph/protocol";
import type { Queryable } from "./db/db.ts";

/**
 * Versões da spec e linha do tempo do Evolution. Uma versão e seu evento são sempre
 * gravados juntos, na mesma transação.
 */

export type VersionSource = "system" | "dev" | "ai" | "restore";
export type EvolutionKind = "app_started" | "tool_created" | "tool_modified" | "reorganized" | "archived" | "restored";

const KIND_BY_INTENT: Record<Changeset["intent"], EvolutionKind> = {
  create_tool: "tool_created",
  modify_tool: "tool_modified",
  reorganize: "reorganized",
  archive: "archived",
};

export function evolutionKind(changeset: Changeset): EvolutionKind {
  return KIND_BY_INTENT[changeset.intent];
}

/**
 * Devolve o usuário do servidor, criando-o (com o app vazio, versão 0) se ainda não
 * existir. MVP: um único usuário por servidor.
 */
export async function ensureUser(tx: Queryable): Promise<string> {
  const existing = await tx.query<{ id: string }>("SELECT id FROM users ORDER BY created_at LIMIT 1");
  if (existing[0]) return existing[0].id;
  const userId = randomUUID();
  await tx.query("INSERT INTO users (id) VALUES ($1)", [userId]);
  await saveVersion(tx, userId, {
    spec: emptySpec(),
    changeset: null,
    source: "system",
    level: "READ",
    event: { kind: "app_started", summary: "Aplicativo iniciado", target: null },
  });
  return userId;
}

/** Trava o usuário até o fim da transação: duas mudanças ao mesmo tempo nunca se misturam. */
export async function lockUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
}

export async function latestSpec(db: Queryable, userId: string): Promise<AppSpec> {
  const rows = await db.query<{ spec: unknown }>(
    "SELECT spec FROM app_versions WHERE user_id = $1 ORDER BY version DESC LIMIT 1",
    [userId],
  );
  if (!rows[0]) throw new Error("usuário sem versão inicial");
  // O que está no banco passou pela validação ao ser gravado; o parse protege contra
  // mudanças manuais no banco e devolve o tipo certo.
  return AppSpec.parse(rows[0].spec);
}

export async function specAt(db: Queryable, userId: string, version: number): Promise<AppSpec | null> {
  const rows = await db.query<{ spec: unknown }>("SELECT spec FROM app_versions WHERE user_id = $1 AND version = $2", [
    userId,
    version,
  ]);
  return rows[0] ? AppSpec.parse(rows[0].spec) : null;
}

export type NewVersion = {
  spec: AppSpec;
  changeset: Changeset | null;
  source: VersionSource;
  level: PermissionLevel;
  restoredFrom?: number;
  event: { kind: EvolutionKind; summary: string; target: string | null };
};

export async function saveVersion(tx: Queryable, userId: string, v: NewVersion): Promise<EvolutionEvent> {
  await tx.query(
    `INSERT INTO app_versions (user_id, version, spec, changeset, source, level, restored_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, v.spec.version, JSON.stringify(v.spec), v.changeset ? JSON.stringify(v.changeset) : null, v.source, v.level, v.restoredFrom ?? null],
  );
  const event: EvolutionEvent = {
    id: randomUUID(),
    version: v.spec.version,
    kind: v.event.kind,
    summary: v.event.summary,
    target: v.event.target,
    createdAt: new Date().toISOString(),
  };
  await tx.query(
    `INSERT INTO evolution_events (id, user_id, version, kind, summary, target, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [event.id, userId, event.version, event.kind, event.summary, event.target, event.createdAt],
  );
  return event;
}

export type EvolutionEvent = {
  id: string;
  version: number;
  kind: EvolutionKind;
  summary: string;
  target: string | null;
  createdAt: string;
};

export async function listEvolution(db: Queryable, userId: string, limit = 100): Promise<EvolutionEvent[]> {
  const rows = await db.query<{ id: string; version: number; kind: EvolutionKind; summary: string; target: string | null; created_at: Date | string }>(
    `SELECT id, version, kind, summary, target, created_at FROM evolution_events
      WHERE user_id = $1 ORDER BY created_at DESC, version DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    kind: r.kind,
    summary: r.summary,
    target: r.target,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export type VersionInfo = { version: number; source: VersionSource; level: PermissionLevel; summary: string; createdAt: string };

export async function listVersions(db: Queryable, userId: string, limit = 100): Promise<VersionInfo[]> {
  const rows = await db.query<{ version: number; source: VersionSource; level: PermissionLevel; summary: string; created_at: Date | string }>(
    `SELECT v.version, v.source, v.level, e.summary, v.created_at
       FROM app_versions v JOIN evolution_events e ON e.user_id = v.user_id AND e.version = v.version
      WHERE v.user_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    version: r.version,
    source: r.source,
    level: r.level,
    summary: r.summary,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
