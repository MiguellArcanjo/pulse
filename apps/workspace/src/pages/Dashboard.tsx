import {
  ArrowRight,
  Building,
  ChevronRight,
  CircleCheck,
  Clock,
  FileSearch,
  FlaskConical,
  Folder,
  Hexagon,
  Lightbulb,
  Plus,
  ScanSearch,
  ShieldCheck,
  Swords,
  TriangleAlert,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Dashboard as Data } from "../api";
import { Sparkline } from "../ui/Sparkline";
import { ENVIRONMENT, greeting, longDate, plural, PROJECT_TYPE, relativeTime, SEVERITY } from "../ui/format";

/**
 * Painel inicial (mockup "HackerBot"). Cada número sai dos registros do workspace; o que ainda
 * não existe (resumo por IA) aparece desativado e explicado.
 */
type Props = {
  data: Data;
  newProject: () => void;
  openProject: (projectId: string, investigationId?: string | null) => void;
  goProjects: () => void;
};

const COLORS = { blue: "#4f7cff", violet: "#8b5cf6", green: "#22c55e", red: "#ef4444", orange: "#f97316", amber: "#f59e0b" };

function TypeIcon({ type }: { type: string }) {
  const icon = { BUG_BOUNTY: <Swords size={18} />, LAB: <FlaskConical size={18} />, CTF: <FlaskConical size={18} />, AUTHORIZED_PROJECT: <User size={18} />, OWN_PROJECT: <Building size={18} /> }[type];
  return <span className="tile-avatar">{icon ?? <Folder size={18} />}</span>;
}

