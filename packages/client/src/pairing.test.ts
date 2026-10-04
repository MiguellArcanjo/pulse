import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlDecode, b64urlEncode } from "./base64.ts";
import { claimProof, pairingCode, parsePairingQr, pollProof } from "./pairing.ts";

// Mesmo vetor de crates/pulse-core/src/pairing.rs (cross_language_vector),
// calculado de forma independente em Python.
const SECRET = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const qr = {
  version: 1,
  coreUrl: "https://pc.tail1.ts.net",
  pairingId: "pair123",
  secret: SECRET,
  expiresAtMs: 1,
};

test("HMAC e código batem com o Core", () => {
  assert.equal(claimProof(qr, "nonce456"), "7IUHhCThhuxcDlTCw5ElNs3CSyuiAQTzK15SyQYRGV0");
  assert.equal(pollProof(qr, "nonce456"), "vqBpdmAP8XmtT6RA7gj9XzUtech47QjpSO630GE-aDw");
  assert.equal(pairingCode(qr, "nonce456"), "655521");
});

test("base64url ida e volta em todos os tamanhos", () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
    assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
  }
  assert.equal(b64urlEncode(Uint8Array.from({ length: 32 }, (_, i) => i + 1)), SECRET);
  assert.equal(b64urlDecode("@@@"), null);
});

test("lê o QR gerado pelo Core", () => {
  const uri = `pulse://pair?v=1&u=https%3A%2F%2Fpc.tail1.ts.net&p=pair123&s=${SECRET}&e=1700000000000`;
  const parsed = parsePairingQr(uri);
  assert.deepEqual(parsed, { ...qr, expiresAtMs: 1700000000000 });
});

test("recusa QRs que não são do Pulse ou estão incompletos", () => {
  assert.equal(parsePairingQr("https://evil.example/pair?v=1"), null);
  assert.equal(parsePairingQr(`pulse://pair?v=1&u=http%3A%2F%2Fpc&p=a&s=${SECRET}&e=1`), null, "exige https");
  assert.equal(parsePairingQr("pulse://pair?v=1&u=https%3A%2F%2Fpc&p=a&s=curto&e=1"), null);
  assert.equal(parsePairingQr(`pulse://pair?v=2&u=https%3A%2F%2Fpc&p=a&s=${SECRET}&e=1`), null);
});
