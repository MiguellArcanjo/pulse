import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Eye,
  FileText,
  Flag,
  GitBranch,
  Globe,
  Lightbulb,
  Paperclip,
  Pencil,
  Plus,
  ScanSearch,
  Settings,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type ProjectHome, type ProjectStatus } from "../api";
import { CRITICALITY, TARGET } from "../app/NewProject";
import { EditProjectDialog, LinkRow, ProjectAvatar, STATUS, StatusChip } from "./Projects";
import { ENVIRONMENT, PROJECT_TYPE, relativeTime, SEVERITY } from "../ui/format";

/**
 * Página do projeto aberto (mockup): cabeçalho, abas e a aba "Visão geral" (continue de onde
 * parou, atenção, atividade, resumo, links, tags e ações). Nesta etapa só a "Visão geral" existe;
 * as outras abas aparecem bloqueadas com o motivo, como os itens ainda não refeitos do menu.
 * Nada aqui é inventado: números e listas vêm dos registros reais via /api/projects/:id/home.
 */

type Props = {
  projectId: string;
  goProjects: () => void;
  onOpenInvestigation: (investigationId?: string) => void;
  onNewInvestigation: () => void;
};

/** Abas do mockup. Só "Visão geral" está ativa nesta etapa. */
const TABS: { id: string; reason?: string }[] = [
  { id: "Visão geral" },
  { id: "Assets", reason: "Assets como registro próprio chegam numa próxima etapa. O escopo atual está no resumo." },
  { id: "Endpoints", reason: "Endpoints ainda não existem como entidade. Chegam numa próxima etapa." },
  { id: "Investigações", reason: "Lista de investigações nesta tela: próxima etapa. Por enquanto, use 'Continuar' ou 'Nova investigação'." },
  { id: "Hipóteses", reason: "Hipóteses nesta tela: próxima etapa. Por enquanto, abra pela investigação." },
  { id: "Findings", reason: "Findings nesta tela: próxima etapa. Por enquanto, abra pela investigação." },
  { id: "Notas", reason: "Notas do projeto ainda não existem. Chegam numa próxima etapa." },
  { id: "Arquivos", reason: "Upload e armazenamento de arquivos ainda não existem. Chegam numa próxima etapa." },
  { id: "Configurações", reason: "Use 'Editar projeto' para informações; escopo e autorização têm fluxo próprio." },
];

/** Ícone e cor de cada tipo de evento da atividade recente. */
const EVENT_ICON: Record<string, { icon: LucideIcon; color: string }> = {
  "project.created": { icon: Flag, color: "#8b9cff" },
  "project.updated": { icon: Pencil, color: "#9aa4b8" },
  "investigation.created": { icon: ScanSearch, color: "#4f7cff" },
  "observation.created": { icon: Eye, color: "#38bdf8" },
  "hypothesis.created": { icon: Lightbulb, color: "#c4b5fd" },
  "evidence.created": { icon: FileText, color: "#34d399" },
  "finding.confirmed": { icon: ShieldAlert, color: "#f87171" },
};

