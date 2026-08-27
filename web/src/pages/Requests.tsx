import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { primaryUrl } from '../config';
import {
  ensurePermission, loadMode, matchesMode, notifyBatch, NOTIFY_OPTIONS, saveMode, supported,
  type NotifyMode,
} from '../notify';
import { toast, toastError } from '../toast';
import type { Project, RequestDetail, RequestSummary, Stats } from '../types';
import { Empty, MethodTag, relativeTime, StatusCode, usePoll } from '../ui';
import { RequestDetailPanel } from './RequestDetail';

const PAGE_SIZE = 100;

export function Requests({ project }: { project: Project }) {
  const [rows, setRows] = useState<RequestSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notifyMode, setNotifyMode] = useState<NotifyMode>(loadMode);

  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [matched, setMatched] = useState('');

  // Newest row we already have; the live tail asks only for rows after it.
  const newest = useRef(0);

  const filters = useCallback(
    () => ({ project: project.id, q, method, matched }),
    [project.id, q, method, matched],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        api.requests({ ...filters(), limit: PAGE_SIZE }),
        api.stats(project.id),
      ]);
      setRows(list);
      setStats(s);
      // With no rows yet, anchor on "now" so the first poll doesn't replay the
      // whole history as new arrivals.
      newest.current = list[0]?.created_at ?? Date.now();
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [filters, project.id]);

  useEffect(() => {
    setSelected(null);
    void reload();
  }, [reload]);

  const tail = useCallback(async () => {
    try {
      const fresh = await api.requests({ ...filters(), since: newest.current, limit: PAGE_SIZE });
      if (fresh.length === 0) return;
      newest.current = fresh[0].created_at;
      setRows((prev) => [...fresh, ...prev].slice(0, 500));

      const worthAlerting = fresh.filter((r) => matchesMode(notifyMode, r));
      notifyBatch(worthAlerting, (id) => void open(id));
    } catch {
      // A transient failure during polling shouldn't spam the user.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, notifyMode]);

  // Keep polling while the tab is in the background only when alerts are on.
  usePoll(tail, 2000, live, notifyMode !== 'off');
  usePoll(() => void api.stats(project.id).then(setStats).catch(() => undefined), 10000, live);

  const open = async (id: string) => {
    try {
      setSelected(await api.request(id));
    } catch (err) {
      toastError(err);
    }
  };

  const changeNotifyMode = async (mode: NotifyMode) => {
    if (mode === 'off') {
      setNotifyMode('off');
      saveMode('off');
      return;
    }
    // requestPermission() must run inside the user gesture that opened this.
    const permission = await ensurePermission();
    if (permission !== 'granted') {
      toast(
        permission === 'denied'
          ? 'Notifications are blocked for this site — allow them in your browser settings.'
          : 'Notification permission was not granted.',
        true,
      );
      setNotifyMode('off');
      saveMode('off');
      return;
    }
    setNotifyMode(mode);
    saveMode(mode);
    toast('Desktop alerts on — they also arrive while the tab is in the background');
  };

  const clear = async () => {
    if (!window.confirm(`Delete all logged requests for "${project.name}"?`)) return;
    try {
      await api.clearRequests(project.id);
      setSelected(null);
      newest.current = 0;
      await reload();
      toast('Request log cleared');
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>Requests</h1>
        <input
          className="input"
          placeholder="Search path or body…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" style={{ width: 110 }} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select className="select" style={{ width: 130 }} value={matched} onChange={(e) => setMatched(e.target.value)}>
          <option value="">All results</option>
          <option value="1">Matched</option>
          <option value="0">Unmatched</option>
        </select>
        <div className="spacer" />
        <label className="checkbox" title="Poll for new requests every 2s">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <span className="dim">Live</span>
        </label>
        <select
          className="select"
          style={{ width: 150 }}
          value={notifyMode}
          disabled={!supported()}
          title={
            supported()
              ? 'Desktop notification when a matching request arrives'
              : 'This browser has no Notification API'
          }
          onChange={(e) => changeNotifyMode(e.target.value as NotifyMode)}
        >
          {NOTIFY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === 'off' ? '🔕' : '🔔'} {o.label}
            </option>
          ))}
        </select>
        <button className="btn ghost sm" onClick={reload}>
          Refresh
        </button>
        <button className="btn danger sm" onClick={clear}>
          Clear log
        </button>
      </div>

      <div className="content">
        <div className="split">
          <div>
            {stats && (
              <div className="pad" style={{ paddingBottom: 0 }}>
                <div className="stat-grid">
                  <Stat label="Total" value={stats.total} />
                  <Stat label="Matched" value={stats.matched} />
                  <Stat label="Unmatched" value={stats.unmatched} tone={stats.unmatched ? 'warn' : undefined} />
                  <Stat label="Avg latency" value={`${stats.avg_ms}ms`} />
                </div>
              </div>
            )}

            <div className="pad">
              <div className="card">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 84 }}>Time</th>
                      <th style={{ width: 68 }}>Method</th>
                      <th>Path</th>
                      <th style={{ width: 56 }}>Status</th>
                      <th style={{ width: 60 }}>Took</th>
                      <th style={{ width: 130 }}>From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={`${selected?.id === r.id ? 'selected' : ''} ${r.matched ? '' : 'dimmed'}`}
                        onClick={() => open(r.id)}
                      >
                        <td className="mono faint">{relativeTime(r.created_at)}</td>
                        <td>
                          <MethodTag method={r.method} />
                        </td>
                        <td className="mono truncate" title={r.path}>
                          {r.path}
                          {Object.keys(r.query).length > 0 && (
                            <span className="faint">?{new URLSearchParams(r.query).toString()}</span>
                          )}
                        </td>
                        <td>
                          <StatusCode status={r.status} />
                        </td>
                        <td className="mono faint">{r.duration_ms}ms</td>
                        <td className="mono faint truncate" title={`${r.ip} ${r.user_agent}`}>
                          {[r.country, r.ip].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {rows.length === 0 && !loading && (
                  <Empty title="No requests yet">
                    <p className="mono" style={{ fontSize: 12 }}>
                      curl {primaryUrl(project.slug)}/users
                    </p>
                  </Empty>
                )}
                {loading && rows.length === 0 && <div className="empty">Loading…</div>}
              </div>
            </div>
          </div>

          <div className="detail">
            {selected ? (
              <RequestDetailPanel detail={selected} project={project} onClose={() => setSelected(null)} />
            ) : (
              <Empty title="Select a request" >
                <p>Pick a row to inspect headers, body and the response it got.</p>
              </Empty>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div className="stat">
      <div className="v" style={tone === 'warn' && value ? { color: 'var(--warn)' } : undefined}>
        {value}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}
