// Teste de ponta a ponta contra um Pulse Core de desenvolvimento rodando.
//
//   pnpm --filter @pulse/client e2e
//
// Faz o papel do Desktop (named pipe) e do iPhone (@pulse/client):
// QR → claim → aprovação → tokens → /v1/status → stream ao vivo → revogação.
// Usa o endereço do QR (Tailscale Serve, HTTPS real); PULSE_E2E_URL sobrescreve.
// Cria um dispositivo "Teste E2E" no banco de dev e o revoga ao final.

import net from "node:net";
import { execSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { join } from "node:path";
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

const PROTOCOL_VERSION = 3;
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

// ---------- cliente IPC mínimo (o que o Pulse Desktop faz em Rust) ----------

type Json = Record<string, unknown>;

class Ipc {
  private sock: net.Socket;
  private buf = Buffer.alloc(0);
  private nextId = 1000;
  private pending = new Map<number, (msg: Json) => void>();
  private listeners: Array<(ev: Json) => void> = [];

  private constructor(sock: net.Socket) {
    this.sock = sock;
    sock.on("data", (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= 4) {
        const len = this.buf.readUInt32BE(0);
        if (this.buf.length < 4 + len) break;
        const msg = JSON.parse(this.buf.subarray(4, 4 + len).toString("utf8")) as Json;
        this.buf = this.buf.subarray(4 + len);
        this.dispatch(msg);
      }
    });
  }

  static async connect(): Promise<Ipc> {
    // Caminho completo: no Git Bash, `whoami` resolve para a versão GNU.
    const whoami = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
    const csv = execSync(`"${whoami}" /user /fo csv /nh`).toString().trim();
    const sid = csv.split(",")[1]?.replace(/"/g, "");
    const pipe = `\\\\.\\pipe\\pulse-core-dev-${sid}`;
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(pipe, () => resolve(s));
      s.once("error", reject);
    });
    const ipc = new Ipc(sock);
    const welcome = new Promise<Json>((resolve) => ipc.listeners.push((m) => m.type === "welcome" && resolve(m)));
    ipc.send({ type: "hello", protocol_version: PROTOCOL_VERSION, client: "desktop" });
    await welcome;
    await ipc.request("subscribe", { topics: ["pairing", "devices"] });
    return ipc;
  }

  private send(msg: Json) {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    this.sock.write(Buffer.concat([head, body]));
  }

  private dispatch(msg: Json) {
    if (msg.type === "response") {
      this.pending.get(msg.id as number)?.(msg);
      this.pending.delete(msg.id as number);
    }
    this.listeners.forEach((l) => l(msg));
  }

  request(method: string, params?: Json): Promise<Json> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve((msg.ok as Json | undefined) ?? {});
      });
      this.send({ type: "request", id, method, ...(params ? { params } : {}) });
    });
  }

  nextEvent(topic: string, timeoutMs = 5000): Promise<Json> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout esperando ${topic}`)), timeoutMs);
      const l = (m: Json) => {
        if (m.type === "event" && m.topic === topic) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(m.payload as Json);
        }
      };
      this.listeners.push(l);
    });
  }

  close() {
    this.sock.end();
  }
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
