import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Confirmação antes de ações com efeito no PC. */
export function ConfirmDialog(props: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="modal-header">
          <h2 id="confirm-title">{props.title}</h2>
          <button className="icon-btn" onClick={props.onCancel} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">
          {props.children}
          <div className="modal-actions">
            <button className="btn" onClick={props.onCancel} disabled={props.busy}>
              Cancelar
            </button>
            <button
              className={`btn ${props.danger ? "btn-danger" : "btn-primary"}`}
              onClick={props.onConfirm}
              disabled={props.busy}
              autoFocus
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
