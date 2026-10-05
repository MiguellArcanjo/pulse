import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Smartphone } from "lucide-react";
import type { DeviceInfo, Level } from "@pulse/protocol";
import { useDevices } from "../useDevices";
import { PairingDialog } from "./PairingDialog";
import { SecurityPanel, Toggle } from "./SecurityPanel";

const GRANTS: Array<{ level: Level; label: string; hint: string }> = [
  { level: "READ", label: "Leitura", hint: "ver o PC (sempre ligado)" },
  { level: "SAFE_ACTION", label: "Ações seguras", hint: "bloquear, abrir app permitido" },
  { level: "CONFIRM", label: "Com confirmação", hint: "fechar apps, screenshot, energia" },
  { level: "CRITICAL", label: "Críticas", hint: "irreversíveis, sempre com Face ID" },
];

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function DevicesPage({ coreOnline }: { coreOnline: boolean }) {
  const devices = useDevices();
  const [pairing, setPairing] = useState(false);
  const active = devices.filter((d) => d.status === "active");
  const revoked = devices.filter((d) => d.status !== "active");

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Dispositivos</h1>
          <p className="dim">iPhones com acesso a este PC. Cada um tem a própria credencial e pode ser revogado.</p>
        </div>
        <button className="btn btn-primary" disabled={!coreOnline} onClick={() => setPairing(true)}>
          <Plus size={16} aria-hidden /> Adicionar dispositivo
        </button>
      </section>

      {active.length === 0 ? (
        <section className="panel empty-state">
          <Smartphone size={32} className="dim" aria-hidden />
          <p>Nenhum dispositivo pareado.</p>
          <p className="dim small">Clique em “Adicionar dispositivo” e escaneie o QR com o Pulse no iPhone.</p>
        </section>
      ) : (
        <section className="device-list" aria-label="Dispositivos ativos">
          {active.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </section>
      )}

      <SecurityPanel />

      {revoked.length > 0 && (
        <section className="panel">
          <header className="panel-header">
            <h2>Revogados</h2>
          </header>
          <ul className="revoked-list">
            {revoked.map((d) => (
              <li key={d.id}>
                <span>{d.name}</span>
                <span className="dim small">pareado em {formatDateTime(d.pairedAtMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pairing && <PairingDialog onClose={() => setPairing(false)} />}
    </>
  );
}

function DeviceCard({ device }: { device: DeviceInfo }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setGrant = async (level: Level, on: boolean) => {
    setError(null);
    const next = on
      ? [...device.grants, level]
      : device.grants.filter((g) => g !== level);
    try {
      await invoke("device_set_grants", { deviceId: device.id, grants: next });
    } catch (e) {
      setError(String(e));
    }
  };

  const revoke = async () => {
    setError(null);
    try {
      await invoke("device_revoke", { deviceId: device.id });
    } catch (e) {
      setError(String(e));
      setConfirming(false);
    }
  };

  return (
    <article className="card device-card">
      <div className="device-main">
        <span className="device-icon">
          <Smartphone size={20} aria-hidden />
        </span>
        <div className="device-text">
          <div className="device-name">{device.name}</div>
          <div className="dim small">{device.model || "iPhone"}</div>
        </div>
        <span className={`status-pill ${device.online ? "is-online" : ""}`}>
          <span className="dot" aria-hidden />
          {device.online ? "Conectado" : "Offline"}
        </span>
      </div>

      <dl className="device-meta">
        <dt>Pareado em</dt>
        <dd>{formatDateTime(device.pairedAtMs)}</dd>
        <dt>Última conexão</dt>
        <dd>{device.online ? "agora" : device.lastSeenMs ? formatDateTime(device.lastSeenMs) : "—"}</dd>
      </dl>

      <div className="grant-list" role="group" aria-label={`Permissões de ${device.name}`}>
        {GRANTS.map((g) => {
          const on = device.grants.includes(g.level);
          return (
            <div key={g.level} className="grant-row">
              <span>
                {g.label} <span className="dim small">· {g.hint}</span>
              </span>
              <Toggle
                checked={on}
                disabled={g.level === "READ"}
                label={`${g.label} para ${device.name}`}
                onChange={(v) => void setGrant(g.level, v)}
              />
            </div>
          );
        })}
      </div>

      {error && <p className="bad small">{error}</p>}

      <div className="device-actions">
        {confirming ? (
          <>
            <span className="small">Revogar o acesso de {device.name}?</span>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={() => void revoke()}>
              Revogar acesso
            </button>
          </>
        ) : (
          <button className="btn btn-danger-ghost" onClick={() => setConfirming(true)}>
            Revogar acesso
          </button>
        )}
      </div>
    </article>
  );
}
