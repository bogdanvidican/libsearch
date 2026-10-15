import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { S } from '../strings';

interface Props {
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  fix?: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

/** Plain-language message box: what happened, and how to fix it. */
export function NoticeBox({ kind, title, fix, children, action, compact }: Props) {
  const Icon = ICONS[kind];
  return (
    <div className={'notice notice--' + kind + (compact ? ' notice--compact' : '')} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className="notice__icon" size={22} aria-hidden="true" />
      <div className="notice__body">
        <p className="notice__title">{title}</p>
        {children}
        {fix ? (
          <p className="notice__fix">
            <strong>{S.library.fixLabel}</strong> {fix}
          </p>
        ) : null}
      </div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  );
}