export function Dashboard({ data, newProject, openProject, goProjects }: Props) {
  const now = new Date();
  const name = data.displayName ? `, ${data.displayName}` : "";
  const a = data.attention;
  const needs = a.hypothesesWithEvidence + a.idleInvestigations + a.expiringAuthorizations + a.findingsToReport;

  return (
    <div className="dash">
      <div className="dash-main">
        <div className="dash-hello">
          <div>
            <h1>
              {greeting(now)}
              {name}.
            </h1>
            <p className="muted">Aqui está o resumo das suas investigações.</p>
          </div>
          <div className="hello-right">
            <span className="faint">{longDate(now)}</span>
            <button className="btn-primary" onClick={newProject}>
              <Plus size={17} /> Novo projeto
            </button>
          </div>
        </div>

        <section className={`attention ${needs ? "" : "calm"}`} aria-label="Precisa da sua atenção">
          <div className="attention-head">
            <span className="attention-icon">{needs ? <TriangleAlert size={22} /> : <CircleCheck size={22} />}</span>
            <div>
              <h2>{needs ? "Precisa da sua atenção" : "Tudo em dia"}</h2>
              <p className="muted">{needs ? "Existem itens que precisam da sua revisão." : "Nenhuma hipótese aguardando decisão, investigação parada ou autorização vencendo."}</p>
            </div>
            {needs > 0 && (
              <button className="btn-ghost" onClick={goProjects}>
                Ver projetos <ArrowRight size={15} />
              </button>
            )}
          </div>
          {needs > 0 && (
            <div className="attention-grid">
              <Attention color={COLORS.orange} icon={<Lightbulb size={20} />} n={a.hypothesesWithEvidence} one="hipótese" other="hipóteses" hint="com evidência, aguardando decisão" />
              <Attention color={COLORS.violet} icon={<ScanSearch size={20} />} n={a.idleInvestigations} one="investigação" other="investigações" hint="sem atividade há 7+ dias" />
              <Attention color={COLORS.green} icon={<FileSearch size={20} />} n={a.findingsToReport} one="finding" other="findings" hint="confirmado(s), prontos para relatório" />
              <Attention color={COLORS.red} icon={<TriangleAlert size={20} />} n={a.expiringAuthorizations} one="autorização" other="autorizações" hint="vencendo em 14 dias ou vencida" />
            </div>
          )}
        </section>

        <div className="stats">
          <Stat color={COLORS.blue} icon={<Folder size={20} />} label="Projetos" value={data.totals.projects} delta={plural(data.totals.activeProjects, "ativo", "ativos")} series={data.series.projects} />
          <Stat color={COLORS.violet} icon={<ScanSearch size={20} />} label="Investigações" value={data.totals.investigations} delta={`${data.totals.activeInvestigations} em andamento`} series={data.series.investigations} />
          <Stat color={COLORS.green} icon={<Lightbulb size={20} />} label="Hipóteses" value={data.totals.hypotheses} delta={`${data.totals.newHypotheses} nos últimos 7 dias`} series={data.series.hypotheses} />
          <Stat color={COLORS.red} icon={<TriangleAlert size={20} />} label="Findings" value={data.totals.findings} delta={`${data.totals.highFindings} alto/crítico`} series={data.series.findings} alert={data.totals.highFindings > 0} />
        </div>
      </div>

      <aside className="bot-panel">
        <div className="bot-head">
          <span className="brand-mark small">
            <Hexagon size={18} strokeWidth={2.2} />
          </span>
          <strong>HackerBot</strong>
          <span className="beta">Beta</span>
        </div>
        <p className="faint">{data.sinceLastVisit ? "Desde sua última visita:" : "Bem-vindo! Na próxima visita, aqui aparece o que mudou."}</p>
        {data.sinceLastVisit && (
          <ul className="bot-list">
            <li>
              <Lightbulb size={16} /> {plural(data.sinceLastVisit.hypotheses, "nova hipótese registrada", "novas hipóteses registradas")}
            </li>
            <li>
              <ScanSearch size={16} /> {plural(data.sinceLastVisit.investigationsUpdated, "investigação teve atualizações", "investigações tiveram atualizações")}
            </li>
            <li>
              <FileSearch size={16} /> {plural(data.sinceLastVisit.evidence, "evidência registrada", "evidências registradas")}
            </li>
            <li>
              <ShieldCheck size={16} /> {plural(data.sinceLastVisit.findings, "finding confirmado", "findings confirmados")}
            </li>
          </ul>
        )}
        <button className="btn-bot" disabled title="O resumo escrito pela IA chega com o Investigador IA.">
          Ver resumo completo <ArrowRight size={15} />
        </button>
        <small className="faint">Resumo por IA chega com o Investigador IA.</small>
      </aside>

      <section className="panel investigations">
        <PanelHead title="Investigações em andamento" action={goProjects} />
        {data.investigations.length === 0 ? (
          <Empty text="Nenhuma investigação ainda. Crie uma dentro de um projeto." />
        ) : (
          data.investigations.map((i) => (
            <button key={i.id} className="inv-row" onClick={() => openProject(i.projectId, i.id)}>
              <TypeIcon type={i.projectType} />
              <span className="inv-name">
                <strong>{i.projectName}</strong>
                <small>
                  {i.title} · {i.assetHost}
                </small>
              </span>
              <span className="chips">
                <span className={`chip env-${i.environment.toLowerCase()}`}>{ENVIRONMENT[i.environment]}</span>
                <span className="chip type">{PROJECT_TYPE[i.projectType]}</span>
              </span>
              <span className="stage" title={`Etapa ${i.stage} de 4: ${i.stageLabel}`}>
                <span className="bar">
                  <span style={{ width: `${(i.stage / 4) * 100}%` }} />
                </span>
                <em>{i.stageLabel}</em>
              </span>
              <span className="faint when">{relativeTime(i.lastActivityAt, now)}</span>
              <span className="round">
                <ChevronRight size={16} />
              </span>
            </button>
          ))
        )}
      </section>

      <section className="panel priorities">
        <PanelHead title="Prioridades" subtitle="(hipóteses e findings)" action={goProjects} />
        {data.priorities.length === 0 ? (
          <Empty text="Sem hipóteses abertas ou findings." />
        ) : (
          data.priorities.map((p) => (
            <button key={p.id} className="prio-row" onClick={() => openProject(p.projectId, p.investigationId)}>
              {p.kind === "finding" ? (
                <span className={`sev sev-${(p.severity ?? "").toLowerCase()}`}>{SEVERITY[p.severity ?? ""] ?? p.severity}</span>
              ) : (
                <span className="sev sev-hypothesis">Hipótese</span>
              )}
              <span className="prio-name">
                <strong>{p.title}</strong>
                <small>{p.assetHost}</small>
              </span>
              <span className={`pct ${p.kind}`} title={p.kind === "finding" ? "Finding confirmado com evidências" : "Confiança informada por você"}>
                {p.kind === "finding" ? "Finding" : p.confidence === null ? "—" : `${p.confidence}%`}
              </span>
              <span className="round">
                <ChevronRight size={16} />
              </span>
            </button>
          ))
        )}
      </section>

      <section className="panel projects">
        <PanelHead title="Projetos" action={goProjects} />
        {data.projects.length === 0 ? (
          <Empty text="Nenhum projeto ainda." />
        ) : (
          <div className="project-cards">
            {data.projects.map((p) => (
              <button key={p.id} className="project-card" onClick={() => openProject(p.id)}>
                <div className="pc-head">
                  <TypeIcon type={p.type} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.host}</small>
                  </span>
                </div>
                <span className={`status ${p.status}`}>
                  <i className="dot" />
                  {{ active: "Ativo", idle: "Sem atividade recente", expired: "Autorização vencida" }[p.status]}
                </span>
                <div className="pc-counts">
                  <span>
                    <strong>{p.hostsInScope}</strong>
                    <small>{p.hostsInScope === 1 ? "host no escopo" : "hosts no escopo"}</small>
                  </span>
                  <span>
                    <strong>{p.findings}</strong>
                    <small>findings</small>
                  </span>
                  <span>
                    <strong>{p.hypotheses}</strong>
                    <small>hipóteses</small>
                  </span>
                </div>
                <Sparkline values={p.activity} color={p.status === "active" ? COLORS.blue : "#64748b"} width={180} height={26} />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel recent">
        <PanelHead title="Atividade recente" action={goProjects} />
        {data.recent.length === 0 ? (
          <Empty text="Nada registrado ainda." />
        ) : (
          data.recent.map((e) => (
            <button key={e.id} className="act-row" onClick={() => openProject(e.projectId, e.investigationId)}>
              <ActIcon kind={e.kind} />
              <span className="act-name">
                <strong>{e.summary}</strong>
                <small>{e.projectName}</small>
              </span>
              <span className="faint when">{relativeTime(e.createdAt, now)}</span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}

function Attention({ color, icon, n, one, other, hint }: { color: string; icon: ReactNode; n: number; one: string; other: string; hint: string }) {
  return (
    <div className={`att ${n ? "" : "zero"}`}>
      <span className="att-icon" style={{ color, backgroundColor: `${color}22` }}>
        {icon}
      </span>
      <span>
        <strong>{n}</strong>
        <span className="att-label">{n === 1 ? one : other}</span>
        <small>{hint}</small>
      </span>
    </div>
  );
}

function Stat({ color, icon, label, value, delta, series, alert = false }: { color: string; icon: ReactNode; label: string; value: number; delta: string; series: number[]; alert?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-icon" style={{ color, backgroundColor: `${color}1f` }}>
        {icon}
      </span>
      <span className="stat-body">
        <small>{label}</small>
        <strong>{value}</strong>
        <em className={alert ? "alert" : ""}>{delta}</em>
      </span>
      <Sparkline values={series} color={color} width={56} />
    </div>
  );
}

function PanelHead({ title, subtitle, action }: { title: string; subtitle?: string; action: () => void }) {
  return (
    <div className="panel-head">
      <h2>
        {title} {subtitle && <span className="faint">{subtitle}</span>}
      </h2>
      <button className="link" onClick={action}>
        Ver todos <ArrowRight size={14} />
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="panel-empty faint">{text}</p>;
}

function ActIcon({ kind }: { kind: string }) {
  const map: Record<string, [ReactNode, string]> = {
    "project.created": [<Folder size={16} />, COLORS.blue],
    "investigation.created": [<ScanSearch size={16} />, COLORS.violet],
    "observation.created": [<Clock size={16} />, "#94a3b8"],
    "hypothesis.created": [<Lightbulb size={16} />, COLORS.orange],
    "evidence.created": [<FileSearch size={16} />, COLORS.green],
    "finding.confirmed": [<ShieldCheck size={16} />, COLORS.red],
  };
  const [icon, color] = map[kind] ?? [<Clock size={16} />, "#94a3b8"];
  return (
    <span className="act-icon" style={{ color, backgroundColor: `${color}22` }}>
      {icon}
    </span>
  );
}
