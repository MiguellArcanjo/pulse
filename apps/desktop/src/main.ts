import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { startResearch } from "../../server/src/research/start.ts";

/**
 * HackerBot desktop. O servidor e o banco do workspace rodam DENTRO deste processo,
 * escutando só em 127.0.0.1; a janela carrega essa origem e nada mais.
 *
 * Segurança (https://www.electronjs.org/docs/latest/tutorial/security):
 * contextIsolation + sandbox ligados, sem nodeIntegration, sem preload, permissões negadas,
 * navegação travada na própria origem e nenhuma janela extra.
 */

const PORT = 47710;

// Em desenvolvimento, usa as pastas do repositório e o mesmo banco do `pnpm research`.
// Empacotado (etapa seguinte), os dados ficam na pasta de dados do usuário do Windows.
const root = resolve(app.getAppPath(), "..", "..");
const paths = app.isPackaged
  ? {
      dataDir: join(app.getPath("userData"), "research"),
      migrationsDir: join(process.resourcesPath, "research-migrations"),
      uiDir: join(process.resourcesPath, "workspace"),
    }
  : {
      dataDir: join(root, "apps", "server", ".data", "research"),
      migrationsDir: join(root, "apps", "server", "research-migrations"),
      uiDir: join(root, "apps", "workspace", "dist"),
    };
const icon = join(app.getAppPath(), "assets", "icon.png");

// O banco só pode ter um dono: uma segunda abertura só traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) app.quit();

let server: Awaited<ReturnType<typeof startResearch>> | null = null;
let win: BrowserWindow | null = null;

function lockDown(origin: string) {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_e, contents) => {
    // Links externos (site, repositório, documentação do projeto) abrem no navegador do sistema;
    // dentro do app nunca nasce janela nova. Só http(s): nada de file:, javascript: etc.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

async function createWindow(origin: string) {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: "HackerBot",
    icon,
    backgroundColor: "#070b14",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.once("ready-to-show", () => win?.show());
  // Em desenvolvimento: Ctrl+R / F5 recarregam a interface depois de um novo build.
  if (!app.isPackaged)
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && (input.key === "F5" || (input.control && input.key.toLowerCase() === "r"))) {
        event.preventDefault();
        win?.webContents.reload();
      }
    });
  win.on("closed", () => (win = null));
  await win.loadURL(`${origin}/`);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    server = await startResearch({ ...paths, port: PORT });
  } catch {
    dialog.showErrorBox(
      "Não foi possível abrir o HackerBot",
      `A porta ${PORT} já está em uso. Feche o workspace aberto pelo navegador (pnpm research) e tente de novo.`,
    );
    app.quit();
    return;
  }
  lockDown(server.origin);
  await createWindow(server.origin);
});

app.on("window-all-closed", () => app.quit());

// Fecha o servidor e o banco antes de sair (o PGlite precisa gravar tudo no disco).
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !server) return;
  event.preventDefault();
  quitting = true;
  void server.close().finally(() => app.quit());
});
