import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Code2,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Monitor,
  Smartphone,
  SquareTerminal,
  Zap,
} from "lucide-react";
import type { CoreConnection, Heartbeat } from "@pulse/protocol";
import { formatDuration } from "../format";

export type Page = "overview" | "devices" | "control";

interface NavItem {
  page?: Page;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Milestone em que o módulo chega. Ausente = disponível. */
  milestone?: string;
}

const NAV: NavItem[] = [
  { page: "overview", label: "Visão Geral", hint: "Saúde do PC", icon: LayoutDashboard },
  { page: "devices", label: "Dispositivos", hint: "iPhone pareado", icon: Smartphone },
  { page: "control", label: "Control", hint: "PC & Sistema", icon: Monitor },
  { label: "Dev", hint: "Projetos & Claude", icon: Code2, milestone: "M4" },
  { label: "Browser", hint: "Navegador", icon: Globe, milestone: "M5" },
  { label: "Trigger", hint: "Automações", icon: Zap, milestone: "M6" },
  { label: "Arquivos", hint: "Explorador", icon: FolderOpen, milestone: "M7" },
  { label: "Terminal", hint: "Shell & CLI", icon: SquareTerminal, milestone: "M8" },
  { label: "Echo", hint: "IA & Análises", icon: Bot, milestone: "M9" },
];

export function Sidebar(props: {
  connection: CoreConnection;
  heartbeat: Heartbeat | null;
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const { connection, heartbeat, page, onNavigate } = props;
  const online = connection.state === "connected";

  return (
    <aside className="sidebar">
      <nav className="nav" aria-label="Módulos">
        {NAV.map((item) => {
          const active = item.page === page;
          const Icon = item.icon;
          const target = item.page;
          return (
            <button
              type="button"
              key={item.label}
              className={`nav-item ${active ? "is-active" : ""} ${item.milestone ? "is-soon" : ""}`}
              aria-current={active ? "page" : undefined}
              disabled={!target}
              title={item.milestone ? `Chega no ${item.milestone}` : undefined}
              onClick={() => target && onNavigate(target)}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="nav-text">
                <span className="nav-label">{item.label}</span>
                <span className="nav-hint">{item.hint}</span>
              </span>
              {item.milestone && <span className="nav-soon">{item.milestone}</span>}
            </button>
          );
        })}
      </nav>

      <div className={`pc-card ${online ? "" : "is-offline"}`}>
        <div className="pc-card-title">
          <span className="dot" aria-hidden />
          {online ? "PC Online" : connection.state === "connecting" ? "Conectando…" : "Core offline"}
        </div>
        {connection.state === "connected" && (
          <>
            <div className="pc-card-line">{connection.status.hostname}</div>
            <div className="pc-card-line dim">{connection.status.osVersion}</div>
          </>
        )}
        {heartbeat && (
          <div className="pc-card-line dim">Ligado há {formatDuration(heartbeat.systemUptimeSecs)}</div>
        )}
      </div>
    </aside>
  );
}
