import { ArrowLeft, ArrowRight, Ban, Check, ChevronDown, Code, Ellipsis, FolderPlus, Globe, Server, ShieldCheck, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, type Project, type ProjectCriticality, type ProjectLinks, type ProjectStatus, type ProjectTarget } from "../api";
import { ENVIRONMENT, PROJECT_TYPE } from "../ui/format";
import { STATUS } from "../pages/Projects";

/**
 * Assistente "Novo projeto" em 4 etapas: Informações → Escopo → Autorização → Revisão.
 * A etapa "Configurações" do mockup (ferramentas, agentes de IA, scans automáticos) ficou de
 * fora: o workspace não executa nada e não há agentes. Ver docs/RESEARCH.md.
 */

export const TARGET: Record<ProjectTarget, { label: string; hint: string; icon: ReactNode }> = {
  WEB: { label: "Aplicação Web", hint: "Sites e aplicações web", icon: <Globe size={22} /> },
  API: { label: "API", hint: "REST, GraphQL e backends", icon: <Code size={22} /> },
  MOBILE: { label: "Mobile", hint: "Apps iOS/Android", icon: <Smartphone size={22} /> },
  INFRA: { label: "Infraestrutura", hint: "Servidores, cloud e redes", icon: <Server size={22} /> },
  OTHER: { label: "Outro", hint: "Outros tipos de alvo", icon: <Ellipsis size={22} /> },
};
export const CRITICALITY: Record<ProjectCriticality, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };

const STEPS = [
  { title: "Informações", hint: "Dados básicos do projeto" },
  { title: "Escopo", hint: "Hosts e regras" },
  { title: "Autorização", hint: "Origem, validade e links" },
  { title: "Revisão", hint: "Confirmar e criar" },
];

// Mesma regra do servidor (apps/server/src/research/schema.ts): só hosts exatos.
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Aceita "https://api.x.com/v1" e devolve "api.x.com"; recusa wildcard com explicação. */
function parseHost(raw: string): { host: string } | { error: string } {
  let s = raw.trim().toLowerCase();
  if (!s) return { error: "" };
  if (s.includes("*")) return { error: `"${raw.trim()}": wildcards não são aceitos. Liste cada host exato (ex.: api.exemplo.com).` };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  if (s.length > 253 || !HOST.test(s)) return { error: `"${raw.trim()}" não é um host válido.` };
  return { host: s };
}

type Form = {
  name: string;
  description: string;
  target: ProjectTarget | null;
  status: ProjectStatus;
  criticality: ProjectCriticality;
  tags: string[];
  environment: string;
  allowed: string[];
  denied: string[];
  restrictions: string;
  type: string;
  authorizationSource: string;
  expiry: string;
  links: Required<Record<keyof ProjectLinks, string>>;
  confirmed: boolean;
};

const EMPTY: Form = {
  name: "",
  description: "",
  target: null,
  status: "ACTIVE",
  criticality: "MEDIUM",
  tags: [],
  environment: "PRODUCTION",
  allowed: [],
  denied: [],
  restrictions: "",
  type: "BUG_BOUNTY",
  authorizationSource: "",
  expiry: "",
  links: { site: "", repository: "", docs: "" },
  confirmed: false,
};

