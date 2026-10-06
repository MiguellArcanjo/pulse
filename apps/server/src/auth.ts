import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Db, Queryable } from "./db/db.ts";
import { ensureUser } from "./store.ts";

/**
 * Acesso do iPhone ao servidor.
 * 1. Um código de pareamento de uso único é gerado no servidor (script `pnpm pair` ou
 *    log da primeira inicialização) e digitado no app.
 * 2. O app troca o código por um token, que fica só no SecureStore do iPhone.
 * Código e token são guardados apenas como hash SHA-256.
 */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // sem 0/O, 1/I/L, U
const CODE_LENGTH = 10;
const CODE_TTL_MINUTES = 15;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Remove espaços e traços e põe em maiúsculas (o usuário pode digitar "abcde-fghjk"). */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export async function createPairingCode(db: Queryable): Promise<{ code: string; expiresAt: Date }> {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await db.query("INSERT INTO pairing_codes (code_hash, expires_at) VALUES ($1, $2)", [hashSecret(code), expiresAt]);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
}

export type Session = { userId: string; deviceId: string };

/** Troca um código válido por um token. Devolve `null` se o código não serve. */
export async function pairDevice(db: Db, code: string, deviceName: string): Promise<{ token: string; deviceId: string } | null> {
  return db.transaction(async (tx) => {
    const used = await tx.query(
      `UPDATE pairing_codes SET used_at = now()
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING code_hash`,
      [hashSecret(normalizeCode(code))],
    );
    if (used.length === 0) return null;

    const userId = await ensureUser(tx);
    const token = randomBytes(32).toString("base64url");
    const deviceId = randomUUID();
    await tx.query("INSERT INTO devices (id, user_id, name, token_hash) VALUES ($1, $2, $3, $4)", [
      deviceId,
      userId,
      deviceName,
      hashSecret(token),
    ]);
    return { token, deviceId };
  });
}

export async function authenticate(db: Queryable, token: string): Promise<Session | null> {
  const rows = await db.query<{ id: string; user_id: string }>(
    `UPDATE devices SET last_seen_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id, user_id`,
    [hashSecret(token)],
  );
  const row = rows[0];
  return row ? { userId: row.user_id, deviceId: row.id } : null;
}

/**
 * Freio simples para tentativas de pareamento: depois de muitas falhas seguidas, recusa
 * qualquer tentativa por um tempo. Não depende de IP (que pode ser forjado atrás de proxy).
 */
export class PairingThrottle {
  private failures: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = 20, windowMs = 15 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(now = Date.now()): boolean {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    return this.failures.length >= this.max;
  }

  fail(now = Date.now()) {
    this.failures.push(now);
  }
}
