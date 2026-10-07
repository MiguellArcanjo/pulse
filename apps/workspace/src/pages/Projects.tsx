import {
  ArrowRight,
  BookOpen,
  Building,
  Code,
  Ellipsis,
  ExternalLink,
  FlaskConical,
  Folder,
  Funnel,
  GitBranch,
  Globe,
  LayoutGrid,
  Lightbulb,
  List,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Swords,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ProjectCriticality, type ProjectLinks, type ProjectOverview, type ProjectStatus, type ProjectTarget } from "../api";
import { CRITICALITY, TARGET } from "../app/NewProject";
import { DetailsFields, detailsData, FormDialog } from "../forms";
import { ProgressChart, ProgressRing } from "../ui/charts";
import { ENVIRONMENT, PROJECT_TYPE, relativeTime } from "../ui/format";

/**
 * Página Projetos (mockup): filtros por status, grade/lista, busca, cartões e painel de detalhes.
 * Status, descrição, tags e links são do usuário; números e progresso vêm dos registros.
 */

export const STATUS: Record<ProjectStatus, string> = { ACTIVE: "Ativo", ANALYSIS: "Em análise", PAUSED: "Pausado", DONE: "Concluído" };
const STATUS_TABS: { id: ProjectStatus | "ALL"; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "ACTIVE", label: "Ativos" },
  { id: "ANALYSIS", label: "Em análise" },
  { id: "PAUSED", label: "Pausados" },
  { id: "DONE", label: "Concluídos" },
];

export function ProjectAvatar({ type, target = null, large = false }: { type: string; target?: ProjectTarget | null; large?: boolean }) {
  const s = large ? 22 : 20;
  // Tipo de alvo (projetos novos) tem prioridade; projetos antigos usam o tipo de autorização.
  const byTarget = target ? { WEB: <Globe size={s} />, API: <Code size={s} />, MOBILE: <Smartphone size={s} />, INFRA: <Server size={s} />, OTHER: null }[target] : null;
  const icon = byTarget ?? { BUG_BOUNTY: <Swords size={s} />, LAB: <FlaskConical size={s} />, CTF: <FlaskConical size={s} />, AUTHORIZED_PROJECT: <User size={s} />, OWN_PROJECT: <Building size={s} /> }[type];
  return <span className={`tile-avatar ${large ? "lg" : ""}`}>{icon ?? <Folder size={s} />}</span>;
}

