// Verificações do M1: cada uma prova que uma capacidade funciona num build
// instalado por sideloading (assinatura gratuita), não só no desenvolvimento.

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import type { HealthResponse } from "@pulse/protocol";

export type CheckResult = { ok: boolean; detail: string };

// ---------- Face ID ----------

export async function checkBiometrics(): Promise<CheckResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return { ok: false, detail: "Sem hardware biométrico." };
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { ok: false, detail: "Face ID não configurado no iPhone." };

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const kind = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? "Face ID"
    : "Touch ID";
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: "Testar autenticação do Pulse",
    cancelLabel: "Cancelar",
  });
  return res.success
    ? { ok: true, detail: `${kind} autenticado.` }
    : { ok: false, detail: `${kind} falhou: ${res.error}` };
}

// ---------- Keychain ----------

const KC = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const FIRST_SEEN = "pulse.poc.firstSeen";
const LAUNCHES = "pulse.poc.launches";

/**
 * Grava no Keychain na primeira execução e conta aberturas. Se depois de um
 * "Refresh" do AltStore a data original continuar lá, o Keychain sobrevive à
 * re-assinatura — requisito para guardar o token de pareamento.
 */
export async function checkKeychain(): Promise<CheckResult> {
  let firstSeen = await SecureStore.getItemAsync(FIRST_SEEN, KC);
  if (!firstSeen) {
    firstSeen = new Date().toISOString();
    await SecureStore.setItemAsync(FIRST_SEEN, firstSeen, KC);
  }
  const launches = Number((await SecureStore.getItemAsync(LAUNCHES, KC)) ?? "0") + 1;
  await SecureStore.setItemAsync(LAUNCHES, String(launches), KC);

  const when = new Date(firstSeen).toLocaleString("pt-BR");
  return { ok: true, detail: `Gravado em ${when} · ${launches}ª abertura lendo o mesmo valor.` };
}

// ---------- Assinatura (embedded.mobileprovision) ----------

export interface SigningInfo {
  expiresAt: Date;
  team: string | null;
}

/**
 * Lê a validade do perfil de provisionamento embutido pelo AltServer. O arquivo
 * é um CMS assinado com o plist em texto claro dentro; basta procurar as chaves.
 */
export async function readSigning(): Promise<SigningInfo | null> {
  const file = new File(Paths.bundle, "embedded.mobileprovision");
  if (!file.exists) return null;
  const bytes = await file.bytes();
  let text = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const exp = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(text);
  if (!exp) return null;
  const team = /<key>TeamName<\/key>\s*<string>([^<]+)<\/string>/.exec(text);
  return { expiresAt: new Date(exp[1]), team: team?.[1] ?? null };
}

export async function checkSigning(): Promise<CheckResult> {
  const info = await readSigning();
  if (!info) {
    return {
      ok: false,
      detail: "embedded.mobileprovision não encontrado (normal em simulador).",
    };
  }
  const days = (info.expiresAt.getTime() - Date.now()) / 86_400_000;
  const when = info.expiresAt.toLocaleString("pt-BR");
  return {
    ok: days > 0,
    detail: `Expira em ${when} (${days.toFixed(1)} dias)${info.team ? ` · ${info.team}` : ""}.`,
  };
}

// ---------- Core via Tailscale ----------

const HEALTH_TIMEOUT_MS = 6000;

export async function checkCore(baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} em ${ms} ms.` };
    const body = (await res.json()) as HealthResponse;
    return body.ok && body.service === "pulse-core"
      ? { ok: true, detail: `Pulse Core ${body.version} respondeu em ${ms} ms.` }
      : { ok: false, detail: "Respondeu, mas não parece ser o Pulse Core." };
  } catch (e) {
    // O fetch da Expo no iOS não usa o nome "AbortError" (lança
    // FetchRequestCanceledException); o sinal é a fonte confiável.
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      detail: aborted ? "Sem resposta (timeout). PC offline ou Tailscale desligado?" : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Preferências não secretas ----------

const PREFS = new File(Paths.document, "prefs.json");

export function loadCoreUrl(): string {
  try {
    if (PREFS.exists) return (JSON.parse(PREFS.textSync()) as { coreUrl?: string }).coreUrl ?? "";
  } catch {
    // Preferência corrompida não deve impedir o app de abrir.
  }
  return "";
}

export function saveCoreUrl(coreUrl: string): void {
  if (!PREFS.exists) PREFS.create();
  PREFS.write(JSON.stringify({ coreUrl }));
}
