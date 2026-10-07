import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./style.css";
import "./shell.css";
import "./projects.css";
import "./project.css";
import "./wizard.css";
import "./dialog.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
