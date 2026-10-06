import { applyChangeset, restoreVersion, type Issue } from "@morph/engine";
import type { AppSpec, PermissionLevel } from "@morph/protocol";
import type { Db } from "./db/db.ts";
import { evolutionKind, latestSpec, listVersions, lockUser, saveVersion, specAt, type EvolutionEvent, type VersionSource } from "./store.ts";

/**
 * O único caminho para mudar o app de um usuário: aplica o changeset com o engine
 * (schema → operações → semântica), exige confirmação quando o nível pede, e grava
 * versão + evento do Evolution na mesma transação. Usado pela API, pelo script de
 * desenvolvimento e, no passo 6, pela IA.
 */

export type ChangeResult =
  | { ok: true; spec: AppSpec; level: PermissionLevel; event: EvolutionEvent }
  | { ok: false; reason: "invalid"; stage: string; issues: Issue[] }
  | { ok: false; reason: "confirmation_required"; level: PermissionLevel; summary: string }
  | { ok: false; reason: "not_found" };

export async function commitChangeset(
  db: Db,
  userId: string,
  input: unknown,
  opts: { confirm: boolean; source: Exclude<VersionSource, "system" | "restore"> },
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const current = await latestSpec(tx, userId);
    const result = applyChangeset(current, input);
    if (!result.ok) return { ok: false, reason: "invalid", stage: result.stage, issues: result.issues };
    if ((result.level === "CONFIRM" || result.level === "CRITICAL") && !opts.confirm)
      return { ok: false, reason: "confirmation_required", level: result.level, summary: result.changeset.summary };

    const event = await saveVersion(tx, userId, {
      spec: result.spec,
      changeset: result.changeset,
      source: opts.source,
      level: result.level,
      event: { kind: evolutionKind(result.changeset), summary: result.changeset.summary, target: result.changeset.target },
    });
    return { ok: true, spec: result.spec, level: result.level, event };
  });
}

/** Desfazer: volta ao conteúdo de uma versão anterior, gerando uma versão nova. Sempre CONFIRM. */
export async function restoreTo(db: Db, userId: string, version: number, opts: { confirm: boolean }): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const current = await latestSpec(tx, userId);
    const target = await specAt(tx, userId, version);
    if (!target || target.version >= current.version) return { ok: false, reason: "not_found" };

    const undone = (await listVersions(tx, userId, current.version - target.version)).map((v) => v.summary);
    const summary = (
      undone.length === 1 ? `Desfeito: ${undone[0]}` : `Voltou para a versão ${target.version} (${undone.length} mudanças desfeitas)`
    ).slice(0, 280);
    if (!opts.confirm) return { ok: false, reason: "confirmation_required", level: "CONFIRM", summary };

    const restored = restoreVersion(current, target);
    if (!restored.ok) return { ok: false, reason: "invalid", stage: "semantic", issues: restored.issues };

    const event = await saveVersion(tx, userId, {
      spec: restored.spec,
      changeset: null,
      source: "restore",
      level: "CONFIRM",
      restoredFrom: target.version,
      event: { kind: "restored", summary, target: null },
    });
    return { ok: true, spec: restored.spec, level: "CONFIRM", event };
  });
}
