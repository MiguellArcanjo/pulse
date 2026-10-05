// Teste de ponta a ponta do Control contra um Core rodando, com o Windows real.
//
//   pnpm --filter @pulse/client e2e-control
//
// Seguro de propósito: NÃO bloqueia, suspende, reinicia nem desliga o PC.
// Só encerra um processo que o próprio teste inicia (um `ping` em segundo plano).
// Recomendado rodar contra um Core isolado:
//   PULSE_ENV=prod PULSE_DATA_DIR=<pasta temporária> PULSE_REMOTE_PORT=47699
//   PULSE_PUBLIC_URL=https://teste.invalid  (QR)   PULSE_E2E_URL=http://127.0.0.1:47699

import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import type { PairingTicket, TokenPair } from "@pulse/protocol";
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
} from "../src/index.ts";
import { Ipc } from "./lib/ipc.ts";

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
async function expectError(p: Promise<unknown>, code: string, what: string) {
  try {
    await p;
  } catch (e) {
    if (e instanceof PulseApiError && e.code === code) return ok(`${what} → ${code}`);
    fail(`${what}: esperava ${code}, veio ${e}`);
  }
  fail(`${what}: deveria ter falhado com ${code}`);
}

async function pair(ipc: Ipc): Promise<{ client: PulseClient; deviceId: string }> {
  const ticket = (await ipc.request("pairing_create")).data as PairingTicket;
  const qr = parsePairingQr(ticket.qrPayload) ?? fail("QR ilegível");
  const url = process.env.PULSE_E2E_URL ?? qr.coreUrl;
  const nonce = newNonce((n) => webcrypto.getRandomValues(new Uint8Array(n)));
  await claimPairing(url, {
    pairingId: qr.pairingId,
    deviceNonce: nonce,
    proof: claimProof(qr, nonce),
    deviceName: "Teste Control",
    deviceModel: "node",
  });
  await ipc.request("pairing_approve", { pairing_id: qr.pairingId, code: pairingCode(qr, nonce) });
  const st = await pollPairing(url, { pairingId: qr.pairingId, deviceNonce: nonce, proof: pollProof(qr, nonce) });
  if (st.status !== "approved") fail(`pareamento: ${st.status}`);
  let tokens: TokenPair | null = st.tokens;
  const client = new PulseClient(url, {
    load: async () => tokens,
    save: async (t) => void (tokens = t),
    clear: async () => void (tokens = null),
  });
  return { client, deviceId: st.deviceId };
}

