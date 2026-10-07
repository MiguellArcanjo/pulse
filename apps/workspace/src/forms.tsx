import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Entry, Project, ProjectLinks } from "./api";

export function Field({ label, name, multiline = false, required = true, hint, type = "text" }: { label: string; name: string; multiline?: boolean; required?: boolean; hint?: string; type?: string }) {
  return <label>{label}{multiline ? <textarea name={name} required={required} rows={3} maxLength={4000}/> : <input name={name} type={type} required={required} maxLength={type === "text" ? 160 : undefined}/>} {hint && <small>{hint}</small>}</label>;
}
export function FormDialog({ title, children, save, close }: { title: string; children: ReactNode; save: (f: FormData) => Promise<void>; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="hb-dialog" ref={ref} onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(""); void save(data).then(close).catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível salvar.")).finally(() => setBusy(false)); }}>
      <header><h2>{title}</h2><button type="button" onClick={close} disabled={busy} aria-label="Fechar">×</button></header>
      <fieldset disabled={busy}>{children}</fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <footer><button type="button" className="btn-ghost" onClick={close} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button></footer>
    </form>
  </dialog>;
}
export const value = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
/** Descrição, tags e links: os mesmos campos no "Novo projeto" e no "Editar informações". */
export function detailsData(f: FormData, keepEmptyDescription = false) {
  const links: ProjectLinks = {};
  for (const k of ["site", "repository", "docs"] as const) if (value(f, k)) links[k] = value(f, k);
  const tags = value(f, "tags").split(",").map((t) => t.trim()).filter(Boolean);
  const description = value(f, "description");
  return { ...(description || keepEmptyDescription ? { description } : {}), tags, links };
}
export function DetailsFields({ initial }: { initial?: { description: string | null; tags: string[]; links: ProjectLinks } }) {
  return <>
    <label>Descrição (opcional)<textarea name="description" rows={2} maxLength={500} defaultValue={initial?.description ?? ""}/></label>
    <label>Tags (opcional)<input name="tags" maxLength={220} defaultValue={initial?.tags.join(", ") ?? ""} placeholder="API, Node.js, WebSocket"/><small>Separe por vírgula. Até 8.</small></label>
    <div className="columns">
      <label>Site (opcional)<input name="site" type="url" maxLength={300} defaultValue={initial?.links.site ?? ""} placeholder="https://"/></label>
      <label>Repositório (opcional)<input name="repository" type="url" maxLength={300} defaultValue={initial?.links.repository ?? ""} placeholder="https://"/></label>
    </div>
    <label>Documentação (opcional)<input name="docs" type="url" maxLength={300} defaultValue={initial?.links.docs ?? ""} placeholder="https://"/><small>Links abrem no navegador do sistema.</small></label>
  </>;
}
export function InvestigationFields({ project }: { project: Project }) {
  return <><Field label="O que você quer investigar?" name="title"/><label>Asset no escopo<select name="assetHost">{project.allowedHosts.map(h => <option key={h}>{h}</option>)}</select></label><Field label="Objetivo e contexto" name="objective" multiline/><p className="muted">Você pode investigar sem código-fonte ou repositório.</p></>;
}
export function EntryFields({ entries, kind }: { entries: Entry[]; kind?: string }) {
  return <><Field label="Título" name="title"/>{kind === "HYPOTHESIS" && <label>Confiança (%) — sua estimativa, opcional<input name="confidence" type="number" min={0} max={100} step={1}/><small>Quanto você acredita nesta hipótese agora. Usada para ordenar as prioridades no painel.</small></label>}<Field label="Descrição / conteúdo" name="content" multiline/><Field label="Origem e contexto da coleta" name="source" multiline hint="Informe onde e quando observou isso. Evidências nesta etapa são textuais; arquivos serão adicionados depois."/>
    {entries.length > 0 && <label>Relacionar a um registro (opcional)<select name="relatedId"><option value="">Nenhum</option>{entries.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>}</>;
}
export function FindingFields({ entries }: { entries: Entry[] }) {
  return <><p className="muted">Confirme somente o que está sustentado pelas evidências selecionadas.</p><Field label="Título do finding" name="title"/>
    <label>Hipótese<select name="hypothesisId" required><option value="">Selecione</option>{entries.filter(e => e.kind === "HYPOTHESIS").map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
    <fieldset className="evidence-options"><legend>Evidências</legend>{entries.filter(e => e.kind === "EVIDENCE").map(e => <label className="check" key={e.id}><input type="checkbox" name="evidenceIds" value={e.id}/>{e.title}</label>)}</fieldset>
    <label>Severidade<select name="severity"><option value="INFORMATIONAL">Informativa</option><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
    <Field label="Impacto demonstrado" name="impact" multiline/><Field label="Passos de reprodução" name="reproduction" multiline/><Field label="Por que as evidências confirmam a hipótese?" name="rationale" multiline/>
    <label className="check"><input name="confirmed" type="checkbox" required/>Revisei as evidências e confirmo este finding.</label></>;
}
