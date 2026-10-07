import { Bell, Search, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type SearchResult } from "../api";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  project: "Projeto",
  investigation: "Investigação",
  hypothesis: "Hipótese",
  observation: "Observação",
  evidence: "Evidência",
  finding: "Finding",
};

/**
 * Topo: busca global real (Ctrl+K) e indicadores. "Agentes", notificações e tema claro ainda
 * não existem; aparecem apagados explicando, em vez de números inventados.
 */
export function Topbar({ open }: { open: (projectId: string, investigationId: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Busca com pequena espera para não consultar a cada tecla.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((r) => alive && (setResults(r.results), setActive(0)))
        .catch(() => alive && setResults([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const choose = (r: SearchResult) => {
    open(r.projectId, r.investigationId);
    setQ("");
    input.current?.blur();
  };

  const showList = focused && q.trim().length >= 2;
  return (
    <header className="shell-topbar">
      <div className="global-search">
        <Search size={17} className="faint" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) choose(results[active]);
            else if (e.key === "Escape") input.current?.blur();
          }}
          placeholder="Buscar projetos, investigações, hipóteses, findings…"
          aria-label="Busca global"
        />
        <kbd>Ctrl K</kbd>
        {showList && (
          <div className="search-results" role="listbox">
            {results.length === 0 ? (
              <p className="faint">Nada encontrado.</p>
            ) : (
              results.map((r, i) => (
                <button key={`${r.kind}-${r.id}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""} onMouseDown={() => choose(r)}>
                  <em>{KIND_LABEL[r.kind]}</em>
                  <strong>{r.title}</strong>
                  <small>{r.subtitle}</small>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="topbar-right">
        <span className="agents" title="Agentes chegam com o Investigador IA (etapa futura). Nenhum está rodando.">
          <i className="dot off" />
          Nenhum agente
        </span>
        <button className="icon-button" aria-disabled="true" title="Notificações: etapa futura.">
          <Bell size={18} />
        </button>
        <button className="icon-button" aria-disabled="true" title="Tema claro: etapa futura.">
          <Sun size={18} />
        </button>
      </div>
    </header>
  );
}