async function main() {
  const ipc = await Ipc.connect().catch((e) => fail(`Core não está rodando? ${e}`));

  step("Parear um iPhone de teste");
  const { client, deviceId } = await pair(ipc);
  ok(`dispositivo ${deviceId}`);

  step("Foto do PC (dados reais do Windows)");
  // Processos são amostrados a cada 5 s pela tarefa de métricas.
  await new Promise((r) => setTimeout(r, 6000));
  const snap = await client.control();
  ok(`grants: ${snap.grants.join(", ")}`);
  if (!snap.grants.includes("CONFIRM") || snap.grants.includes("CRITICAL")) fail("padrão D9 errado");
  ok(`${snap.apps.length} apps com janela, ${snap.processes.length} processos no topo, ${snap.runningServices.length} serviços`);
  if (snap.runningServices.length === 0) fail("nenhum serviço listado");
  if (snap.apps.some((a) => a.exePath !== null)) fail("o iPhone não deveria receber caminhos de executáveis");
  ok("caminhos de executáveis não vão para o iPhone");
  const hb = (await client.status()).heartbeat;
  ok(`GPU: ${hb?.gpuPercent == null ? "indisponível" : hb.gpuPercent.toFixed(0) + "%"}`);

  step("Screenshot exige confirmação; com ela, captura a tela real");
  const first = await client.action({ action: "screenshot", confirmationId: null, faceIdVerified: false });
  if (first.status !== "confirmationRequired") fail("screenshot deveria pedir confirmação");
  ok(`confirmação pedida: "${first.confirmation.summary}" (Face ID: ${first.confirmation.faceId})`);
  const shot = await client.action({ action: "screenshot", confirmationId: first.confirmation.id, faceIdVerified: false });
  if (shot.status !== "done" || !shot.result.screenshot) fail("screenshot não veio");
  const s = shot.result.screenshot;
  ok(`imagem ${s.width}×${s.height} ${s.mime}, ${(s.base64.length * 0.75 / 1024).toFixed(0)} KB (conteúdo não inspecionado)`);

  step("Encerrar um processo criado pelo próprio teste");
  const victim = spawn("ping", ["-n", "120", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
  const pid = victim.pid ?? fail("não foi possível iniciar o processo de teste");
  const exited = new Promise<void>((r) => victim.once("exit", () => r()));
  const ask = await client.action({ action: "processKill", params: { pid }, confirmationId: null, faceIdVerified: false });
  if (ask.status !== "confirmationRequired") fail("kill deveria pedir confirmação");
  ok(`confirmação: ${ask.confirmation.detail}`);
  await expectError(
    client.action({ action: "processKill", params: { pid: pid + 1 }, confirmationId: ask.confirmation.id, faceIdVerified: false }),
    "confirmation_mismatch",
    "confirmação usada para outro PID",
  );
  const ask2 = await client.action({ action: "processKill", params: { pid }, confirmationId: null, faceIdVerified: false });
  if (ask2.status !== "confirmationRequired") fail("kill deveria pedir confirmação");
  const killed = await client.action({ action: "processKill", params: { pid }, confirmationId: ask2.confirmation.id, faceIdVerified: false });
  if (killed.status !== "done") fail("kill não executou");
  await Promise.race([exited, new Promise((_, r) => setTimeout(() => r(new Error("processo continuou vivo")), 5000))]);
  ok(`${killed.result.message} — o processo de fato terminou`);

  step("Proteções");
  await expectError(
    client.action({ action: "processKill", params: { pid: 4 }, confirmationId: null, faceIdVerified: false }).then(async (r) => {
      if (r.status === "confirmationRequired") {
        return client.action({ action: "processKill", params: { pid: 4 }, confirmationId: r.confirmation.id, faceIdVerified: false });
      }
      return r;
    }),
    "action_failed",
    "encerrar o processo System (PID 4)",
  );
  const restart = await client.action({ action: "restart", confirmationId: null, faceIdVerified: false });
  if (restart.status !== "confirmationRequired" || !restart.confirmation.faceId) fail("reiniciar deveria exigir Face ID");
  await expectError(
    client.action({ action: "restart", confirmationId: restart.confirmation.id, faceIdVerified: false }),
    "face_id_required",
    "reiniciar sem Face ID (nada foi reiniciado)",
  );

  step("Lockdown");
  await client.action({ action: "lockdownEnable", confirmationId: null, faceIdVerified: false });
  ok("ativado pelo iPhone");
  await expectError(
    client.action({ action: "screenshot", confirmationId: null, faceIdVerified: false }),
    "lockdown",
    "ação durante o Lockdown",
  );
  const pol = await client.security();
  await expectError(
    client.setSecurity({ policy: { ...pol, lockdown: false }, faceIdVerified: true }),
    "lockdown",
    "iPhone tentando desligar o Lockdown",
  );
  await ipc.request("security_set", { policy: { ...pol, lockdown: false } });
  if ((await client.security()).lockdown) fail("Desktop não desligou o Lockdown");
  ok("desligado pelo Desktop");

  step("Permissões por dispositivo");
  await ipc.request("device_set_grants", { device_id: deviceId, grants: ["READ"] });
  await expectError(
    client.action({ action: "screenshot", confirmationId: null, faceIdVerified: false }),
    "not_granted",
    "ação sem permissão",
  );
  await ipc.request("device_revoke", { device_id: deviceId });
  ok("dispositivo de teste revogado");

  ipc.close();
  console.log("\n✅ Control OK");
}

main().catch((e) => fail(String(e)));
