import { useEffect, useState } from 'react';
import { api } from '../api';
import { primaryUrl } from '../config';
import { toast, toastError } from '../toast';
import { CONDITION_OPS, METHODS, type Condition, type Endpoint, type HttpMethod } from '../types';
import { HeaderEditor, prettyJson } from '../ui';

export type EndpointDraft = Omit<Endpoint, 'id' | 'created_at' | 'updated_at' | 'project_id'> & {
  id?: string;
};

export function emptyDraft(overrides: Partial<EndpointDraft> = {}): EndpointDraft {
  return {
    name: '',
    method: 'GET',
    path_pattern: '/',
    priority: 100,
    enabled: true,
    conditions: [],
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{\n  "ok": true\n}',
    body_mode: 'template',
    ...overrides,
  };
}

export function EndpointEditor({
  projectId,
  projectSlug,
  initial,
  onSaved,
  onCancel,
  onDeleted,
}: {
  projectId: string;
  projectSlug: string;
  initial: EndpointDraft;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<EndpointDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [tab, setTab] = useState<'response' | 'matching'>('response');

  useEffect(() => setDraft(initial), [initial]);

  const set = <K extends keyof EndpointDraft>(key: K, value: EndpointDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Sample values so the preview can resolve {{path.x}} without a real request.
  const sampleParams = () => {
    const params: Record<string, string> = {};
    for (const seg of draft.path_pattern.split('/')) {
      if (seg.startsWith(':')) params[seg.slice(1)] = `sample-${seg.slice(1)}`;
    }
    return params;
  };

  useEffect(() => {
    if (draft.body_mode !== 'template' || !draft.body.includes('{{')) {
      setPreview('');
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .preview({
          body: draft.body,
          path: sampleParams(),
          query: { page: '1', limit: '3' },
          header: { authorization: 'Bearer sample' },
          json: { name: 'sample', id: 1 },
          method: draft.method,
        })
        .then((r) => setPreview(r.rendered))
        .catch(() => setPreview(''));
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.body, draft.body_mode, draft.path_pattern, draft.method]);

  const save = async () => {
    setBusy(true);
    try {
      if (draft.id) {
        await api.updateEndpoint(draft.id, draft);
      } else {
        await api.createEndpoint({ ...draft, project_id: projectId });
      }
      toast('Endpoint saved');
      onSaved();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    if (!window.confirm('Delete this endpoint?')) return;
    try {
      await api.deleteEndpoint(draft.id);
      toast('Endpoint deleted');
      onDeleted();
    } catch (err) {
      toastError(err);
    }
  };

  const fullUrl = `${primaryUrl(projectSlug)}${draft.path_pattern}`;

  return (
    <>
      <div className="topbar">
        <button className="btn ghost sm" onClick={onCancel}>
          ← Back
        </button>
        <h1>{draft.id ? 'Edit endpoint' : 'New endpoint'}</h1>
        <div className="spacer" />
        {draft.id && (
          <button className="btn danger sm" onClick={remove}>
            Delete
          </button>
        )}
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'response' ? ' active' : ''}`} onClick={() => setTab('response')}>
          Response
        </button>
        <button className={`tab${tab === 'matching' ? ' active' : ''}`} onClick={() => setTab('matching')}>
          Matching{draft.conditions.length > 0 ? ` (${draft.conditions.length})` : ''}
        </button>
      </div>

      <div className="content pad">
        <div className="card">
          <div className="card-body">
            <div className="row">
              <div className="field" style={{ flex: '0 0 130px' }}>
                <label>Method</label>
                <select
                  className="select mono"
                  value={draft.method}
                  onChange={(e) => set('method', e.target.value as HttpMethod)}
                >
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 3 }}>
                <label>Path pattern</label>
                <input
                  className="input mono"
                  value={draft.path_pattern}
                  onChange={(e) => set('path_pattern', e.target.value)}
                  placeholder="/users/:id"
                />
                <span className="hint mono">{fullUrl}</span>
              </div>
            </div>

            <div className="row">
              <div className="field" style={{ flex: 2 }}>
                <label>Label</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Optional, shown in the list"
                />
              </div>
              <div className="field" style={{ flex: '0 0 120px' }}>
                <label>Priority</label>
                <input
                  className="input mono"
                  type="number"
                  value={draft.priority}
                  onChange={(e) => set('priority', Number(e.target.value))}
                />
                <span className="hint">Lower wins</span>
              </div>
              <div className="field" style={{ flex: '0 0 110px' }}>
                <label>Enabled</label>
                <label className="checkbox" style={{ height: 33 }}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => set('enabled', e.target.checked)}
                  />
                  <span className="dim">{draft.enabled ? 'Serving' : 'Paused'}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {tab === 'response' ? (
          <>
            <div className="card">
              <div className="card-head">Response</div>
              <div className="card-body">
                <div className="row">
                  <div className="field" style={{ flex: '0 0 120px' }}>
                    <label>Status</label>
                    <input
                      className="input mono"
                      type="number"
                      value={draft.status}
                      onChange={(e) => set('status', Number(e.target.value))}
                    />
                  </div>
                  <div className="field">
                    <label>Headers</label>
                    <HeaderEditor value={draft.headers} onChange={(h) => set('headers', h)} />
                  </div>
                </div>

                <div className="field">
                  <label>
                    Body
                    <label className="checkbox" style={{ display: 'inline-flex', marginLeft: 12 }}>
                      <input
                        type="checkbox"
                        checked={draft.body_mode === 'template'}
                        onChange={(e) => set('body_mode', e.target.checked ? 'template' : 'raw')}
                      />
                      <span className="dim">interpolate {'{{ }}'}</span>
                    </label>
                    <button
                      className="btn ghost sm"
                      style={{ marginLeft: 8 }}
                      onClick={() => set('body', prettyJson(draft.body))}
                      title="Format as JSON (leaves templates intact only if already valid JSON)"
                    >
                      Format
                    </button>
                  </label>
                  <textarea
                    className="textarea"
                    rows={16}
                    spellCheck={false}
                    value={draft.body}
                    onChange={(e) => set('body', e.target.value)}
                  />
                </div>

                {draft.body_mode === 'template' && <TemplateHelp />}
              </div>
            </div>

            {preview && (
              <div className="card">
                <div className="card-head">Preview (sample values)</div>
                <div className="card-body">
                  <pre className="code">{preview}</pre>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="card">
            <div className="card-head">Extra conditions — all must pass</div>
            <div className="card-body">
              <ConditionsEditor
                conditions={draft.conditions}
                onChange={(c) => set('conditions', c)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function ConditionsEditor({
  conditions,
  onChange,
}: {
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
}) {
  const update = (i: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const needsValue = (op: string) => op !== 'exists' && op !== 'not_exists';

  return (
    <div>
      {conditions.length === 0 && (
        <p className="faint" style={{ marginTop: 0 }}>
          No conditions — the endpoint matches on method and path alone.
        </p>
      )}

      {conditions.map((c, i) => (
        <div className="cond-row" key={i}>
          <select
            className="select mono"
            value={c.source}
            onChange={(e) => update(i, { source: e.target.value as Condition['source'] })}
          >
            <option value="query">query</option>
            <option value="header">header</option>
            <option value="body">body</option>
            <option value="path">path</option>
          </select>
          <input
            className="input mono"
            value={c.key}
            placeholder={c.source === 'body' ? 'user.email' : 'key'}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <select
            className="select"
            value={c.op}
            onChange={(e) => update(i, { op: e.target.value as Condition['op'] })}
          >
            {CONDITION_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            className="input mono"
            value={c.value ?? ''}
            disabled={!needsValue(c.op)}
            placeholder={needsValue(c.op) ? 'value' : '—'}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <button
            className="btn ghost sm"
            onClick={() => onChange(conditions.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        className="btn sm"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...conditions, { source: 'query', key: '', op: 'eq', value: '' }])}
      >
        + condition
      </button>
    </div>
  );
}

function TemplateHelp() {
  return (
    <details style={{ marginTop: 4 }}>
      <summary className="dim" style={{ cursor: 'pointer', fontSize: 12 }}>
        Template reference
      </summary>
      <div className="mono faint" style={{ fontSize: 11.5, lineHeight: 1.9, marginTop: 8 }}>
        <div>{'{{path.id}} {{query.page}} {{header.authorization}} {{body.user.email}}'}</div>
        <div>{'{{method}} {{url}} {{uuid}} {{now}} {{timestamp}}'}</div>
        <div>{'{{random.int(1,100)}} {{random.pick(a|b|c)}} {{random.bool}} {{random.hex(8)}}'}</div>
        <div>{'{{faker.name}} {{faker.email}} {{faker.city}} {{faker.company}} {{faker.sentence}}'}</div>
        <div>{'{{query.page ?? 1}}'} — fallback when missing</div>
        <div>{'{{#repeat 3}} … {{@index1}} … {{@comma}} {{/repeat}}'} — repeat a block</div>
      </div>
    </details>
  );
}
