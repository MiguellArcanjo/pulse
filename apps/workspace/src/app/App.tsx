import { useCallback, useEffect, useState } from "react";
import { api, type Dashboard as DashboardData, type Project } from "../api";
import { Field, FormDialog, value } from "../forms";
import { Dashboard } from "../pages/Dashboard";
import { Projects } from "../pages/Projects";
import { ProjectView } from "../pages/ProjectView";
import { Workspace } from "../pages/Workspace";
import { NewProjectWizard } from "./NewProject";
import { Sidebar, type Page } from "./Sidebar";
import { Topbar } from "./Topbar";

type Route = { page: Page; projectId?: string; investigationId?: string; newInvestigation?: boolean };

/** Moldura do produto: barra lateral, topo com busca global e a página atual. */
export function App() {
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"project" | "settings" | null>(null);
  // Muda a cada abertura de projeto para remontar a página com a seleção certa.
  const [openKey, setOpenKey] = useState(0);
  // Muda quando um projeto é criado, para a listagem recarregar.
  const [listKey, setListKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await api<DashboardData>("/dashboard"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o painel.");
    }
  }, []);

  useEffect(() => {
    if (route.page === "dashboard") void load();
  }, [route.page, load]);

  // Abrir um projeto leva à visão geral; abrir uma investigação (busca, "continuar") leva à ferramenta.
  const openProject = (projectId: string, investigationId?: string | null) => {
    setRoute(investigationId ? { page: "investigate", projectId, investigationId } : { page: "project", projectId });
    setOpenKey((k) => k + 1);
  };
  const openInvestigation = (projectId: string, investigationId?: string, createNew = false) => {
    setRoute({ page: "investigate", projectId, ...(investigationId ? { investigationId } : {}), ...(createNew ? { newInvestigation: true } : {}) });
    setOpenKey((k) => k + 1);
  };

  return (
    <div className="shell">
      <Sidebar page={route.page} go={(page) => setRoute({ page })} displayName={data?.displayName ?? null} openSettings={() => setDialog("settings")} />
      <div className="shell-content">
        <Topbar open={openProject} />
        <main className="shell-page">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => void load()}>Tentar novamente</button>
            </div>
          )}
          {route.page === "dashboard" &&
            (data ? (
              data.totals.projects === 0 && !data.displayName ? (
                <Welcome start={() => setDialog("settings")} />
              ) : (
                <Dashboard data={data} newProject={() => setDialog("project")} openProject={openProject} goProjects={() => setRoute({ page: "projects" })} />
              )
            ) : (
              !error && <p className="loading">Carregando painel…</p>
            ))}
          {route.page === "projects" && <Projects openProject={(id) => openProject(id)} newProject={() => setDialog("project")} refreshKey={listKey} />}
          {route.page === "project" && route.projectId && (
            <ProjectView
              key={openKey}
              projectId={route.projectId}
              goProjects={() => {
                setListKey((k) => k + 1);
                setRoute({ page: "projects" });
              }}
              onOpenInvestigation={(investigationId) => openInvestigation(route.projectId!, investigationId)}
              onNewInvestigation={() => openInvestigation(route.projectId!, undefined, true)}
            />
          )}
          {route.page === "investigate" && (
            <Workspace key={openKey} initialProjectId={route.projectId} initialInvestigationId={route.investigationId} openNewInvestigation={route.newInvestigation} />
          )}
        </main>
      </div>

      {dialog === "project" && (
        <NewProjectWizard
          close={() => setDialog(null)}
          created={(p) => {
            if (route.page === "projects") setListKey((k) => k + 1);
            else openProject(p.id);
          }}
        />
      )}
      {dialog === "settings" && (
        <FormDialog
          title="Como podemos te chamar?"
          close={() => setDialog(null)}
          save={async (f) => {
            await api("/settings", { displayName: value(f, "displayName") }, "PUT");
            await load();
          }}
        >
          <p className="muted">Usado só na saudação deste computador. Nada é enviado para fora.</p>
          <Field label="Seu nome" name="displayName" />
        </FormDialog>
      )}
    </div>
  );
}

/** Primeira abertura: nome e primeiro projeto, sem painel vazio de números zerados. */
function Welcome({ start }: { start: () => void }) {
  return (
    <section className="welcome">
      <span className="eyebrow">HACKERBOT · AI SECURITY RESEARCH</span>
      <h1>
        Da observação à evidência,
        <br />
        um passo de cada vez.
      </h1>
      <p>Organize pesquisas autorizadas: escopo, investigações, hipóteses, evidências e findings, tudo no seu computador.</p>
      <button className="btn-primary" onClick={start}>
        Começar
      </button>
    </section>
  );
}
