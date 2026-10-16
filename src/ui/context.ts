import { createContext, useContext } from 'react';
import type { Category, DocKind, KiwixBook, Notice, Status } from '../shared/api';

export interface ToastInput {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
  fix?: string;
}

export interface OpenTarget {
  docId: number;
  title: string;
  kind: DocKind;
}

export interface AppCtx {
  status: Status | null;
  statusError: Notice | null;
  refreshStatus: () => void;
  kiwixBooks: KiwixBook[];
  categories: Category[];
  toast: (t: ToastInput) => void;
  openBook: (doc: OpenTarget, page: number, terms?: string[]) => void;
  openReader: (url: string, title: string) => void;
  /** Hash of the last results page, for the reader's "Back to results" button. */
  lastResultsHash: () => string;
  startBuild: (full: boolean) => void;
  cancelBuild: () => void;
  startKiwix: () => void;
  kiwixStarting: boolean;
  /** "Restart now and update": installs the downloaded version; the app closes and opens again. */
  installUpdate: () => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}
