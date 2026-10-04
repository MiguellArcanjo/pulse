// Lado do iPhone do pareamento (ver crates/pulse-protocol/src/remote.rs).
// As mensagens HMAC precisam ser idênticas às do Core, byte a byte.

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { PairingQr } from "@pulse/protocol";
import { b64urlDecode, b64urlEncode } from "./base64.ts";

export const PAIRING_DOMAIN = "pulse-pair-v1";

/** Lê `pulse://pair?v=1&u=…&p=…&s=…&e=…`. Retorna `null` se não for um QR do Pulse. */
export function parsePairingQr(uri: string): PairingQr | null {
  const m = /^pulse:\/\/pair\/?\?(.*)$/i.exec(uri.trim());
  if (!m) return null;
  const params = new Map<string, string>();
  for (const part of m[1].split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
    } catch {
      return null;
    }
  }
  return fromParams((k) => params.get(k));
}

/** Mesmos campos, vindos de parâmetros de rota (deep link aberto pela câmera do iPhone). */
export function pairingFromParams(get: (key: string) => string | undefined): PairingQr | null {
  return fromParams(get);
}

function fromParams(get: (key: string) => string | undefined): PairingQr | null {
  const version = Number(get("v"));
  const coreUrl = get("u") ?? "";
  const pairingId = get("p") ?? "";
  const secret = get("s") ?? "";
  const expiresAtMs = Number(get("e"));
  if (version !== 1 || !/^https:\/\//i.test(coreUrl) || !pairingId || !secret || !expiresAtMs) {
    return null;
  }
  const decoded = b64urlDecode(secret);
  if (!decoded || decoded.length !== 32) return null;
  return { version, coreUrl: coreUrl.replace(/\/+$/, ""), pairingId, secret, expiresAtMs };
}

function mac(secret: string, label: string, pairingId: string, nonce: string): Uint8Array {
  const key = b64urlDecode(secret);
  if (!key) throw new Error("segredo de pareamento inválido");
  return hmac(sha256, key, utf8ToBytes(`${PAIRING_DOMAIN}|${label}|${pairingId}|${nonce}`));
}

export function claimProof(qr: PairingQr, nonce: string): string {
  return b64urlEncode(mac(qr.secret, "claim", qr.pairingId, nonce));
}

export function pollProof(qr: PairingQr, nonce: string): string {
  return b64urlEncode(mac(qr.secret, "poll", qr.pairingId, nonce));
}

/** Código de 6 dígitos que o PC também mostra. */
export function pairingCode(qr: PairingQr, nonce: string): string {
  const m = mac(qr.secret, "sas", qr.pairingId, nonce);
  const n = ((m[0] << 24) | (m[1] << 16) | (m[2] << 8) | m[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

export function newNonce(randomBytes: (n: number) => Uint8Array): string {
  return b64urlEncode(randomBytes(32));
}
