import { useEffect, useState, type ReactNode } from "react";
import {
  Activity as Pulse,
  ArrowDown,
  ArrowUp,
  Clock,
  Cpu,
  HardDrive,
  ListTree,
  Moon,
  Server,
  Sun,
  Sunrise,
} from "lucide-react";
import type { AuditItem, CoreConnection, Heartbeat } from "@pulse/protocol";
import { useCore, type History } from "./useCore";
import { Sidebar, type Page } from "./components/Sidebar";
import { DevicesPage } from "./components/DevicesPage";
import { ControlPage } from "./components/ControlPage";
import { Activity } from "./components/Activity";
import { Sparkline } from "./components/Sparkline";
import {
  formatBytes,
  formatDuration,
  formatLongDate,
  formatRate,
  formatTime,
  gb,
  greeting,
} from "./format";

const HIGH_USAGE = 90;

export default function App() {
  const { connection, heartbeat, history, audit } = useCore();
  const now = useNow();
  const online = connection.state === "connected";
  const version = online ? connection.status.version : null;
  const [page, setPage] = useState<Page>("overview");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Pulse className="brand-icon" size={26} strokeWidth={2.25} aria-hidden />
          <div>
            <div className="brand-name">
              Pulse {version && <span className="brand-version">v{version}</span>}
              {online && connection.status.devMode && <span className="tag">dev</span>}
            </div>
            <div className="brand-tagline">Seu computador. Seus projetos. Em qualquer lugar.</div>
          </div>
        </div>
        <div className="clock">
          <div className="clock-date">{formatLongDate(now)}</div>
          <div className="clock-time">{formatTime(now.getTime(), false)}</div>
        </div>
      </header>

      <div className="body">
        <Sidebar connection={connection} heartbeat={heartbeat} page={page} onNavigate={setPage} />

        <main className="content">
          {page === "devices" ? (
            <DevicesPage coreOnline={online} />
          ) : page === "control" ? (
            <ControlPage heartbeat={heartbeat} />
          ) : (
            <Overview
              now={now}
              connection={connection}
              heartbeat={heartbeat}
              history={history}
              audit={audit}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Overview(props: {
  now: Date;
  connection: CoreConnection;
  heartbeat: Heartbeat | null;
  history: History;
  audit: AuditItem[];
}) {
  const { now, connection, heartbeat, history, audit } = props;
  const stale = connection.state !== "connected" && heartbeat !== null;
  return (
    <>
      <Hero now={now} connection={connection} heartbeat={heartbeat} />

      {stale && heartbeat && (
        <p className="stale-note">
          Valores congelados · Última atualização: {formatTime(heartbeat.tsMs)}
        </p>
      )}

      <section className={`metrics ${stale ? "is-stale" : ""}`} aria-label="Saúde do PC">
        <MetricCard label="CPU" value={heartbeat ? `${heartbeat.cpuPercent.toFixed(0)}%` : "—"}>
          <Sparkline values={history.cpu} max={100} />
        </MetricCard>

        <MetricCard
          label="RAM"
          value={heartbeat ? gb(heartbeat.memUsedBytes) : "—"}
          unit={heartbeat ? `/ ${gb(heartbeat.memTotalBytes)} GB` : undefined}
          percent={heartbeat ? (heartbeat.memUsedBytes / heartbeat.memTotalBytes) * 100 : undefined}
        />

        <MetricCard
          label={heartbeat?.systemDisk ? `Disco (${heartbeat.systemDisk.mount.replace("\\", "")})` : "Disco"}
          value={heartbeat?.systemDisk ? formatBytes(heartbeat.systemDisk.usedBytes) : "—"}
          unit={heartbeat?.systemDisk ? `/ ${formatBytes(heartbeat.systemDisk.totalBytes)}` : undefined}
          percent={
            heartbeat?.systemDisk
              ? (heartbeat.systemDisk.usedBytes / heartbeat.systemDisk.totalBytes) * 100
              : undefined
          }
          tone="green"
        />

        <MetricCard label="Rede">
          <div className="net">
            <span>
              <ArrowDown size={14} aria-label="Recebendo" />
              {heartbeat ? formatRate(heartbeat.netRxBytesPerSec) : "—"}
            </span>
            <span>
              <ArrowUp size={14} aria-label="Enviando" />
              {heartbeat ? formatRate(heartbeat.netTxBytesPerSec) : "—"}
            </span>
          </div>
          <Sparkline values={history.netRx} />
        </MetricCard>
      </section>

      <div className="columns">
        <Activity items={audit} />
        <SystemStatus connection={connection} heartbeat={heartbeat} stale={stale} />
      </div>
    </>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Hero(props: { now: Date; connection: CoreConnection; heartbeat: Heartbeat | null }) {
  const { now, connection, heartbeat } = props;
  const hour = now.getHours();
  const Icon = hour >= 5 && hour < 12 ? Sunrise : hour >= 12 && hour < 18 ? Sun : Moon;

  let message: ReactNode;
  if (connection.state === "disconnected") {
    message = (
      <>
        <strong className="bad">Pulse Core desconectado</strong> — {connection.reason}. Tentando reconectar…
      </>
    );
  } else if (connection.state === "connecting" || !heartbeat) {
    message = "Conectando ao Pulse Core…";
  } else {
    const alerts: string[] = [];
    if (heartbeat.cpuPercent >= HIGH_USAGE) alerts.push(`CPU em ${heartbeat.cpuPercent.toFixed(0)}%`);
    const mem = (heartbeat.memUsedBytes / heartbeat.memTotalBytes) * 100;
    if (mem >= HIGH_USAGE) alerts.push(`RAM em ${mem.toFixed(0)}%`);
    message = alerts.length ? (
      <span className="warn">Atenção: {alerts.join(" · ")}.</span>
    ) : (
      "Seu PC está online e tudo parece funcionar bem."
    );
  }

  return (
    <section className="hero">
      <Icon className="hero-icon" size={40} strokeWidth={1.5} aria-hidden />
      <div>
        <h1>{greeting(now)}.</h1>
        <p role="status">{message}</p>
      </div>
    </section>
  );
}

function MetricCard(props: {
  label: string;
  value?: string;
  unit?: string;
  percent?: number;
  tone?: "blue" | "green";
  children?: ReactNode;
}) {
  const pct = props.percent;
  return (
    <div className={`card metric tone-${props.tone ?? "blue"}`}>
      <div className="metric-label">{props.label}</div>
      {props.value !== undefined && (
        <div className="metric-row">
          <div className="metric-value">
            {props.value}
            {props.unit && <span className="metric-unit"> {props.unit}</span>}
          </div>
          {pct !== undefined && <div className="metric-pct">{pct.toFixed(0)}%</div>}
        </div>
      )}
      {pct !== undefined && (
        <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {props.children}
    </div>
  );
}

function SystemStatus(props: { connection: CoreConnection; heartbeat: Heartbeat | null; stale: boolean }) {
  const { connection, heartbeat, stale } = props;
  const status = connection.state === "connected" ? connection.status : null;
  return (
    <section className="panel" aria-labelledby="status-title">
      <header className="panel-header">
        <h2 id="status-title">Status do sistema</h2>
      </header>
      <div className={`tiles ${stale ? "is-stale" : ""}`}>
        <Tile icon={<Clock size={18} />} label="PC ligado há" value={heartbeat ? formatDuration(heartbeat.systemUptimeSecs) : "—"} />
        <Tile icon={<ListTree size={18} />} label="Processos" value={heartbeat ? String(heartbeat.processCount) : "—"} />
        <Tile icon={<Cpu size={18} />} label="Core rodando há" value={heartbeat ? formatDuration(heartbeat.coreUptimeSecs) : "—"} />
        <Tile
          icon={<HardDrive size={18} />}
          label="Disco livre"
          value={
            heartbeat?.systemDisk
              ? formatBytes(heartbeat.systemDisk.totalBytes - heartbeat.systemDisk.usedBytes)
              : "—"
          }
        />
      </div>
      {status && (
        <div className="core-info">
          <Server size={16} aria-hidden />
          <span>
            Pulse Core {status.version} · PID {status.pid}
          </span>
          <span className="mono dim" title="Onde ficam os dados do Pulse">
            {status.dataDir}
          </span>
        </div>
      )}
    </section>
  );
}

function Tile(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="tile">
      <span className="tile-icon">{props.icon}</span>
      <span>
        <span className="tile-label">{props.label}</span>
        <span className="tile-value">{props.value}</span>
      </span>
    </div>
  );
}
