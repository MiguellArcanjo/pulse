// Teste de ponta a ponta contra um Pulse Core de desenvolvimento rodando.
//
//   pnpm --filter @pulse/client e2e
//
// Faz o papel do Desktop (named pipe) e do iPhone (@pulse/client):
// QR → claim → aprovação → tokens → /v1/status → stream ao vivo → revogação.
// Usa o endereço do QR (Tailscale Serve, HTTPS real); PULSE_E2E_URL sobrescreve.
// Cria um dispositivo "Teste E2E" no banco de dev e o revoga ao final.

import { webcrypto } from "node:crypto";
import type { Heartbeat, PairingRequest, PairingTicket, TokenPair } from "@pulse/protocol";
import {
  claimPairing,
  claimProof,
  newNonce,
  pairingCode,
  parsePairingQr,
  pollPairing,
  pollProof,
  PulseApiError,
  PulseClient,
  PulseStream,
  type StreamState,
} from "../src/index.ts";
import { Ipc } from "./lib/ipc.ts";

const randomBytes = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

function step(msg: string) {
  console.log(`\n▶ ${msg}`);
}
function ok(msg: string) {
  console.log(`  ✔ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✖ ${msg}`);
  process.exit(1);
}

// ---------- roteiro ----------

async function main() {
  step("Desktop conecta ao Core pelo named pipe");
  const ipc = await Ipc.connect().catch((e) => fail(`Core não está rodando? ${e}`));
  ok("conectado");

  step("Desktop gera o QR");
  const created = await ipc.request("pairing_create");
  const ticket = created.data as PairingTicket;
  ticket.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  const qr = parsePairingQr(ticket.qrPayload) ?? fail(`QR ilegível: ${ticket.qrPayload}`);
  const coreUrl = process.env.PULSE_E2E_URL ?? qr.coreUrl;
  ok(`QR lido; Core em ${coreUrl}`);

  step("iPhone faz o claim");
  const nonce = newNonce(randomBytes);
  const requested = ipc.nextEvent("pairing_requested");
  const claim = await claimPairing(coreUrl, {
    pairingId: qr.pairingId,
    deviceNonce: nonce,
    proof: claimProof(qr, nonce),
    deviceName: "Teste E2E",
    deviceModel: "node",
  });
  if (claim.status !== "pending") fail(`esperava pending, veio ${claim.status}`);
  const req = (await requested) as unknown as PairingRequest;
  if ("code" in req) fail("o Desktop não deveria receber o código");
  const code = pairingCode(qr, nonce);
  ok(`Desktop recebeu o pedido de "${req.deviceName}"; o iPhone mostra ${code}`);

  step("iPhone espera; Desktop autoriza");
  const poll = () => pollPairing(coreUrl, { pairingId: qr.pairingId, deviceNonce: nonce, proof: pollProof(qr, nonce) });
  if ((await poll()).status !== "pending") fail("poll deveria estar pending");
  const wrong = code === "000000" ? "111111" : "000000";
  await ipc
    .request("pairing_approve", { pairing_id: qr.pairingId, code: wrong })
    .then(() => fail("código errado foi aceito"))
    .catch((e) => ok(`código errado recusado: ${String(e).slice(0, 60)}`));
  await ipc.request("pairing_approve", { pairing_id: qr.pairingId, code });
  const approved = await poll();
  if (approved.status !== "approved") fail(`esperava approved, veio ${approved.status}`);
  ok(`tokens recebidos para o dispositivo ${approved.deviceId}`);

  let stored: TokenPair | null = approved.tokens;
  const client = new PulseClient(coreUrl, {
    load: async () => stored,
    save: async (t) => void (stored = t),
    clear: async () => void (stored = null),
  });

  step("Rotas autenticadas");
  const status = await client.status();
  ok(`/v1/status: ${status.hostname} · ${status.osVersion} · CPU ${status.heartbeat?.cpuPercent.toFixed(0)}%`);
  const devs = await client.devices();
  if (!devs.devices.some((d) => d.id === devs.me)) fail("dispositivo não aparece na lista");
  ok(`/v1/devices: ${devs.devices.filter((d) => d.status === "active").length} ativo(s)`);

  step("Stream em tempo real");
  const states: StreamState["kind"][] = [];
  let revokedResolve!: () => void;
  const revoked = new Promise<void>((r) => (revokedResolve = r));
  let hbResolve!: (hb: Heartbeat) => void;
  const firstHb = new Promise<Heartbeat>((r) => (hbResolve = r));
  const stream = new PulseStream(client, {
    onState: (s) => {
      states.push(s.kind);
      if (s.kind === "revoked") revokedResolve();
    },
    onReady: () => {},
    onHeartbeat: (hb) => hbResolve(hb),
    onAudit: () => {},
  });
  stream.start();
  const hb = await Promise.race([firstHb, new Promise<never>((_, r) => setTimeout(() => r(new Error("sem heartbeat")), 6000))]);
  ok(`heartbeat ao vivo: CPU ${hb.cpuPercent.toFixed(0)}%, RAM ${(hb.memUsedBytes / 2 ** 30).toFixed(1)} GB`);
  const online = await ipc.request("devices_list");
  const me = (online.data as Array<{ id: string; online: boolean }>).find((d) => d.id === devs.me);
  if (!me?.online) fail("Desktop deveria ver o dispositivo como conectado");
  ok("Desktop vê o dispositivo como conectado");

  step("Desktop revoga o acesso");
  await ipc.request("device_revoke", { device_id: devs.me });
  await Promise.race([revoked, new Promise<never>((_, r) => setTimeout(() => r(new Error("stream não caiu")), 5000))]);
  ok(`stream encerrado como revogado (${states.join(" → ")})`);
  try {
    await client.status();
    fail("status deveria falhar após revogação");
  } catch (e) {
    if (!(e instanceof PulseApiError) || e.code !== "device_revoked") throw e;
    ok("chamadas seguintes recebem device_revoked");
  }

  ipc.close();
  console.log("\n✅ Fluxo completo OK");
}

main().catch((e) => fail(String(e)));
