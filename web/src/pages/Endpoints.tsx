import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toast, toastError } from '../toast';
import type { Endpoint, Project } from '../types';
import { Empty, MethodTag, StatusCode } from '../ui';
import { EndpointEditor, emptyDraft, type EndpointDraft } from './EndpointEditor';

const PREFILL_KEY = 'mockie.prefill';
const OPEN_KEY = 'mockie.open-endpoint';

export function Endpoints({
  project,
  onProjectsChanged,
}: {
  project: Project;
  onProjectsChanged: () => void;
}) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [editing, setEditing] = useState<EndpointDraft | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEndpoints(await api.endpoints(project.id));
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The Requests page hands off here: either a new endpoint prefilled from an
  // unmatched request, or the id of the endpoint that answered one.
  useEffect(() => {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PREFILL_KEY);
    try {
      setEditing(emptyDraft(JSON.parse(raw)));
    } catch {
      /* ignore malformed handoff */
    }
  }, []);

  useEffect(() => {
    const id = sessionStorage.getItem(OPEN_KEY);
    if (!id || endpoints.length === 0) return;
    sessionStorage.removeItem(OPEN_KEY);
    const found = endpoints.find((e) => e.id === id);
    if (found) setEditing(found);
  }, [endpoints]);

  const afterWrite = async () => {
    setEditing(null);
    await load();
    onProjectsChanged();
  };

  const toggle = async (endpoint: Endpoint) => {
    try {
      await api.updateEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      setEndpoints((prev) =>
        prev.map((e) => (e.id === endpoint.id ? { ...e, enabled: !e.enabled } : e)),
      );
    } catch (err) {
      toastError(err);
    }
  };

  const duplicate = async (id: string) => {
    try {
      await api.duplicateEndpoint(id);
      toast('Duplicated (disabled — enable it when ready)');
      await load();
    } catch (err) {
      toastError(err);
    }
  };

  if (editing) {
    return (
      <EndpointEditor
        projectId={project.id}
        projectSlug={project.slug}
        initial={editing}
        onSaved={afterWrite}
        onDeleted={afterWrite}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <div className="topbar">
        <h1>Endpoints</h1>
        <span className="pill">{project.name}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing(emptyDraft())}>
          + New endpoint
        </button>
      </div>

      <div className="content pad">
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th style={{ width: 72 }}>Method</th>
                <th>Path</th>
                <th>Label</th>
                <th style={{ width: 56 }}>Status</th>
                <th style={{ width: 64 }}>Priority</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id} onClick={() => setEditing(e)} className={e.enabled ? '' : 'dimmed'}>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <button
                      className="btn ghost sm"
                      onClick={() => toggle(e)}
                      title={e.enabled ? 'Disable' : 'Enable'}
                    >
                      <span className={`dot ${e.enabled ? 'on' : 'off'}`} />
                    </button>
                  </td>
                  <td>
                    <MethodTag method={e.method} />
                  </td>
                  <td className="mono truncate" title={e.path_pattern}>
                    {e.path_pattern}
                    {e.conditions.length > 0 && (
                      <span className="faint"> +{e.conditions.length} cond</span>
                    )}
                  </td>
                  <td className="dim truncate">{e.name || '—'}</td>
                  <td>
                    <StatusCode status={e.status} />
                  </td>
                  <td className="mono faint">{e.priority}</td>
                  <td onClick={(ev) => ev.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="btn ghost sm" onClick={() => duplicate(e.id)}>
                      Duplicate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {endpoints.length === 0 && !loading && (
            <Empty title="No endpoints yet">
              <p>Add one and it is live immediately at /m/{project.slug}/…</p>
              <button className="btn primary" onClick={() => setEditing(emptyDraft())}>
                + New endpoint
              </button>
            </Empty>
          )}
          {loading && endpoints.length === 0 && <div className="empty">Loading…</div>}
        </div>
      </div>
    </>
  );
}
