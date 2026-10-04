import type { LucideIcon } from "lucide-react";
import { Activity as ActivityIcon, Cable, Power, PowerOff, Unplug } from "lucide-react";
import type { AuditItem } from "@pulse/protocol";
import { formatTime } from "../format";

const PRINCIPALS: Record<string, string> = {
  system: "Sistema",
  "local:desktop": "Pulse Desktop",
};

const ACTIONS: Record<string, { title: string; icon: LucideIcon }> = {
  "core.started": { title: "Pulse Core iniciado", icon: Power },
  "core.stopped": { title: "Pulse Core encerrado", icon: PowerOff },
  "ipc.client_connected": { title: "Conexão local aberta", icon: Cable },
  "ipc.client_disconnected": { title: "Conexão local encerrada", icon: Unplug },
};

const RESULTS: Record<string, string> = { ok: "OK", error: "Erro", denied: "Negado" };

const MAX_ROWS = 6;

export function Activity({ items }: { items: AuditItem[] }) {
  return (
    <section className="panel" aria-labelledby="activity-title">
      <header className="panel-header">
        <h2 id="activity-title">Atividade recente</h2>
        <span className="panel-meta">log de auditoria</span>
      </header>
      {items.length === 0 ? (
        <p className="empty">Nenhuma atividade registrada ainda.</p>
      ) : (
        <ul className="activity">
          {items.slice(0, MAX_ROWS).map((item) => {
            const known = ACTIONS[item.action];
            const Icon = known?.icon ?? ActivityIcon;
            return (
              <li key={item.id} className="activity-row">
                <span className="activity-icon">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="activity-time">{formatTime(item.tsMs, false)}</span>
                <span className="activity-text">
                  <span className="activity-title">{known?.title ?? item.action}</span>
                  <span className="activity-sub">
                    {PRINCIPALS[item.principal] ?? item.principal} · {item.permissionLevel}
                  </span>
                </span>
                <span className={`badge badge-${item.result}`}>{RESULTS[item.result] ?? item.result}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
