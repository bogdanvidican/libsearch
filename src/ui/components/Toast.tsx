import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import type { ToastInput } from '../context';
import { S } from '../strings';

export interface ToastItem extends ToastInput {
  id: number;
}

const ICONS = { info: LoaderCircle, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((t) => {
        const Icon = t.kind === 'info' ? (t.detail ? ICONS.info : Info) : ICONS[t.kind];
        return (
          <div key={t.id} className={'toast toast--' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon className={'toast__icon' + (t.kind === 'info' && t.detail ? ' spin' : '')} size={22} aria-hidden="true" />
            <div className="toast__body">
              <p className="toast__msg">{t.message}</p>
              {t.detail ? <p className="toast__detail">{t.detail}</p> : null}
              {t.fix ? (
                <p className="toast__detail">
                  <strong>{S.library.fixLabel}</strong> {t.fix}
                </p>
              ) : null}
            </div>
            <button type="button" className="icon-btn toast__close" aria-label={S.errors.dismiss} onClick={() => onDismiss(t.id)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