export function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-chip st-${status.toLowerCase()}`}>
      <i className="dot" />
      {STATUS[status]}
    </span>
  );
}

function Tags({ p, max = 4 }: { p: ProjectOverview; max?: number }) {
  const extra = p.tags.slice(0, max);
  return (
    <div className="tag-row">
      <span className={`chip env-${p.environment.toLowerCase()}`}>{ENVIRONMENT[p.environment]}</span>
      <span className="chip type">{PROJECT_TYPE[p.type]}</span>
      {p.criticality && (
        <span className={`crit-chip crit-${p.criticality.toLowerCase()}`} title="Criticidade">
          <i className="dot" />
          {CRITICALITY[p.criticality]}
        </span>
      )}
      {extra.map((t) => (
        <span key={t} className="chip">
          {t}
        </span>
      ))}
      {p.tags.length > max && <span className="chip faint">+{p.tags.length - max}</span>}
    </div>
  );
}

/** Menu "⋯": status, editar informações, abrir. */
export function ProjectMenu({ status, onStatus, onEdit, onOpen }: { status: ProjectStatus; onStatus: (s: ProjectStatus) => void; onEdit: () => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-button small" aria-label="Ações do projeto" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={17} />
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
          <hr />
          <button role="menuitem" onClick={() => (setOpen(false), onEdit())}>
            Editar informações
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), onOpen())}>
            Abrir projeto
          </button>
        </div>
      )}
    </div>
  );
}

export function Projects({ openProject, newProject, refreshKey }: { openProject: (id: string) => void; newProject: () => void; refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectOverview[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ProjectStatus | "ALL">("ALL");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectOverview | null>(null);

  const load = async () => {
    try {
      setError("");
      const r = await api<{ projects: ProjectOverview[] }>("/projects-overview");
      // Mais recentes primeiro (última atividade registrada).
      setProjects([...r.projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
      setSelected((cur) => (cur && r.projects.some((p) => p.id === cur) ? cur : [...r.projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar os projetos.");
    }
  };
  useEffect(() => {
    void load();
  }, [refreshKey]);

  const setStatus = async (id: string, status: ProjectStatus) => {
    try {
      await api(`/projects/${id}`, { status }, "PATCH");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível mudar o status.");
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: projects?.length ?? 0 };
    for (const p of projects ?? []) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [projects]);

  const visible = (projects ?? []).filter((p) => {
    if (tab !== "ALL" && p.status !== tab) return false;
    if (types.length && !types.includes(p.type)) return false;
    if (envs.length && !envs.includes(p.environment)) return false;
    const text = `${p.name} ${p.hosts.join(" ")} ${p.description ?? ""} ${p.tags.join(" ")}`.toLowerCase();
    return text.includes(q.trim().toLowerCase());
  });
  const current = projects?.find((p) => p.id === selected) ?? null;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="projects-page">
      <div className="projects-main">
        <div className="page-head">
          <div>
            <h1>Projetos</h1>
            <p className="muted">Organize suas pesquisas e acompanhe o progresso de cada alvo.</p>
          </div>
          <button className="btn-primary" onClick={newProject}>
            <Plus size={17} /> Novo projeto
          </button>
        </div>

        <div className="toolbar">
          <div className="seg" role="tablist" aria-label="Filtrar por status">
            {STATUS_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label} <span>{counts[t.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <div className="view-toggle">
              <button className={view === "grid" ? "on" : ""} aria-label="Ver em grade" onClick={() => setView("grid")}>
                <LayoutGrid size={16} />
              </button>
              <button className={view === "list" ? "on" : ""} aria-label="Ver em lista" onClick={() => setView("list")}>
                <List size={16} />
              </button>
            </div>
            <label className="small-search">
              <Search size={15} className="faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar projetos…" aria-label="Buscar projetos" />
            </label>
            <div className="menu">
              <button className={`filters-btn ${types.length + envs.length ? "active" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
                <Funnel size={15} /> Filtros{types.length + envs.length ? ` (${types.length + envs.length})` : ""}
              </button>
              {filtersOpen && (
                <div className="menu-pop right filters">
                  <span className="menu-label">Tipo</span>
                  {Object.entries(PROJECT_TYPE).map(([k, v]) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={types.includes(k)} onChange={() => setTypes(toggle(types, k))} />
                      {v}
                    </label>
                  ))}
                  <span className="menu-label">Ambiente</span>
                  {Object.entries(ENVIRONMENT).map(([k, v]) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={envs.includes(k)} onChange={() => setEnvs(toggle(envs, k))} />
                      {v}
                    </label>
                  ))}
                  <button className="link" onClick={() => (setTypes([]), setEnvs([]))}>
                    Limpar filtros
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => void load()}>Tentar novamente</button>
          </div>
        )}
        {!projects && !error && <p className="loading">Carregando projetos…</p>}
        {projects && projects.length === 0 && (
          <div className="empty-big">
            <h2>Nenhum projeto ainda</h2>
            <p className="muted">Comece pela autorização e pelo escopo do programa ou do seu projeto.</p>
            <button className="btn-primary" onClick={newProject}>
              <Plus size={17} /> Criar primeiro projeto
            </button>
          </div>
        )}
        {projects && projects.length > 0 && visible.length === 0 && <p className="muted">Nenhum projeto com esses filtros.</p>}

        {view === "grid" ? (
          <div className="project-grid">
            {visible.map((p) => (
              <article
                key={p.id}
                className={`pcard st-${p.status.toLowerCase()} ${p.id === selected ? "selected" : ""}`}
                onClick={() => setSelected(p.id)}
                onDoubleClick={() => openProject(p.id)}
              >
                <div className="pcard-cover">
                  <StatusChip status={p.status} />
                  <ProjectMenu status={p.status} onStatus={(s) => void setStatus(p.id, s)} onEdit={() => setEditing(p)} onOpen={() => openProject(p.id)} />
                </div>
                <div className="pcard-body">
                  <div className="pcard-title">
                    <ProjectAvatar type={p.type} target={p.target} large />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.hosts[0]}</small>
                    </span>
                  </div>
                  <p className="pcard-desc">{p.description ?? <span className="faint">Sem descrição.</span>}</p>
                  <Tags p={p} max={2} />
                  <div className="pcard-counts">
                    <Count icon={<Globe size={16} />} n={p.assets} label={p.assets === 1 ? "Asset" : "Assets"} />
                    <Count icon={<Lightbulb size={16} />} n={p.hypotheses} label={p.hypotheses === 1 ? "Hipótese" : "Hipóteses"} />
                    <Count icon={<ShieldCheck size={16} />} n={p.findings} label={p.findings === 1 ? "Finding" : "Findings"} danger={p.findings > 0} />
                  </div>
                  <div className="pcard-progress" title="Média das etapas das investigações">
                    <span className="bar">
                      <span style={{ width: `${p.progress}%` }} />
                    </span>
                    <em>{p.progress}%</em>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="project-table panel">
            <div className="pt-head">
              <span>Projeto</span>
              <span>Status</span>
              <span>Assets</span>
              <span>Hipóteses</span>
              <span>Findings</span>
              <span>Progresso</span>
              <span>Atualizado</span>
            </div>
            {visible.map((p) => (
              <button key={p.id} className={`pt-row ${p.id === selected ? "selected" : ""}`} onClick={() => setSelected(p.id)} onDoubleClick={() => openProject(p.id)}>
                <span className="pt-name">
                  <ProjectAvatar type={p.type} target={p.target} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.hosts[0]}</small>
                  </span>
                </span>
                <StatusChip status={p.status} />
                <span>{p.assets}</span>
                <span>{p.hypotheses}</span>
                <span>{p.findings}</span>
                <span className="pcard-progress">
                  <span className="bar">
                    <span style={{ width: `${p.progress}%` }} />
                  </span>
                  <em>{p.progress}%</em>
                </span>
                <span className="faint">{relativeTime(p.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {current && (
        <ProjectPanel p={current} onOpen={() => openProject(current.id)} onStatus={(s) => void setStatus(current.id, s)} onEdit={() => setEditing(current)} />
      )}

      {editing && <EditProjectDialog project={editing} close={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

/** Editar informações descritivas (tipo de alvo, criticidade, descrição, tags, links). Escopo e autorização não passam aqui. */
export function EditProjectDialog({
  project,
  close,
  onSaved,
}: {
  project: { id: string; name: string; target: ProjectTarget | null; criticality: ProjectCriticality | null; description: string | null; tags: string[]; links: ProjectLinks };
  close: () => void;
  onSaved: () => void | Promise<void>;
}) {
  return (
    <FormDialog
      title={`Editar informações · ${project.name}`}
      close={close}
      save={async (f) => {
        const target = f.get("target");
        await api(`/projects/${project.id}`, { ...detailsData(f, true), criticality: f.get("criticality"), ...(target ? { target } : {}) }, "PATCH");
        await onSaved();
      }}
    >
      <p className="muted">Escopo e autorização não mudam por aqui.</p>
      <div className="columns">
        <label>
          Tipo de alvo
          <select name="target" defaultValue={project.target ?? ""}>
            {!project.target && <option value="">Não informado</option>}
            {(Object.keys(TARGET) as ProjectTarget[]).map((t) => (
              <option key={t} value={t}>
                {TARGET[t].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Criticidade
          <select name="criticality" defaultValue={project.criticality ?? "MEDIUM"}>
            {(Object.keys(CRITICALITY) as ProjectCriticality[]).map((c) => (
              <option key={c} value={c}>
                {CRITICALITY[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DetailsFields initial={project} />
    </FormDialog>
  );
}

function Count({ icon, n, label, danger = false }: { icon: ReactNode; n: number; label: string; danger?: boolean }) {
  return (
    <span className={`count ${danger ? "danger" : ""}`}>
      {icon}
      <span>
        <strong>{n}</strong>
        <small>{label}</small>
      </span>
    </span>
  );
}

const PANEL_TABS = ["Visão geral", "Assets", "Endpoints", "Investigações", "Hipóteses", "Findings"] as const;

function ProjectPanel({ p, onOpen, onStatus, onEdit }: { p: ProjectOverview; onOpen: () => void; onStatus: (s: ProjectStatus) => void; onEdit: () => void }) {
  const [tab, setTab] = useState<(typeof PANEL_TABS)[number]>("Visão geral");
  useEffect(() => setTab("Visão geral"), [p.id]);
  const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
  return (
    <aside className="project-panel">
      <div className="pp-card">
        <div className="pp-head">
          <ProjectAvatar type={p.type} target={p.target} large />
          <span className="pp-title">
            <strong>{p.name}</strong>
            <small>{p.links.site ?? p.hosts[0]}</small>
          </span>
          <StatusChip status={p.status} />
          <ProjectMenu status={p.status} onStatus={onStatus} onEdit={onEdit} onOpen={onOpen} />
        </div>
        {p.description && <p className="pp-desc">{p.description}</p>}
        <Tags p={p} max={6} />
        <div className="pp-tabs" role="tablist">
          {PANEL_TABS.map((t) => {
            const disabled = t === "Endpoints";
            return (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                aria-disabled={disabled || undefined}
                title={disabled ? "Endpoints ainda não existem como registro. Chegam numa próxima etapa." : t === "Investigações" || t === "Hipóteses" || t === "Findings" ? "Abre o projeto" : undefined}
                className={tab === t ? "on" : ""}
                onClick={() => {
                  if (disabled) return;
                  if (t === "Investigações" || t === "Hipóteses" || t === "Findings") onOpen();
                  else setTab(t);
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        {tab === "Visão geral" ? (
          <div className="pp-stats">
            <Tile n={p.assets} label="Assets" color="#4f7cff" icon={<Globe size={17} />} />
            <Tile n={p.hypotheses} label="Hipóteses" color="#8b5cf6" icon={<Lightbulb size={17} />} />
            <Tile n={p.findings} label="Findings" color="#ef4444" icon={<ShieldCheck size={17} />} />
            <div className="pp-tile ring-tile" title="Média das etapas das investigações">
              <ProgressRing value={p.progress} size={58} />
              <small>Progresso</small>
            </div>
          </div>
        ) : (
          <div className="pp-assets">
            <span className="menu-label">No escopo (hosts exatos)</span>
            {p.hosts.map((h) => (
              <code key={h}>{h}</code>
            ))}
            <small className="faint">Escopo e proibições completas ficam em "Autorização e escopo", dentro do projeto.</small>
          </div>
        )}
      </div>

      <div className="pp-card">
        <div className="panel-head">
          <h2>Progresso da investigação</h2>
          <span className="faint small">Últimos 30 dias</span>
        </div>
        <ProgressChart series={p.series} />
      </div>

      <div className="pp-card">
        <h2 className="pp-h">Informações</h2>
        <dl className="pp-info">
          <dt>Autorização</dt>
          <dd>{PROJECT_TYPE[p.type]}</dd>
          <dt>Tipo de alvo</dt>
          <dd>{p.target ? TARGET[p.target].label : <span className="faint">Não informado</span>}</dd>
          <dt>Criticidade</dt>
          <dd>{p.criticality ? CRITICALITY[p.criticality] : <span className="faint">Não informada</span>}</dd>
          <dt>Status</dt>
          <dd>
            <StatusChip status={p.status} />
          </dd>
          <dt>Criado em</dt>
          <dd>{date(p.createdAt)}</dd>
          <dt>Atualizado em</dt>
          <dd>{date(p.updatedAt)}</dd>
          <dt>Investigações</dt>
          <dd>{p.investigations}</dd>
          <dt>Membros</dt>
          <dd className="members" title="Colaboração ainda não existe: o workspace é de um usuário, local.">
            <span className="avatar xs">Você</span>
            <span className="faint">só você (local)</span>
          </dd>
        </dl>
        {p.authorizationExpired && <p className="warn">A autorização deste projeto venceu. Novas investigações estão bloqueadas.</p>}
      </div>

      <div className="pp-card">
        <h2 className="pp-h">Links</h2>
        <LinkRow icon={<Globe size={16} />} label="Site principal" href={p.links.site} />
        <LinkRow icon={<GitBranch size={16} />} label="Repositório" href={p.links.repository} />
        <LinkRow icon={<BookOpen size={16} />} label="Documentação" href={p.links.docs} />
        {!p.links.site && !p.links.repository && !p.links.docs && (
          <button className="link" onClick={onEdit}>
            Adicionar links
          </button>
        )}
      </div>

      <button className="btn-open" onClick={onOpen}>
        Abrir projeto <ArrowRight size={16} />
      </button>
    </aside>
  );
}

function Tile({ n, label, color, icon }: { n: number; label: string; color: string; icon: ReactNode }) {
  return (
    <div className="pp-tile">
      <span style={{ color }}>{icon}</span>
      <strong style={{ color }}>{n}</strong>
      <small>{label}</small>
    </div>
  );
}

export function LinkRow({ icon, label, href }: { icon: ReactNode; label: string; href: string | undefined }) {
  return (
    <div className={`link-row ${href ? "" : "none"}`}>
      {icon}
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title="Abre no navegador do sistema">
          {href.replace(/^https?:\/\//, "")}
          <ExternalLink size={14} />
        </a>
      ) : (
        <span className="faint">não informado</span>
      )}
    </div>
  );
}
