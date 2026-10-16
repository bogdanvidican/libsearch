import type { BuildProgress, KiwixStatus, UpdateStatus } from '../shared/api';
import { S } from './strings';

export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** "About 25 minutes left" from elapsed time and progress; '' when it can't be estimated yet. */
export function etaText(b: BuildProgress, now: number): string {
  if (!b.running || !b.startedAt || b.done < 3 || b.total <= 0) return '';
  const elapsed = now - b.startedAt;
  if (elapsed < 5000) return '';
  const left = (elapsed / b.done) * (b.total - b.done);
  const min = Math.round(left / 60000);
  if (min >= 90) return S.library.etaHours(Math.floor(min / 60), min % 60);
  return S.library.eta(min);
}

export function formatDate(ms?: number): string {
  if (!ms) return S.library.never;
  const d = new Date(ms);
  try {
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return d.toString();
  }
}

export function kiwixLabel(k: KiwixStatus): string {
  if (k.state === 'running') return S.kiwix.running(k.books);
  return S.kiwix[k.state];
}

export function kiwixFix(k: KiwixStatus): string | undefined {
  switch (k.state) {
    case 'stopped':
      return S.kiwix.fix.stopped;
    case 'no-binary':
      return S.kiwix.fix['no-binary'];
    case 'no-zims':
      return S.kiwix.fix['no-zims'];
    case 'port-busy':
      return S.kiwix.fix['port-busy'](k.port);
    default:
      return undefined;
  }
}

export function kiwixTone(k: KiwixStatus): 'ok' | 'busy' | 'warn' | 'bad' {
  switch (k.state) {
    case 'running':
      return 'ok';
    case 'starting':
      return 'busy';
    case 'stopped':
      return 'warn';
    default:
      return 'bad';
  }
}

export function updateHeadline(u: UpdateStatus): string {
  const v = u.downloaded || u.latest || '';
  switch (u.state) {
    case 'unsupported':
      return S.updates.unsupported;
    case 'checking':
      return S.updates.checking;
    case 'up-to-date':
      return S.updates.upToDate;
    case 'offline':
      return S.updates.offline;
    case 'available':
      return S.updates.available(v);
    case 'downloading':
      return S.updates.downloading(v);
    case 'ready':
      return S.updates.ready(v);
    case 'installing':
      return S.updates.installing;
    case 'error':
      return S.updates.failed;
    default:
      return S.updates.notChecked;
  }
}

export function updateTone(u: UpdateStatus): 'ok' | 'busy' | 'warn' | 'bad' | undefined {
  switch (u.state) {
    case 'up-to-date':
      return 'ok';
    case 'checking':
    case 'available':
    case 'downloading':
    case 'ready':
    case 'installing':
      return 'busy';
    case 'offline':
      return 'warn';
    case 'error':
      return 'bad';
    default:
      return undefined;
  }
}

/** Megabytes for "12.3 of 78 MB": one decimal below 10 MB. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1048576;
  return mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
}
