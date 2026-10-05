import type { LucideIcon } from "lucide-react";
import {
  Activity as ActivityIcon,
  Ban,
  Cable,
  Camera,
  CheckCircle2,
  KeyRound,
  Lock,
  Moon,
  Play,
  Power,
  PowerOff,
  QrCode,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Trash2,
  Unplug,
  XCircle,
} from "lucide-react";
import type { AuditItem } from "@pulse/protocol";
import { formatTime } from "../format";

const PRINCIPALS: Record<string, string> = {
  system: "Sistema",
  "local:desktop": "Pulse Desktop",
  "remote:pairing": "iPhone (pareamento)",
};

const ACTIONS: Record<string, { title: string; icon: LucideIcon }> = {
  "core.started": { title: "Pulse Core iniciado", icon: Power },
  "core.stopped": { title: "Pulse Core encerrado", icon: PowerOff },
  "ipc.client_connected": { title: "Conexão local aberta", icon: Cable },
  "ipc.client_disconnected": { title: "Conexão local encerrada", icon: Unplug },
  "pairing.created": { title: "QR de pareamento gerado", icon: QrCode },
  "pairing.claimed": { title: "iPhone leu o QR", icon: Smartphone },
  "pairing.claim_rejected": { title: "Pareamento com prova inválida", icon: ShieldX },
  "pairing.denied": { title: "Pareamento recusado", icon: Ban },
  "device.paired": { title: "Dispositivo autorizado", icon: Smartphone },
  "device.revoked": { title: "Acesso de dispositivo revogado", icon: ShieldX },
  "device.grants_changed": { title: "Permissões alteradas", icon: KeyRound },
  "pairing.code_rejected": { title: "Código de pareamento errado", icon: ShieldX },
  "control.app.launch": { title: "App aberto", icon: Play },
  "control.app.close": { title: "App fechado", icon: XCircle },
  "control.process.kill": { title: "Processo encerrado", icon: XCircle },
  "control.screenshot": { title: "Screenshot", icon: Camera },
  "control.power.lock": { title: "PC bloqueado", icon: Lock },
  "control.power.suspend": { title: "PC suspenso", icon: Moon },
  "control.power.restart": { title: "Reinício do PC", icon: RotateCcw },
  "control.power.shutdown": { title: "Desligamento do PC", icon: Power },
  "control.allowed_app.added": { title: "App permitido no iPhone", icon: CheckCircle2 },
  "control.allowed_app.removed": { title: "App removido da lista", icon: Trash2 },
  "security.lockdown.enable": { title: "Lockdown ativado", icon: ShieldAlert },
  "security.policy_changed": { title: "Segurança alterada", icon: ShieldCheck },
};

function principalLabel(p: string): string {
  if (PRINCIPALS[p]) return PRINCIPALS[p];
  if (p.startsWith("device:")) return "iPhone";
  return p;
}

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
                    {principalLabel(item.principal)} · {item.permissionLevel}
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
