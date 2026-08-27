import type { RequestSummary } from './types';

export type NotifyMode = 'off' | 'all' | 'unmatched' | 'errors';

export const NOTIFY_OPTIONS: { value: NotifyMode; label: string }[] = [
  { value: 'off', label: 'No alerts' },
  { value: 'all', label: 'Alert: all' },
  { value: 'unmatched', label: 'Alert: unmatched' },
  { value: 'errors', label: 'Alert: 4xx/5xx' },
];

const KEY = 'mockie.notify';

export const supported = () => typeof window !== 'undefined' && 'Notification' in window;

export function loadMode(): NotifyMode {
  const raw = localStorage.getItem(KEY);
  return raw === 'all' || raw === 'unmatched' || raw === 'errors' ? raw : 'off';
}

export function saveMode(mode: NotifyMode) {
  localStorage.setItem(KEY, mode);
}

/**
 * Ask the browser for permission. Must be called from a user gesture, so this
 * is wired to the mode <select> rather than run on mount.
 */
export async function ensurePermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export function matchesMode(mode: NotifyMode, r: RequestSummary): boolean {
  switch (mode) {
    case 'all': return true;
    case 'unmatched': return !r.matched;
    case 'errors': return r.status >= 400;
    default: return false;
  }
}

/**
 * One notification per poll batch, replacing the previous one via `tag` so a
 * busy mock server doesn't bury the notification centre.
 */
export function notifyBatch(rows: RequestSummary[], onOpen: (id: string) => void): void {
  if (!supported() || Notification.permission !== 'granted' || rows.length === 0) return;

  const latest = rows[0];
  const summary = `${latest.method} ${latest.path}`;

  const title = rows.length === 1 ? summary : `${rows.length} new requests`;
  const detail = latest.matched
    ? `${latest.status} · ${latest.duration_ms}ms`
    : `${latest.status} · no endpoint matched`;
  const body = rows.length === 1 ? detail : `latest: ${summary} — ${detail}`;

  let n: Notification;
  try {
    n = new Notification(title, { body, tag: 'mockie-requests', renotify: true } as NotificationOptions);
  } catch {
    return; // Some browsers reject constructed notifications outside a SW.
  }

  n.onclick = () => {
    window.focus();
    onOpen(latest.id);
    n.close();
  };
}
