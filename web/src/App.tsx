import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { getWildcardHost, pathUrl, setWildcardHost, subdomainUrl } from './config';
import { Endpoints } from './pages/Endpoints';
import { Requests } from './pages/Requests';
import { Settings } from './pages/Settings';
import { toast, toastError, Toaster } from './toast';
import type { Project } from './types';
import { CopyPill, useHashRoute } from './ui';

const PROJECT_KEY = 'mockie.project';

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  // Routing config decides which base URL the panel advertises, so load it
  // before the shell renders.
  useEffect(() => {
    if (!authed) return;
    api
      .config()
      .then((c) => setWildcardHost(c.wildcard_host))
      .catch(() => setWildcardHost(''))
      .finally(() => setConfigReady(true));
  }, [authed]);

  if (authed === null) return <div className="empty">Loading…</div>;
  if (!authed) {
    return (
      <Login
        onSuccess={() => {
          setConfigReady(false);
          setAuthed(true);
        }}
      />
    );
  }
  if (!configReady) return <div className="empty">Loading…</div>;
  return <Shell onLogout={() => setAuthed(false)} />;
}

/* ------------------------------------------------------------------ */

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(token);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid token.' : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <h1>🎭 Mockie</h1>
        <p>Enter the admin token to continue.</p>
        <div className="field">
          <label htmlFor="token">Admin token</label>
          <input
            id="token"
            className="input mono"
            type="password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="••••••••"
          />
          <span className="hint">
            Set with <code>wrangler secret put ADMIN_TOKEN</code>, or in <code>.dev.vars</code>{' '}
            locally.
          </span>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !token}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
      <Toaster />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Shell({ onLogout }: { onLogout: () => void }) {
  const [route, navigate] = useHashRoute();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>(
    () => localStorage.getItem(PROJECT_KEY) ?? '',
  );
  const [loading, setLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.projects();
      setProjects(list);
      setProjectId((current) => {
        const stillExists = list.some((p) => p.id === current);
        return stillExists ? current : list[0]?.id ?? '';
      });
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  const createProject = async () => {
    const name = window.prompt('Project name');
    if (!name) return;
    try {
      const created = await api.createProject({ name });
      await refreshProjects();
      setProjectId(created.id);
      toast(`Project "${name}" created`);
    } catch (err) {
      toastError(err);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    onLogout();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>🎭</span>
          <span>Mockie</span>
          <small>mock server</small>
        </div>

        <div className="side-section">
          <div className="side-label">Project</div>
          <select
            className="select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.length === 0}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {projects.length === 0 && <option value="">No projects</option>}
          </select>
          <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={createProject}>
            + New project
          </button>
        </div>

        <div className="side-section">
          <div className="side-label">Navigate</div>
          <NavItem active={route === 'requests'} onClick={() => navigate('requests')} label="Requests" />
          <NavItem
            active={route === 'endpoints'}
            onClick={() => navigate('endpoints')}
            label="Endpoints"
            count={project?.endpoint_count}
          />
          <NavItem active={route === 'settings'} onClick={() => navigate('settings')} label="Settings" />
        </div>

        <div className="spacer" />

        {project && (
          <div className="side-section">
            <div className="side-label">Base URL</div>
            {getWildcardHost() && (
              <CopyPill
                label={`${project.slug}.${getWildcardHost()}`}
                value={subdomainUrl(project.slug)}
                onCopied={() => toast('Subdomain base URL copied')}
              />
            )}
            <CopyPill
              label={`/m/${project.slug}`}
              value={pathUrl(project.slug)}
              onCopied={() => toast('Base URL copied')}
            />
          </div>
        )}

        <div className="side-section">
          <button className="btn ghost sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !project ? (
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Create one to start mocking endpoints.</p>
            <button className="btn primary" onClick={createProject}>
              + New project
            </button>
          </div>
        ) : route === 'endpoints' ? (
          <Endpoints project={project} onProjectsChanged={refreshProjects} />
        ) : route === 'settings' ? (
          <Settings project={project} onChanged={refreshProjects} onDeleted={refreshProjects} />
        ) : (
          <Requests project={project} />
        )}
      </main>

      <Toaster />
    </div>
  );
}

function NavItem({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}
