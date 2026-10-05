// Cliente IPC mínimo para scripts de teste: fala com o Core pelo named pipe,
// como o Pulse Desktop faz em Rust (frames u32 + JSON).

import net from "node:net";
import { execSync } from "node:child_process";
import { join } from "node:path";

export const PROTOCOL_VERSION = 5;

export type Json = Record<string, unknown>;

export class Ipc {
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

  /** `flavor`: "dev" (padrão) ou "prod" — o mesmo de `PULSE_ENV` do Core. */
  static async connect(flavor = process.env.PULSE_ENV === "prod" ? "prod" : "dev"): Promise<Ipc> {
    // Caminho completo: no Git Bash, `whoami` resolve para a versão GNU.
    const whoami = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
    const csv = execSync(`"${whoami}" /user /fo csv /nh`).toString().trim();
    const sid = csv.split(",")[1]?.replace(/"/g, "");
    const pipe = `\\\\.\\pipe\\pulse-core-${flavor}-${sid}`;
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(pipe, () => resolve(s));
      s.once("error", reject);
    });
    const ipc = new Ipc(sock);
    const welcome = new Promise<Json>((resolve) => ipc.listeners.push((m) => m.type === "welcome" && resolve(m)));
    ipc.send({ type: "hello", protocol_version: PROTOCOL_VERSION, client: "desktop" });
    await welcome;
    await ipc.request("subscribe", { topics: ["pairing", "devices", "security"] });
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

