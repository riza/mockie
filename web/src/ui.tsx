import { useCallback, useEffect, useRef, useState } from 'react';

/* ---------- tiny hash router ---------- */

export function useHashRoute(): [string, (next: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'requests';
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: string) => {
    window.location.hash = `/${next}`;
  }, []);

  return [route, navigate];
}

/**
 * Re-run `fn` on an interval. Pauses while the tab is hidden unless
 * `runWhenHidden` is set — background polling only earns its keep when
 * something (desktop notifications) consumes the result.
 */
export function usePoll(
  fn: () => void,
  intervalMs: number,
  enabled: boolean,
  runWhenHidden = false,
) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (runWhenHidden || document.visibilityState === 'visible') saved.current();
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled, runWhenHidden]);
}

/* ---------- presentational ---------- */

export function MethodTag({ method }: { method: string }) {
  return <span className={`tag ${method}`}>{method}</span>;
}

export function StatusCode({ status }: { status: number }) {
  const bucket = Math.floor(status / 100);
  return <span className={`status s${bucket}`}>{status || '—'}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A one-line URL chip that copies its full value on click. */
export function CopyPill({
  label,
  value,
  title,
  onCopied,
}: {
  label: string;
  value: string;
  title?: string;
  onCopied: () => void;
}) {
  return (
    <button
      className="pill copy-pill"
      title={title ?? value}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        onCopied();
      }}
    >
      <span className="ellipsis" style={{ flex: 1, textAlign: 'left' }}>
        {label}
      </span>
      <span className="faint">copy</span>
    </button>
  );
}

/* ---------- header map editor ---------- */

export function HeaderEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  // Kept as a list so an in-progress empty key doesn't collapse rows together.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  const serialized = useRef(JSON.stringify(value));

  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== serialized.current) {
      serialized.current = next;
      setRows(Object.entries(value));
    }
  }, [value]);

  const push = (next: [string, string][]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) if (k.trim()) obj[k.trim()] = v;
    serialized.current = JSON.stringify(obj);
    onChange(obj);
  };

  return (
    <div>
      {rows.map(([k, v], i) => (
        <div className="row tight" key={i} style={{ marginBottom: 6 }}>
          <input
            className="input mono"
            placeholder="header-name"
            value={k}
            onChange={(e) => push(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
          />
          <input
            className="input mono"
            placeholder="value"
            value={v}
            onChange={(e) => push(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          <button
            className="btn ghost sm"
            style={{ flex: '0 0 auto' }}
            onClick={() => push(rows.filter((_, j) => j !== i))}
            title="Remove header"
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => push([...rows, ['', '']])}>
        + header
      </button>
    </div>
  );
}