export function ProjectView({ projectId, goProjects, onOpenInvestigation, onNewInvestigation }: Props) {
  const [home, setHome] = useState<ProjectHome | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const generation = useRef(0);

  const load = async () => {
    const version = ++generation.current;
    try {
      setError("");
      const data = await api<ProjectHome>(`/projects/${projectId}/home`);
      if (version === generation.current) setHome(data);
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : "Não foi possível carregar o projeto.");
    }
  };
  useEffect(() => {
    setHome(null);
    void load();
    return () => void generation.current++;
  }, [projectId]);

  const setStatus = async (status: ProjectStatus) => {
    try {
      await api(`/projects/${projectId}`, { status }, "PATCH");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível mudar o status.");
    }
  };

  if (error)
    return (
      <div className="error" role="alert">
        {error}
        <button onClick={() => void load()}>Tentar novamente</button>
      </div>
    );
  if (!home) return <p className="loading">Carregando projeto…</p>;

  const p = home.project;
  const url = p.links.site ?? (p.hosts[0] ? `https://${p.hosts[0]}` : undefined);

  return (
    <div className="project-view">
      <header className="pv-header">
        <nav className="crumbs" aria-label="Trilha">
          <button className="link" onClick={goProjects}>
            Projetos
          </button>
          <ChevronRight size={14} className="faint" />
          <span>{p.name}</span>
        </nav>
        <div className="pv-title-row">
          <ProjectAvatar type={p.type} target={p.target} large />
          <div className="pv-title">
            <div className="pv-name">
              <h1>{p.name}</h1>
              <StatusDropdown status={p.status} onStatus={setStatus} />
            </div>
            {url && (
              <a className="pv-url" href={url} target="_blank" rel="noopener noreferrer" title="Abre no navegador do sistema">
                {url.replace(/^https?:\/\//, "")}
                <ArrowRight size={13} />
              </a>
            )}
          </div>
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            <Pencil size={15} /> Editar projeto
          </button>
        </div>
        {p.description && <p className="pv-desc">{p.description}</p>}
        {p.authorizationExpired && <p className="warn">A autorização deste projeto venceu. Novas investigações estão bloqueadas.</p>}

        <div className="pv-tabs" role="tablist" aria-label="Seções do projeto">
          {TABS.map((t) => {
            const active = t.id === "Visão geral";
            return (
              <button key={t.id} role="tab" aria-selected={active} aria-disabled={!active || undefined} title={t.reason} className={active ? "on" : ""}>
                {t.id}
                {!active && <em>em breve</em>}
              </button>
            );
          })}
        </div>
      </header>

      <div className="pv-body">
        <div className="pv-main">
          <ContinueCard home={home} onOpen={onOpenInvestigation} onNew={onNewInvestigation} />
          <Attention home={home} onOpen={onOpenInvestigation} />
          <RecentActivity home={home} onOpen={onOpenInvestigation} />
        </div>

        <aside className="pv-side">
          <section className="pp-card">
            <h2 className="pp-h">Resumo do projeto</h2>
            <dl className="pp-info">
              <dt>Status</dt>
              <dd>
                <StatusChip status={p.status} />
              </dd>
              <dt>Autorização</dt>
              <dd>{PROJECT_TYPE[p.type]}</dd>
              <dt>Tipo de alvo</dt>
              <dd>{p.target ? TARGET[p.target].label : <span className="faint">Não informado</span>}</dd>
              <dt>Ambiente</dt>
              <dd>{ENVIRONMENT[p.environment]}</dd>
              <dt>Criticidade</dt>
              <dd>{p.criticality ? CRITICALITY[p.criticality] : <span className="faint">Não informada</span>}</dd>
              <dt>Criado em</dt>
              <dd>{fullDate(p.createdAt)}</dd>
              <dt>Atualizado em</dt>
              <dd>{relativeTime(p.updatedAt)}</dd>
              <dt>Membros</dt>
              <dd className="members" title="Colaboração ainda não existe: o workspace é de um usuário, local.">
                <span className="avatar xs">Você</span>
                <span className="faint">só você (local)</span>
              </dd>
            </dl>
          </section>

          <section className="pp-card">
            <h2 className="pp-h">Links rápidos</h2>
            <LinkRow icon={<Globe size={16} />} label="Site principal" href={p.links.site} />
            <LinkRow icon={<GitBranch size={16} />} label="Repositório" href={p.links.repository} />
            <LinkRow icon={<BookOpen size={16} />} label="Documentação" href={p.links.docs} />
            {!p.links.site && !p.links.repository && !p.links.docs && (
              <button className="link" onClick={() => setEditing(true)}>
                Adicionar links
              </button>
            )}
          </section>

          <section className="pp-card">
            <h2 className="pp-h">Tags</h2>
            {p.tags.length ? (
              <div className="tag-row">
                {p.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <button className="link" onClick={() => setEditing(true)}>
                Adicionar tags
              </button>
            )}
          </section>

          <section className="pp-card">
            <h2 className="pp-h">Ações rápidas</h2>
            <div className="pv-actions">
              <button onClick={onNewInvestigation} disabled={p.authorizationExpired} title={p.authorizationExpired ? "A autorização venceu." : undefined}>
                <Plus size={16} /> Nova investigação
              </button>
              <button onClick={() => setEditing(true)}>
                <Settings size={16} /> Editar informações
              </button>
              <button aria-disabled="true" title="Notas do projeto ainda não existem.">
                <FileText size={16} /> Adicionar nota <em>em breve</em>
              </button>
              <button aria-disabled="true" title="Upload de arquivos ainda não existe.">
                <Paperclip size={16} /> Upload de arquivo <em>em breve</em>
              </button>
            </div>
          </section>
        </aside>
      </div>

      {editing && <EditProjectDialog project={p} close={() => setEditing(false)} onSaved={load} />}
    </div>
  );
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

/** Dropdown de status no cabeçalho, igual ao "Ativo ⌄" do mockup. */
function StatusDropdown({ status, onStatus }: { status: ProjectStatus; onStatus: (s: ProjectStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`status-chip st-${status.toLowerCase()} as-button`} aria-expanded={open} aria-label="Mudar status" onClick={() => setOpen(!open)}>
        <i className="dot" />
        {STATUS[status]}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <span className="menu-label">Status</span>
          {(Object.keys(STATUS) as ProjectStatus[]).map((s) => (
            <button key={s} role="menuitemradio" aria-checked={status === s} onClick={() => (setOpen(false), onStatus(s))}>
              <span className={`status-chip st-${s.toLowerCase()} bare`}>
                <i className="dot" />
              </span>
              {STATUS[s]}
              {status === s && <em>atual</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContinueCard({ home, onOpen, onNew }: { home: ProjectHome; onOpen: (id?: string) => void; onNew: () => void }) {
  const c = home.continue;
  if (!c)
    return (
      <section className="pv-continue empty">
        <div className="pv-continue-icon">
          <ScanSearch size={22} />
        </div>
        <div>
          <h2>Comece uma investigação</h2>
          <p className="muted">Organize observações, hipóteses e evidências sobre um asset permitido. É daqui que o progresso do projeto nasce.</p>
        </div>
        <button className="btn-primary" onClick={onNew} disabled={home.project.authorizationExpired}>
          <Plus size={16} /> Nova investigação
        </button>
      </section>
    );
  const done = c.stage >= 4;
  return (
    <section className="pv-continue">
      <div className="pv-continue-head">
        <span className={`stage-pill ${done ? "done" : ""}`}>
          <i className="dot" />
          {done ? "Concluída" : "Em andamento"}
        </span>
        <span className="faint small">Última atividade {relativeTime(c.lastActivityAt)}</span>
      </div>
      <button className="pv-continue-title" onClick={() => onOpen(c.investigationId)}>
        {c.title}
        <ArrowRight size={16} />
      </button>
      <p className="pv-continue-sub">
        {c.assetHost} · Etapa atual: {c.stageLabel}
      </p>
      {c.objective && <p className="pv-continue-obj">{c.objective}</p>}
      <div className="pv-continue-progress">
        <span className="bar">
          <span style={{ width: `${c.progress}%` }} />
        </span>
        <em>{c.progress}%</em>
      </div>
      <div className="pv-continue-foot">
        <div className="pv-counts">
          <ContinueCount n={c.observations} label="observações" />
          <ContinueCount n={c.hypotheses} label="hipóteses" />
          <ContinueCount n={c.evidence} label="evidências" />
          <ContinueCount n={c.findings} label="findings" />
        </div>
        <button className="btn-primary" onClick={() => onOpen(c.investigationId)}>
          Continuar investigação <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function ContinueCount({ n, label }: { n: number; label: string }) {
  return (
    <span className="pv-count">
      <strong>{n}</strong>
      <small>{label}</small>
    </span>
  );
}

function Attention({ home, onOpen }: { home: ProjectHome; onOpen: (id?: string) => void }) {
  const items = home.attention;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Atenção {home.attentionTotal > 0 && <span className="count-badge">{home.attentionTotal}</span>}
        </h2>
        {home.attentionTotal > items.length && <span className="faint small">mostrando {items.length} de {home.attentionTotal}</span>}
      </div>
      {items.length === 0 ? (
        <p className="panel-empty muted">Nada pedindo atenção agora. Findings confirmados e hipóteses com confiança informada aparecem aqui.</p>
      ) : (
        items.map((a) => {
          const Icon = a.kind === "finding" ? ShieldCheck : Lightbulb;
          const sevClass = a.kind === "finding" ? `sev-${(a.severity ?? "").toLowerCase()}` : "sev-hypothesis";
          return (
            <button key={`${a.kind}-${a.id}`} className="prio-row" onClick={() => onOpen(a.investigationId)}>
              <span className="att-icon" style={{ background: a.kind === "finding" ? "#ef444422" : "#8b5cf622", color: a.kind === "finding" ? "#f87171" : "#c4b5fd", width: 38, height: 38, borderRadius: 10 }}>
                <Icon size={18} />
              </span>
              <span className="prio-name">
                <strong>{a.title}</strong>
                <small>{a.assetHost} · {a.kind === "finding" ? "Finding confirmado" : "Hipótese aberta"}</small>
              </span>
              {a.kind === "finding" ? (
                <span className={`sev ${sevClass}`}>{SEVERITY[a.severity ?? ""] ?? a.severity}</span>
              ) : a.confidence !== null ? (
                <span className="pct">{a.confidence}%</span>
              ) : (
                <span className="pct faint">—</span>
              )}
              <span className="when faint">{relativeTime(a.lastActivityAt)}</span>
            </button>
          );
        })
      )}
    </section>
  );
}

function RecentActivity({ home, onOpen }: { home: ProjectHome; onOpen: (id?: string) => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Atividade recente</h2>
      </div>
      {home.recent.length === 0 ? (
        <p className="panel-empty muted">Ainda sem atividade neste projeto.</p>
      ) : (
        <ol className="pv-timeline">
          {home.recent.map((e) => {
            const meta = EVENT_ICON[e.kind] ?? { icon: Flag, color: "#9aa4b8" };
            const Icon = meta.icon;
            const clickable = !!e.investigationId;
            return (
              <li key={e.id}>
                <span className="pv-timeline-icon" style={{ color: meta.color, background: `${meta.color}1f` }}>
                  <Icon size={15} />
                </span>
                {clickable ? (
                  <button className="pv-timeline-body link-reset" onClick={() => onOpen(e.investigationId!)}>
                    <span>{e.summary}</span>
                    <small>{relativeTime(e.createdAt)} · usuário local</small>
                  </button>
                ) : (
                  <span className="pv-timeline-body">
                    <span>{e.summary}</span>
                    <small>{relativeTime(e.createdAt)} · usuário local</small>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