const isUrl = (s: string) => {
  try {
    return ["http:", "https:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

/** O que falta em cada etapa (vazio = pode seguir). */
function problems(f: Form, step: number): string[] {
  const out: string[] = [];
  if (step === 0) {
    if (!f.name.trim()) out.push("Dê um nome ao projeto.");
    if (!f.target) out.push("Escolha o tipo de alvo.");
  }
  if (step === 1) {
    if (f.allowed.length === 0) out.push("Adicione pelo menos um host permitido.");
    if (!f.restrictions.trim()) out.push("Descreva as regras e restrições do programa.");
  }
  if (step === 2) {
    if (!f.authorizationSource.trim()) out.push("Informe a origem da autorização.");
    if (f.expiry && Date.parse(f.expiry) <= Date.now()) out.push("A validade informada já passou.");
    for (const [k, v] of Object.entries(f.links)) if (v.trim() && !isUrl(v.trim())) out.push(`Link inválido em ${LINK_LABEL[k as keyof ProjectLinks]} (use http:// ou https://).`);
  }
  if (step === 3 && !f.confirmed) out.push("Confirme que a pesquisa é autorizada.");
  return out;
}

const LINK_LABEL: Record<keyof ProjectLinks, string> = { site: "Site", repository: "Repositório", docs: "Documentação" };

function payload(f: Form) {
  const links: ProjectLinks = {};
  for (const k of ["site", "repository", "docs"] as const) if (f.links[k].trim()) links[k] = f.links[k].trim();
  return {
    name: f.name.trim(),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.target ? { target: f.target } : {}),
    status: f.status,
    criticality: f.criticality,
    tags: f.tags,
    links,
    type: f.type,
    environment: f.environment,
    authorizationSource: f.authorizationSource.trim(),
    authorizationExpiresAt: f.expiry ? new Date(f.expiry).toISOString() : null,
    allowedHosts: f.allowed,
    deniedHosts: f.denied,
    restrictions: f.restrictions.trim(),
  };
}

export function NewProjectWizard({ close, created }: { close: () => void; created: (p: Project) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<boolean[]>([false, false, false, false]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    // O showModal leva o foco para o primeiro botão; o certo é começar pelo nome.
    ref.current?.querySelector<HTMLInputElement>(".wz-main input")?.focus();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const issues = problems(f, step);
  const canVisit = (i: number) => i <= step || done.slice(0, i).every(Boolean);

  const next = () => {
    if (issues.length) return setShowErrors(true);
    setShowErrors(false);
    setDone((d) => d.map((v, i) => (i === step ? true : v)));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const submit = async () => {
    if (issues.length) return setShowErrors(true);
    setBusy(true);
    setError("");
    try {
      const p = await api<Project>("/projects", payload(f));
      created(p);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar o projeto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="wizard" onCancel={(e) => (e.preventDefault(), !busy && close())}>
      <header className="wz-head">
        <span className="wz-icon">
          <FolderPlus size={26} />
        </span>
        <div>
          <h2>Novo projeto</h2>
          <p>Registre o escopo e a autorização para organizar suas investigações.</p>
        </div>
        <button className="wz-close" onClick={close} disabled={busy} aria-label="Fechar">
          <X size={20} />
        </button>
      </header>

      <div className="wz-body">
        <ol className="wz-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button className={i === step ? "on" : ""} disabled={!canVisit(i) || busy} onClick={() => (setShowErrors(false), setStep(i))}>
                <span className="wz-num">{i + 1}</span>
                <span className="wz-step-text">
                  <strong>{s.title}</strong>
                  <small>{s.hint}</small>
                </span>
                {done[i] && i !== step && (
                  <span className="wz-done" aria-label="Concluída">
                    <Check size={13} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>

        <section className="wz-main">
          {step === 0 && <InfoStep f={f} set={set} />}
          {step === 1 && <ScopeStep f={f} set={set} />}
          {step === 2 && <AuthStep f={f} set={set} />}
          {step === 3 && <ReviewStep f={f} set={set} goTo={setStep} />}
          {showErrors && issues.length > 0 && (
            <ul className="wz-issues" role="alert">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="wz-issues" role="alert">
              {error}
            </p>
          )}
        </section>

        <Preview f={f} step={step} />
      </div>

      <footer className="wz-foot">
        {step === 0 ? (
          <button className="btn-ghost" onClick={close} disabled={busy}>
            Cancelar
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => (setShowErrors(false), setStep(step - 1))} disabled={busy}>
            <ArrowLeft size={16} /> Voltar
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="btn-primary" onClick={next}>
            Próximo <ArrowRight size={16} />
          </button>
        ) : (
          <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Criando…" : "Criar projeto"} {!busy && <Check size={16} />}
          </button>
        )}
      </footer>
    </dialog>
  );
}

type StepProps = { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void };

function StepHead({ title, text }: { title: string; text: string }) {
  return (
    <div className="wz-step-head">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function InfoStep({ f, set }: StepProps) {
  return (
    <>
      <StepHead title="Informações do projeto" text="Nome, tipo de alvo e como você quer acompanhar este projeto." />
      <label className="wz-field">
        <span>
          Nome do projeto <i>*</i>
        </span>
        <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={100} placeholder="Ex.: Apart" />
        <small className="count">{f.name.length}/100</small>
      </label>
      <label className="wz-field">
        <span>Descrição</span>
        <textarea value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={500} rows={3} placeholder="O que é o alvo e o que você quer entender sobre ele." />
        <small className="count">{f.description.length}/500</small>
      </label>
      <div className="wz-field">
        <span>
          Tipo de alvo <i>*</i>
        </span>
        <div className="wz-targets" role="radiogroup" aria-label="Tipo de alvo">
          {(Object.keys(TARGET) as ProjectTarget[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={f.target === t} className={f.target === t ? "on" : ""} onClick={() => set("target", t)}>
              {TARGET[t].icon}
              <strong>{TARGET[t].label}</strong>
              <small>{TARGET[t].hint}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="columns">
        <label className="wz-field">
          <span>Status inicial</span>
          <select value={f.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {(Object.keys(STATUS) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s]}
              </option>
            ))}
          </select>
          <small>Pode ser trocado depois pelo menu do cartão.</small>
        </label>
        <label className="wz-field">
          <span>Criticidade</span>
          <select value={f.criticality} onChange={(e) => set("criticality", e.target.value as ProjectCriticality)}>
            {(Object.keys(CRITICALITY) as ProjectCriticality[]).map((c) => (
              <option key={c} value={c}>
                {CRITICALITY[c]}
              </option>
            ))}
          </select>
          <small>Importância do projeto para você.</small>
        </label>
      </div>
      <div className="wz-field">
        <span>Tags</span>
        <TagInput tags={f.tags} onChange={(t) => set("tags", t)} />
        <small>Enter ou vírgula para adicionar. Até 8.</small>
      </div>
    </>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const push = (parts: string[]) => {
    const next = [...tags];
    for (const p of parts.map((s) => s.trim().slice(0, 24)).filter(Boolean)) if (next.length < 8 && !next.includes(p)) next.push(p);
    if (next.length !== tags.length) onChange(next);
  };
  const add = () => (push([draft]), setDraft(""));
  // Vírgula digitada ou lista colada ("Web, API"): tudo antes da última vírgula vira tag.
  const change = (v: string) => {
    if (!v.includes(",")) return setDraft(v);
    const parts = v.split(",");
    setDraft(parts.pop() ?? "");
    push(parts);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.preventDefault(), add());
    if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
  };
  return (
    <div className="wz-chips-input">
      {tags.map((t) => (
        <span key={t} className="wz-chip">
          {t}
          <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={12} />
          </button>
        </span>
      ))}
      {tags.length < 8 && <input value={draft} onChange={(e) => change(e.target.value)} onKeyDown={key} onBlur={add} maxLength={25} placeholder="+ Adicionar tag…" />}
    </div>
  );
}

/** Lista de hosts com botão Adicionar: aceita vários separados por vírgula, espaço ou linha. */
function HostList({ hosts, onChange, placeholder, other, otherLabel, button = "Adicionar" }: { hosts: string[]; onChange: (h: string[]) => void; placeholder: string; other: string[]; otherLabel: string; button?: string }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const errors: string[] = [];
    const rejected: string[] = [];
    const next = [...hosts];
    for (const raw of draft.split(/[\s,;]+/).filter(Boolean)) {
      const r = parseHost(raw);
      const problem = "error" in r ? r.error : other.includes(r.host) ? `${r.host} já está em ${otherLabel}.` : next.length >= 100 ? "Limite de 100 hosts." : "";
      if (problem) (errors.push(problem), rejected.push(raw));
      else if ("host" in r && !next.includes(r.host)) next.push(r.host);
    }
    onChange(next);
    setError([...new Set(errors)].join(" "));
    // Só o que foi recusado continua no campo, para corrigir.
    setDraft(rejected.join(" "));
  };
  return (
    <>
      <div className="wz-add">
        <input value={draft} onChange={(e) => (setDraft(e.target.value), setError(""))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder={placeholder} />
        <button type="button" className="btn-primary" onClick={add} disabled={!draft.trim()}>
          {button}
        </button>
      </div>
      {error && <small className="wz-error">{error}</small>}
      {hosts.length > 0 && (
        <div className="wz-chips">
          {hosts.map((h) => (
            <span key={h} className="wz-chip mono">
              {h}
              <button type="button" aria-label={`Remover ${h}`} onClick={() => onChange(hosts.filter((x) => x !== h))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function ScopeStep({ f, set }: StepProps) {
  return (
    <>
      <StepHead title="Escopo do projeto" text="Quais hosts podem ser pesquisados e quais regras o programa impõe." />
      <label className="wz-field">
        <span>Ambiente</span>
        <select value={f.environment} onChange={(e) => set("environment", e.target.value)}>
          {Object.entries(ENVIRONMENT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="wz-scope-box in">
        <h4>
          <Check size={16} /> Hosts permitidos <i>*</i>
        </h4>
        <p>Um host exato por item. Subdomínios não entram automaticamente e wildcards (*.exemplo.com) não são aceitos.</p>
        <HostList hosts={f.allowed} onChange={(h) => set("allowed", h)} other={f.denied} otherLabel="hosts excluídos" placeholder="Ex.: apart.com, api.apart.com" />
      </div>
      <div className="wz-scope-box out">
        <h4>
          <Ban size={16} /> Hosts excluídos (opcional)
        </h4>
        <p>Hosts que o programa proíbe explicitamente, mesmo parecendo relacionados.</p>
        <HostList hosts={f.denied} onChange={(h) => set("denied", h)} other={f.allowed} otherLabel="hosts permitidos" placeholder="Ex.: cdn.apart.com" button="Excluir" />
      </div>
      <label className="wz-field">
        <span>
          Regras e restrições do programa <i>*</i>
        </span>
        <textarea value={f.restrictions} onChange={(e) => set("restrictions", e.target.value)} rows={4} maxLength={4000} placeholder="Ex.: sem testes de carga, não acessar dados de outros usuários, limite de requisições…" />
      </label>
    </>
  );
}

function AuthStep({ f, set }: StepProps) {
  return (
    <>
      <StepHead title="Autorização" text="De onde vem a permissão para pesquisar este alvo e até quando ela vale." />
      <div className="columns">
        <label className="wz-field">
          <span>Tipo de autorização</span>
          <select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="BUG_BOUNTY">Bug bounty</option>
            <option value="OWN_PROJECT">Projeto próprio</option>
            <option value="AUTHORIZED_PROJECT">Projeto autorizado</option>
            <option value="LAB">Laboratório</option>
            <option value="CTF">CTF</option>
          </select>
        </label>
        <label className="wz-field">
          <span>Validade (opcional)</span>
          <input type="datetime-local" value={f.expiry} onChange={(e) => set("expiry", e.target.value)} />
          <small>O painel avisa quando faltar pouco.</small>
        </label>
      </div>
      <label className="wz-field">
        <span>
          Origem da autorização <i>*</i>
        </span>
        <textarea value={f.authorizationSource} onChange={(e) => set("authorizationSource", e.target.value)} rows={3} maxLength={4000} placeholder="Link da página do programa ou referência à autorização recebida (contrato, e-mail, ticket)." />
      </label>
      <div className="wz-field">
        <span>Links (opcional)</span>
        <div className="wz-links">
          {(["site", "repository", "docs"] as const).map((k) => (
            <label key={k}>
              <small>{LINK_LABEL[k]}</small>
              <input type="url" value={f.links[k]} onChange={(e) => set("links", { ...f.links, [k]: e.target.value })} maxLength={300} placeholder="https://" />
            </label>
          ))}
        </div>
        <small>Links abrem no navegador do sistema.</small>
      </div>
    </>
  );
}

function ReviewStep({ f, set, goTo }: StepProps & { goTo: (s: number) => void }) {
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
  const Section = ({ title, step, children }: { title: string; step: number; children: ReactNode }) => (
    <div className="wz-review">
      <header>
        <h4>{title}</h4>
        <button type="button" className="link" onClick={() => goTo(step)}>
          Editar
        </button>
      </header>
      <dl>{children}</dl>
    </div>
  );
  return (
    <>
      <StepHead title="Revisão" text="Confira antes de criar. Escopo e autorização ficam registrados na versão 1 do projeto." />
      <Section title="Informações" step={0}>
        <Row label="Nome">{f.name}</Row>
        <Row label="Tipo de alvo">{f.target ? TARGET[f.target].label : "—"}</Row>
        <Row label="Status / criticidade">
          {STATUS[f.status]} · {CRITICALITY[f.criticality]}
        </Row>
        {f.tags.length > 0 && <Row label="Tags">{f.tags.join(", ")}</Row>}
      </Section>
      <Section title="Escopo" step={1}>
        <Row label="Ambiente">{ENVIRONMENT[f.environment]}</Row>
        <Row label="Permitidos">{f.allowed.join(", ")}</Row>
        {f.denied.length > 0 && <Row label="Excluídos">{f.denied.join(", ")}</Row>}
        <Row label="Regras">{f.restrictions}</Row>
      </Section>
      <Section title="Autorização" step={2}>
        <Row label="Tipo">{PROJECT_TYPE[f.type]}</Row>
        <Row label="Origem">{f.authorizationSource}</Row>
        <Row label="Validade">{f.expiry ? new Date(f.expiry).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" }) : "Sem data definida"}</Row>
        {(["site", "repository", "docs"] as const)
          .filter((k) => f.links[k].trim())
          .map((k) => (
            <Row key={k} label={LINK_LABEL[k]}>
              {f.links[k].trim()}
            </Row>
          ))}
      </Section>
      <label className="wz-confirm">
        <input type="checkbox" checked={f.confirmed} onChange={(e) => set("confirmed", e.target.checked)} />
        <span>
          <ShieldCheck size={16} /> Confirmo que tenho autorização para pesquisar os hosts listados, dentro das regras acima.
        </span>
      </label>
    </>
  );
}

function Preview({ f, step }: { f: Form; step: number }) {
  const [open, setOpen] = useState(true);
  return (
    <aside className="wz-preview">
      <div className="wz-card">
        <h4>Pré-visualização</h4>
        <span className="wz-letter">{f.name.trim().charAt(0).toUpperCase() || "?"}</span>
        <strong className="wz-pname">{f.name.trim() || "Nome do projeto"}</strong>
        {f.description.trim() && <p className="wz-pdesc">{f.description.trim()}</p>}
        <div className="tag-row">
          <span className={`status-chip st-${f.status.toLowerCase()}`}>
            <i className="dot" />
            {STATUS[f.status]}
          </span>
          <span className={`crit-chip crit-${f.criticality.toLowerCase()}`}>
            <i className="dot" />
            {CRITICALITY[f.criticality]}
          </span>
          {f.target && <span className="chip">{TARGET[f.target].label}</span>}
          {f.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      </div>

      {step >= 1 && (
        <div className="wz-card">
          <h4>Escopo definido</h4>
          <button type="button" className="wz-acc" onClick={() => setOpen(!open)} aria-expanded={open}>
            <Globe size={16} /> {f.allowed.length === 1 ? "1 host permitido" : `${f.allowed.length} hosts permitidos`}
            <ChevronDown size={15} className={open ? "rot" : ""} />
          </button>
          {open && f.allowed.length > 0 && (
            <ul className="wz-hosts">
              {f.allowed.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <div className="wz-acc static">
            <Ban size={16} /> {f.denied.length === 1 ? "1 exclusão" : `${f.denied.length} exclusões`}
          </div>
        </div>
      )}

      {step < STEPS.length - 1 && (
        <div className="wz-card">
          <h4>{step === STEPS.length - 2 ? "Próximo passo" : "Próximos passos"}</h4>
          <ol className="wz-next">
            {STEPS.slice(step + 1).map((s, k) => (
              <li key={s.title}>
                <span className="wz-num">{step + k + 2}</span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.hint}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {step === STEPS.length - 1 && (
        <div className="wz-card">
          <h4>O que acontece ao criar</h4>
          <p className="wz-pdesc">O projeto é salvo neste computador com o escopo na versão 1. Nenhum teste é executado. Depois, abra uma investigação para registrar observações.</p>
        </div>
      )}
    </aside>
  );
}
