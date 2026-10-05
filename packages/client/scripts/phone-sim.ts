// Simula um iPhone pareando com o Pulse, para testar o Desktop sem o celular.
//
//   pnpm --filter @pulse/client phone-sim "pulse://pair?v=1&..."
//
// Lê o conteúdo do QR, pede acesso, mostra o código de conferência e espera
// a aprovação no Desktop. Aprovado, mantém o stream aberto por 30 s (o Desktop
// mostra o dispositivo como "Conectado") e sai sem revogar.

import { webcrypto } from "node:crypto";
import {
  claimPairing,
  claimProof,
  newNonce,
  pairingCode,
  parsePairingQr,
  pollPairing,
  pollProof,
  PulseClient,
  PulseStream,
} from "../src/index.ts";
import type { TokenPair } from "@pulse/protocol";

const qr = parsePairingQr(process.argv[2] ?? "");
if (!qr) {
  console.error("Uso: phone-sim \"pulse://pair?...\" (conteúdo do QR)");
  process.exit(1);
}
const coreUrl = process.env.PULSE_E2E_URL ?? qr.coreUrl;
const nonce = newNonce((n) => webcrypto.getRandomValues(new Uint8Array(n)));

await claimPairing(coreUrl, {
  pairingId: qr.pairingId,
  deviceNonce: nonce,
  proof: claimProof(qr, nonce),
  deviceName: process.env.PULSE_SIM_NAME ?? "iPhone simulado",
  deviceModel: "phone-sim",
});
console.log(`Código no "iPhone": ${pairingCode(qr, nonce)} — digite no Pulse Desktop.`);

let tokens: TokenPair | null = null;
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const st = await pollPairing(coreUrl, { pairingId: qr.pairingId, deviceNonce: nonce, proof: pollProof(qr, nonce) });
  if (st.status === "pending") continue;
  if (st.status !== "approved") {
    console.log(`Resultado: ${st.status}`);
    process.exit(0);
  }
  tokens = st.tokens;
  console.log(`Aprovado: dispositivo ${st.deviceId}`);
  break;
}

const client = new PulseClient(coreUrl, {
  load: async () => tokens,
  save: async (t) => void (tokens = t),
  clear: async () => void (tokens = null),
});
const stream = new PulseStream(client, {
  onState: (s) => console.log(`stream: ${s.kind}`),
  onReady: (st) => console.log(`conectado a ${st.hostname}`),
  onHeartbeat: () => {},
  onAudit: () => {},
});
stream.start();
await new Promise((r) => setTimeout(r, 30_000));
stream.stop();
console.log("Fim (o dispositivo continua pareado; revogue no Desktop).");
