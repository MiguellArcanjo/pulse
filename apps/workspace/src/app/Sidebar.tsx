import { Bell, BookOpen, FlaskConical, Folder, Funnel, Hexagon, House, ScanSearch, Settings, Wrench } from "lucide-react";
import type { ReactNode } from "react";

/** "project" = visão geral do projeto; "investigate" = ferramenta de investigação. Ambos destacam "Projetos". */
export type Page = "dashboard" | "projects" | "project" | "investigate";

const UNDER_PROJECTS = (p: Page) => p === "project" || p === "investigate";

type NavItem = { id: string; label: string; icon: ReactNode; page?: Page; soon?: string };

/**
 * Navegação principal (mockup). Páginas ainda não refeitas aparecem desativadas, com o
 * motivo no próprio item: nada de link que leva a uma tela vazia.
 */
const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <House size={18} />, page: "dashboard" },
  { id: "projects", label: "Projetos", icon: <Folder size={18} />, page: "projects" },
  { id: "investigations", label: "Investigações", icon: <ScanSearch size={18} />, soon: "Lista de investigações: próxima etapa da refatoração. Por enquanto, abra pelo projeto." },
  { id: "findings", label: "Findings", icon: <Funnel size={18} />, soon: "Lista de findings: próxima etapa da refatoração. Por enquanto, abra pelo projeto." },
  { id: "tools", label: "Ferramentas", icon: <Wrench size={18} />, soon: "Registro de ferramentas: depende da cadeia de escopo e permissões, ainda não implementada." },
  { id: "lab", label: "Lab / CTF", icon: <FlaskConical size={18} />, soon: "Filtro de laboratórios e CTFs: próxima etapa da refatoração." },
  { id: "docs", label: "Documentação", icon: <BookOpen size={18} />, soon: "Documentação integrada ainda não existe." },
];

export function Sidebar({ page, go, displayName, openSettings }: { page: Page; go: (p: Page) => void; displayName: string | null; openSettings: () => void }) {
  return (
    <aside className="shell-sidebar">
      <div className="shell-brand">
        <span className="brand-mark">
          <Hexagon size={22} strokeWidth={2.2} />
        </span>
        <div>
          <strong>HackerBot</strong>
          <small>AI Security Research</small>
        </div>
      </div>
      <nav className="shell-nav" aria-label="Navegação principal">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={n.page === page || (UNDER_PROJECTS(page) && n.page === "projects") ? "active" : ""}
            aria-disabled={!n.page || undefined}
            title={n.soon}
            aria-current={n.page === page || (UNDER_PROJECTS(page) && n.page === "projects") ? "page" : undefined}
            onClick={() => n.page && go(n.page)}
          >
            {n.icon}
            <span>{n.label}</span>
            {!n.page && <em>em breve</em>}
          </button>
        ))}
      </nav>
      <div className="shell-bottom">
        <button aria-disabled="true" title="Notificações chegam junto com os eventos em tempo real (etapa futura).">
          <Bell size={18} />
          <span>Notificações</span>
          <em>em breve</em>
        </button>
        <button onClick={openSettings}>
          <Settings size={18} />
          <span>Configurações</span>
        </button>
        <button className="shell-user" onClick={openSettings} title="Alterar o nome exibido">
          <span className="avatar">{(displayName ?? "?").slice(0, 1).toUpperCase()}</span>
          <span className="who">
            <strong>{displayName ?? "Defina seu nome"}</strong>
            <small>Pesquisador · local</small>
          </span>
          <Settings size={15} className="faint" />
        </button>
      </div>
    </aside>
  );
}
