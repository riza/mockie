import { useEffect, useState } from 'react';
import { api } from '../api';
import { getWildcardHost, pathUrl } from '../config';
import { toast, toastError } from '../toast';
import type { Project } from '../types';
import { HeaderEditor } from '../ui';

export function Settings({
  project,
  onChanged,
  onDeleted,
}: {
  project: Project;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<Project>(project);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(project), [project]);

  const set = <K extends keyof Project>(key: K, value: Project[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await api.updateProject(project.id, {
        slug: draft.slug,
        name: draft.name,
        description: draft.description,
        default_headers: draft.default_headers,
        fallback_status: draft.fallback_status,
        fallback_body: draft.fallback_body,
        cors_enabled: draft.cors_enabled,
        redact_headers: draft.redact_headers,
      });
      toast('Project saved');
      onChanged();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const typed = window.prompt(
      `This deletes the project, its endpoints and its request log.\nType "${project.slug}" to confirm.`,
    );
    if (typed !== project.slug) return;
    try {
      await api.deleteProject(project.id);
      toast('Project deleted');
      onDeleted();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="content pad">
        <div className="card">
          <div className="card-head">Project</div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label>Name</label>
                <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="field">
                <label>Slug</label>
                <input
                  className="input mono"
                  value={draft.slug}
                  onChange={(e) => set('slug', e.target.value)}
                />
                <span className="hint mono">
                  {getWildcardHost() && (
                    <>
                      https://{draft.slug}.{getWildcardHost()}/…
                      <br />
                    </>
                  )}
                  {pathUrl(draft.slug)}/…
                </span>
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input
                className="input"
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <label className="checkbox" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={draft.cors_enabled}
                onChange={(e) => set('cors_enabled', e.target.checked)}
              />
              <span>Answer CORS preflight and add permissive CORS headers</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.redact_headers}
                onChange={(e) => set('redact_headers', e.target.checked)}
              />
              <span>
                Mask sensitive headers in the request log
                <span className="hint" style={{ display: 'block' }}>
                  Authorization, Cookie and Proxy-Authorization are stored masked. Matching always
                  sees the real values. Turn off to debug the exact token a client sent.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-head">Default response headers</div>
          <div className="card-body">
            <p className="hint" style={{ marginTop: 0 }}>
              Merged into every response of this project. Endpoint headers win on conflict.
            </p>
            <HeaderEditor
              value={draft.default_headers}
              onChange={(h) => set('default_headers', h)}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">Fallback — when nothing matches</div>
          <div className="card-body">
            <div className="row">
              <div className="field" style={{ flex: '0 0 120px' }}>
                <label>Status</label>
                <input
                  className="input mono"
                  type="number"
                  value={draft.fallback_status}
                  onChange={(e) => set('fallback_status', Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Body</label>
                <textarea
                  className="textarea"
                  rows={4}
                  spellCheck={false}
                  placeholder='Leave empty for {"error":"no_matching_endpoint"}'
                  value={draft.fallback_body}
                  onChange={(e) => set('fallback_body', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">Danger zone</div>
          <div className="card-body">
            <button className="btn danger" onClick={remove}>
              Delete project
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
