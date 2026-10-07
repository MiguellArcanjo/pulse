import { useEffect, useRef, useState } from "react";
import { api, type Entry, type Finding, type Project, type Snapshot } from "../api";
import { EntryFields, FindingFields, FormDialog, InvestigationFields, value } from "../forms";
import { NewProjectWizard } from "../app/NewProject";

type Tab = "OBSERVATION" | "HYPOTHESIS" | "EVIDENCE" | "FINDING" | "HISTORY";
const labels: Record<Tab, string> = { OBSERVATION: "Observações", HYPOTHESIS: "Hipóteses", EVIDENCE: "Evidências", FINDING: "Findings", HISTORY: "Histórico" };
const environment: Record<string, string> = { PRODUCTION: "Produção", STAGING: "Staging", LOCAL: "Local" };
const singular = { OBSERVATION: "Nova observação", HYPOTHESIS: "Nova hipótese", EVIDENCE: "Nova evidência", FINDING: "Confirmar finding", HISTORY: "" };
/** Página Projetos: escopo, investigações, registros e findings de um projeto. */
export function Workspace({ initialProjectId, initialInvestigationId, openNewInvestigation, onChanged }: { initialProjectId?: string | undefined; initialInvestigationId?: string | undefined; openNewInvestigation?: boolean | undefined; onChanged?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [investigationId, setInvestigationId] = useState(initialInvestigationId ?? "");
  const [tab, setTab] = useState<Tab>("OBSERVATION");
  // Vindo de "Nova investigação" na visão geral, já abre o formulário de nova investigação.
  const [modal, setModal] = useState<"project" | "investigation" | "entry" | "finding" | null>(openNewInvestigation ? "investigation" : null);
  const [detail, setDetail] = useState<Entry | Finding | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar.");
  async function listProjects() { const data = await api<{ projects: Project[] }>("/projects"); setProjects(data.projects); return data.projects; }
  useEffect(() => { void listProjects().then(p => setProjectId(current => current && p.some(x => x.id === current) ? current : p[0]?.id ?? "")).catch(fail).finally(() => setLoading(false)); }, []);
  async function refresh(id = projectId) {
    const version = ++generation.current;
    const data = await api<Snapshot>(`/projects/${id}`);
    if (version !== generation.current) return;
    setSnapshot(data);
    onChanged?.();
    setInvestigationId(current => data.investigations.some(i => i.id === current) ? current : data.investigations[0]?.id ?? "");
  }
  useEffect(() => {
    setSnapshot(null); setDetail(null); setScopeOpen(false); setError("");
    if (projectId) { setLoading(true); void refresh(projectId).catch(fail).finally(() => setLoading(false)); }
    return () => { generation.current++; };
  }, [projectId]);
  const investigation = snapshot?.investigations.find(i => i.id === investigationId);
  const entries = snapshot?.entries.filter(e => e.investigationId === investigationId) ?? [];
  const findings = snapshot?.findings.filter(f => f.investigationId === investigationId) ?? [];
  const visible: (Entry | Finding)[] = (tab === "FINDING" ? findings : entries.filter(e => e.kind === tab)).filter(e => `${e.title} ${"content" in e ? e.content : e.impact}`.toLowerCase().includes(query.toLowerCase()));
  async function saveEntry(f: FormData) {
    await api(`/projects/${projectId}/investigations/${investigationId}/entries`, { kind: tab, title: value(f, "title"), content: value(f, "content"), source: value(f, "source"), relatedIds: value(f, "relatedId") ? [value(f, "relatedId")] : [], ...(tab === "HYPOTHESIS" && value(f, "confidence") ? { confidence: Number(value(f, "confidence")) } : {}) }); await refresh();
  }
  function report(f: Finding) {
    const content = `# ${f.title}\n\nProjeto: ${snapshot?.project.name}\nAsset: ${investigation?.assetHost}\nAmbiente: ${environment[snapshot?.project.environment ?? ""]}\nSeveridade: ${f.severity}\n\n## Impacto\n${f.impact}\n\n## Reprodução\n${f.reproduction}\n\n## Análise\n${f.rationale}\n\n## Evidências\n${f.evidenceIds.map(id => { const e = entries.find(e => e.id === id); return e ? `### ${e.title}\n${e.content}\n\nOrigem: ${e.source}\nReferência: ${e.id}` : "Referência indisponível"; }).join("\n\n")}\n\n## Remediação\nNão registrada nesta etapa.\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `finding-${f.id}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="workspace embedded"><aside className="sidebar"><div className="section-label">PROJETOS <button aria-label="Novo projeto" onClick={() => setModal("project")}>＋</button></div><nav aria-label="Projetos">{projects.map(p => <button key={p.id} className={p.id === projectId ? "selected" : ""} onClick={() => { setProjectId(p.id); setQuery(""); }}><span className="project-icon">{p.name.slice(0, 1).toUpperCase()}</span>{p.name}</button>)}</nav><button className="new-project" onClick={() => setModal("project")}>＋ Criar projeto</button><div className="local"><span className="dot"/>Workspace local<small>Dados neste computador</small></div></aside>
    <main><header className="topbar"><span>Área de investigação</span><div className="search"><input ref={search} aria-label="Filtrar registros da investigação" placeholder="Filtrar nesta investigação…" value={query} onChange={e => setQuery(e.target.value)}/></div></header>
      {error && <div className="error" role="alert">{error}<button onClick={() => { setError(""); void (projectId ? refresh() : listProjects()).catch(fail); }}>Tentar novamente</button></div>}
      {loading && <p className="loading" role="status">Carregando workspace…</p>}
      {!loading && !projectId && <section className="welcome"><span className="eyebrow">DA OBSERVAÇÃO À EVIDÊNCIA</span><h1>Uma investigação.<br/>Um próximo passo claro.</h1><p>Organize sua pesquisa, teste suas hipóteses e documente o que conseguiu demonstrar. Código-fonte é opcional.</p><button className="primary" onClick={() => setModal("project")}>Criar primeiro projeto</button><small>Comece pela autorização e pelo escopo do programa.</small></section>}
      {snapshot && <><section className="project-header"><div><div className="eyebrow">{snapshot.project.type.replaceAll("_", " ")} <span> / {environment[snapshot.project.environment]}</span></div><h1>{snapshot.project.name}</h1></div><button onClick={() => { setScopeOpen(!scopeOpen); setDetail(null); }}>Autorização e escopo ↗</button></section>
      <div className="investigation-bar"><label>Investigação<select value={investigationId} onChange={e => { setInvestigationId(e.target.value); setDetail(null); setQuery(""); }}>{!snapshot.investigations.length && <option value="">Nenhuma investigação</option>}{snapshot.investigations.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label><button onClick={() => setModal("investigation")}>＋ Nova investigação</button></div>
      {scopeOpen && !investigation && <section className="objective"><h2>Autorização e escopo · versão {snapshot.project.scopeVersion}</h2><p>{snapshot.project.authorizationSource}</p><h3>Hosts permitidos</h3><p>{snapshot.project.allowedHosts.join(" · ")}</p><h3>Hosts proibidos</h3><p>{snapshot.project.deniedHosts.join(" · ") || "Nenhum informado"}</p><h3>Restrições</h3><p>{snapshot.project.restrictions}</p><h3>Validade</h3><p>{snapshot.project.authorizationExpiresAt ? new Date(snapshot.project.authorizationExpiresAt).toLocaleString("pt-BR") : "Sem prazo informado"}</p></section>}
      {investigation ? <><div className="objective"><span>{investigation.assetHost}</span><p>{investigation.objective}</p></div><div className="tabs" role="tablist">{(Object.keys(labels) as Tab[]).map(t => <button role="tab" aria-selected={tab === t} key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setDetail(null); setQuery(""); }}>{labels[t]}</button>)}</div>
      <div className="content-layout"><section className="records"><div className="records-heading"><h2>{labels[tab]}</h2>{tab !== "HISTORY" && <button className="primary" onClick={() => setModal(tab === "FINDING" ? "finding" : "entry")}>{singular[tab]}</button>}</div>
        {tab === "HISTORY" ? <ol className="timeline">{snapshot.events.filter(e => e.investigationId === investigationId).map(e => <li key={e.id}><span className="dot"/><div>{e.summary}<small>{new Date(e.createdAt).toLocaleString("pt-BR")} · usuário local</small></div></li>)}</ol> : visible.length ? <div className="entry-list">{visible.map(e => <button key={e.id} className={`entry ${detail?.id === e.id ? "chosen" : ""}`} onClick={() => { setDetail(e); setScopeOpen(false); }}><span className="entry-type">{"kind" in e ? (e.kind === "HYPOTHESIS" ? "?" : e.kind === "EVIDENCE" ? "◇" : "·") : "✓"}</span><div><strong>{e.title}</strong><p>{"content" in e ? e.content : e.impact}</p></div><span>↗</span></button>)}</div> : <div className="empty"><h3>{query ? "Nenhum resultado" : `Nenhum registro em ${labels[tab].toLowerCase()}`}</h3><p>{query ? "Tente outro termo de busca." : tab === "HYPOTHESIS" ? "Registre uma possibilidade e explique o que falta verificar." : tab === "FINDING" ? "Uma hipótese só se torna finding após revisão e evidências." : tab === "EVIDENCE" ? "Registre o material que sustenta ou contradiz uma hipótese." : "Comece pelo que você observou, sem presumir uma vulnerabilidade."}</p></div>}
      </section>{(detail || scopeOpen) && <aside className="context"><button className="close-context" aria-label="Fechar detalhes" onClick={() => { setDetail(null); setScopeOpen(false); }}>×</button>{scopeOpen ? <><span className="eyebrow">ESCOPO V{snapshot.project.scopeVersion}</span><h2>Autorização</h2><p>{snapshot.project.authorizationSource}</p><h3>Ambiente</h3><p>{environment[snapshot.project.environment]}</p><h3>Validade</h3><p>{snapshot.project.authorizationExpiresAt ? new Date(snapshot.project.authorizationExpiresAt).toLocaleString("pt-BR") : "Sem prazo informado"}</p><h3>Permitidos · hosts exatos</h3>{snapshot.project.allowedHosts.map(h => <p key={h} className="host">{h}</p>)}<h3>Proibidos</h3><p>{snapshot.project.deniedHosts.join("\n") || "Nenhum informado"}</p><h3>Restrições</h3><p>{snapshot.project.restrictions}</p><div className="notice">Nenhuma ferramenta ativa é executada nesta etapa.</div></> : detail && <><span className="eyebrow">{"kind" in detail ? labels[detail.kind] : "FINDING CONFIRMADO"}</span><h2>{detail.title}</h2>{"content" in detail ? <>{detail.confidence !== undefined && <p className="confidence">Confiança informada: {detail.confidence}%</p>}<p>{detail.content}</p><h3>Origem</h3><p>{detail.source}</p>{detail.relatedIds.length > 0 && <><h3>Relacionado a</h3>{detail.relatedIds.map(id => <p key={id}>{entries.find(e => e.id === id)?.title ?? id}</p>)}</>}</> : <><h3>Impacto · {detail.severity}</h3><p>{detail.impact}</p><h3>Reprodução</h3><p>{detail.reproduction}</p><h3>Justificativa</h3><p>{detail.rationale}</p><h3>Evidências</h3>{detail.evidenceIds.map(id => <button key={id} onClick={() => setDetail(entries.find(e => e.id === id) ?? null)}>{entries.find(e => e.id === id)?.title ?? id}</button>)}<button className="export" onClick={() => report(detail)}>Exportar relatório .md</button></>}<div className="notice">Claude Code: integração real de sessões prevista para a próxima etapa.</div></>}</aside>}</div></> : <div className="empty"><h2>Escolha uma pergunta para começar</h2><p>Crie uma investigação para organizar observações, hipóteses e evidências sobre um asset permitido.</p></div>}</>}
    </main>
    {modal === "project" && <NewProjectWizard close={() => setModal(null)} created={p => { void listProjects().then(() => setProjectId(p.id)); }}/>}
    {modal === "investigation" && snapshot && <FormDialog title="Nova investigação" close={() => setModal(null)} save={async f => { const i = await api<{ id: string }>(`/projects/${projectId}/investigations`, { title: value(f, "title"), assetHost: value(f, "assetHost"), objective: value(f, "objective") }); await refresh(); setInvestigationId(i.id); }}><InvestigationFields project={snapshot.project}/></FormDialog>}
    {modal === "entry" && <FormDialog title={singular[tab]} close={() => setModal(null)} save={saveEntry}><EntryFields entries={entries} kind={tab}/></FormDialog>}
    {modal === "finding" && <FormDialog title="Confirmar finding" close={() => setModal(null)} save={async f => { await api(`/projects/${projectId}/investigations/${investigationId}/findings`, { title: value(f, "title"), hypothesisId: value(f, "hypothesisId"), evidenceIds: f.getAll("evidenceIds"), severity: value(f, "severity"), impact: value(f, "impact"), reproduction: value(f, "reproduction"), rationale: value(f, "rationale"), confirmed: f.get("confirmed") === "on" }); await refresh(); }}><FindingFields entries={entries.filter(e => !findings.some(f => f.hypothesisId === e.id))}/></FormDialog>}
  </div>;
}
