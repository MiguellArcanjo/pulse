import { useState } from "react";
import {
  Camera,
  Lock,
  Moon,
  Play,
  Plus,
  Power,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { Action, AppWindow, Heartbeat, ProcessInfo, Screenshot } from "@pulse/protocol";
import { runAction, useControl, usePolicy } from "../useControl";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatBytes, formatDuration, formatRate, gb } from "../format";
import { invoke } from "@tauri-apps/api/core";

interface Pending {
  action: Action;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

const POWER: Array<{ action: Action; label: string; icon: typeof Power; confirm?: Omit<Pending, "action"> }> = [
  { action: { action: "lock" }, label: "Bloquear", icon: Lock },
  {
    action: { action: "suspend" },
    label: "Suspender",
    icon: Moon,
    confirm: { title: "Suspender o PC?", body: "O PC entra em suspensão em instantes.", confirmLabel: "Suspender" },
  },
  {
    action: { action: "restart" },
    label: "Reiniciar",
    icon: RotateCcw,
    confirm: {
      title: "Reiniciar o PC?",
      body: "O Windows reinicia em 10 segundos. Para cancelar: shutdown /a",
      confirmLabel: "Reiniciar",
      danger: true,
    },
  },
  {
    action: { action: "shutdown" },
    label: "Desligar",
    icon: Power,
    confirm: {
      title: "Desligar o PC?",
      body: "O Windows desliga em 10 segundos. Para cancelar: shutdown /a",
      confirmLabel: "Desligar",
      danger: true,
    },
  },
];

export function ControlPage({ heartbeat }: { heartbeat: Heartbeat | null }) {
  const { snapshot, error, refresh } = useControl(true);
  const [policy, setPolicy] = usePolicy();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [adding, setAdding] = useState(false);

  const run = async (action: Action) => {
    setBusy(true);
    try {
      const r = await runAction(action);
      if (r.screenshot) setShot(r.screenshot);
      setToast({ ok: true, text: r.message });
      void refresh();
    } catch (e) {
      setToast({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const ask = (p: Pending) => setPending(p);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>Control</h1>
          <p className="dim">Apps, processos e energia do PC. As ações daqui são auditadas como “Pulse Desktop”.</p>
        </div>
      </section>

      {policy?.lockdown && (
        <div className="banner banner-warn" role="status">
          <ShieldAlert size={18} aria-hidden />
          <span>
            <strong>Lockdown Mode ativo.</strong> Os iPhones estão em modo somente leitura.
          </span>
          <button className="btn" onClick={() => void setPolicy({ ...policy, lockdown: false })}>
            Desativar Lockdown
          </button>
        </div>
      )}

      {toast && (
        <div className={`banner ${toast.ok ? "banner-ok" : "banner-bad"}`} role="status">
          <span>{toast.text}</span>
          <button className="icon-btn" onClick={() => setToast(null)} aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      )}
      {error && <p className="bad small">{error}</p>}

      <section className="metrics metrics-6" aria-label="Sistema">
        <Stat label="CPU" value={heartbeat ? `${heartbeat.cpuPercent.toFixed(0)}%` : "—"} />
        <Stat
          label="RAM"
          value={heartbeat ? `${gb(heartbeat.memUsedBytes)} / ${gb(heartbeat.memTotalBytes)} GB` : "—"}
        />
        <Stat label="GPU" value={heartbeat?.gpuPercent != null ? `${heartbeat.gpuPercent.toFixed(0)}%` : "—"} />
        <Stat
          label="Disco"
          value={heartbeat?.systemDisk ? `${formatBytes(heartbeat.systemDisk.usedBytes)} / ${formatBytes(heartbeat.systemDisk.totalBytes)}` : "—"}
        />
        <Stat
          label="Rede"
          value={heartbeat ? `↓ ${formatRate(heartbeat.netRxBytesPerSec)} ↑ ${formatRate(heartbeat.netTxBytesPerSec)}` : "—"}
        />
        <Stat label="Ligado há" value={heartbeat ? formatDuration(heartbeat.systemUptimeSecs) : "—"} />
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Energia e tela</h2>
        </header>
        <div className="action-row">
          {POWER.map((p) => (
            <button
              key={p.label}
              className="btn"
              disabled={busy}
              onClick={() => (p.confirm ? ask({ action: p.action, ...p.confirm }) : void run(p.action))}
            >
              <p.icon size={16} aria-hidden /> {p.label}
            </button>
          ))}
          <button className="btn" disabled={busy} onClick={() => void run({ action: "screenshot" })}>
            <Camera size={16} aria-hidden /> Screenshot
          </button>
        </div>
      </section>

      <div className="columns">
        <section className="panel">
          <header className="panel-header">
            <h2>Apps abertos</h2>
            <span className="panel-meta">{snapshot?.apps.length ?? 0}</span>
          </header>
          <p className="dim small panel-hint">
            Programas abertos agora neste PC. “Liberar para o iPhone” permite que o celular abra este app aqui no PC, à distância; “Fechar” pede para ele fechar.
          </p>
          <ul className="list">
            {snapshot?.apps.map((a) => (
              <AppRow
                key={a.pid}
                app={a}
                allowed={!!snapshot.allowedApps.find((x) => x.path.toLowerCase() === a.exePath?.toLowerCase())}
                onClose={() =>
                  ask({
                    action: { action: "appClose", params: { pid: a.pid } },
                    title: `Fechar ${a.process || a.title}?`,
                    body: "O app recebe o pedido de fechar, como ao clicar no X. Ele pode pedir para salvar.",
                    confirmLabel: "Fechar app",
                  })
                }
                onAllow={async () => {
                  try {
                    await invoke("allowed_app_add", { name: a.process.replace(/\.exe$/i, ""), path: a.exePath });
                    void refresh();
                  } catch (e) {
                    setToast({ ok: false, text: String(e) });
                  }
                }}
              />
            ))}
          </ul>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>Apps que o iPhone pode abrir neste PC</h2>
            <button className="btn btn-small" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden /> Adicionar
            </button>
          </header>
          <p className="dim small panel-hint">
            O iPhone funciona como controle remoto: o app abre aqui no PC. Por segurança, só os desta lista.
          </p>
          {snapshot && snapshot.allowedApps.length === 0 && (
            <p className="dim small">Nenhum ainda. Use “Liberar para o iPhone” num app aberto ou “Adicionar”.</p>
          )}
          <ul className="list">
            {snapshot?.allowedApps.map((a) => (
              <li key={a.id} className="list-row">
                <span className="list-main">
                  <span className="list-title">{a.name}</span>
                  <span className="list-sub mono">{a.path}</span>
                </span>
                <button
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => void run({ action: "appLaunch", params: { appId: a.id } })}
                >
                  <Play size={14} aria-hidden /> Abrir
                </button>
                <button
                  className="btn btn-small btn-danger-ghost"
                  onClick={async () => {
                    await invoke("allowed_app_remove", { id: a.id });
                    void refresh();
                  }}
                >
                  <Trash2 size={14} aria-hidden /> Remover
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="columns">
        <section className="panel">
          <header className="panel-header">
            <h2>Processos</h2>
            <span className="panel-meta">por uso de CPU</span>
          </header>
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th className="num">PID</th>
                <th className="num">CPU</th>
                <th className="num">RAM</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {snapshot?.processes.slice(0, 15).map((p) => (
                <ProcessRow
                  key={p.pid}
                  p={p}
                  onKill={() =>
                    ask({
                      action: { action: "processKill", params: { pid: p.pid } },
                      title: `Encerrar ${p.name}?`,
                      body: "O processo é encerrado à força; dados não salvos são perdidos.",
                      confirmLabel: "Encerrar",
                      danger: true,
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>Serviços em execução</h2>
            <span className="panel-meta">{snapshot?.runningServices.length ?? 0}</span>
          </header>
          <ul className="list list-scroll">
            {snapshot?.runningServices.map((s) => (
              <li key={s.name} className="list-row">
                <span className="list-main">
                  <span className="list-title">{s.displayName}</span>
                  <span className="list-sub">{s.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.title}
          confirmLabel={pending.confirmLabel}
          danger={pending.danger}
          busy={busy}
          onConfirm={() => void run(pending.action)}
          onCancel={() => setPending(null)}
        >
          <p className="dim">{pending.body}</p>
        </ConfirmDialog>
      )}

      {shot && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShot(null)}>
          <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Screenshot">
            <header className="modal-header">
              <h2>Screenshot</h2>
              <button className="icon-btn" onClick={() => setShot(null)} aria-label="Fechar">
                <X size={18} />
              </button>
            </header>
            <img className="shot" src={`data:${shot.mime};base64,${shot.base64}`} alt="Captura da tela do PC" />
          </div>
        </div>
      )}

      {adding && <AddAppDialog onClose={() => setAdding(false)} onAdded={() => void refresh()} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card metric metric-compact">
      <div className="metric-label">{label}</div>
      <div className="metric-value metric-value-sm">{value}</div>
    </div>
  );
}

function AppRow(props: { app: AppWindow; allowed: boolean; onClose: () => void; onAllow: () => void }) {
  const { app } = props;
  return (
    <li className="list-row">
      <span className="list-main">
        <span className="list-title">{app.title}</span>
        <span className="list-sub">
          {app.process || "?"} · {formatBytes(app.memBytes)} · CPU {app.cpuPercent.toFixed(0)}%
        </span>
      </span>
      {app.exePath && !props.allowed && (
        <button className="btn btn-small" onClick={props.onAllow} title="O iPhone poderá abrir este app aqui no PC, à distância">
          <ShieldCheck size={14} aria-hidden /> Liberar para o iPhone
        </button>
      )}
      {props.allowed && <span className="tag tag-ok">liberado</span>}
      <button className="btn btn-small btn-danger-ghost" onClick={props.onClose}>
        <XCircle size={14} aria-hidden /> Fechar
      </button>
    </li>
  );
}

function ProcessRow({ p, onKill }: { p: ProcessInfo; onKill: () => void }) {
  return (
    <tr>
      <td className="truncate">{p.name}</td>
      <td className="num dim">{p.pid}</td>
      <td className="num">{p.cpuPercent.toFixed(1)}%</td>
      <td className="num">{formatBytes(p.memBytes)}</td>
      <td className="num">
        <button className="icon-btn" title="Encerrar processo à força" aria-label={`Encerrar ${p.name}`} onClick={onKill}>
          <XCircle size={15} />
        </button>
      </td>
    </tr>
  );
}

function AddAppDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title="Permitir app no iPhone"
      confirmLabel="Adicionar"
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await invoke("allowed_app_add", { name, path });
          onAdded();
          onClose();
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <label className="field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VS Code" />
      </label>
      <label className="field">
        <span>Caminho do .exe</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\Users\…\Code.exe"
          className="mono"
        />
      </label>
      {error && <p className="bad small">{error}</p>}
    </ConfirmDialog>
  );
}
