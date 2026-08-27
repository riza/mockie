import { useState } from 'react';
import { toast } from '../toast';
import type { Project, RequestDetail } from '../types';
import { MethodTag, prettyJson, StatusCode } from '../ui';

type Fact = [label: string, value: unknown];

export function RequestDetailPanel({
  detail,
  project,
  onClose,
}: {
  detail: RequestDetail;
  project: Project;
  onClose: () => void;
}) {
  const m = detail.meta;

  const queryString = new URLSearchParams(detail.query).toString();
  const displayUrl =
    detail.url ||
    `${window.location.origin}/m/${detail.project_slug ?? project.slug}${detail.path}${
      queryString ? `?${queryString}` : ''
    }`;

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  };

  const asCurl = () => {
    const parts = [`curl -X ${detail.method} '${displayUrl}'`];
    for (const [k, v] of Object.entries(detail.req_headers)) {
      if (k === 'host' || k === 'content-length' || k.startsWith('cf-')) continue;
      parts.push(`  -H '${k}: ${v}'`);
    }
    if (detail.req_body) parts.push(`  -d '${detail.req_body.replace(/'/g, "'\\''")}'`);
    copy(parts.join(' \\\n'), 'cURL');
  };

  const mockThis = () => {
    sessionStorage.setItem(
      'mockie.prefill',
      JSON.stringify({
        method: detail.method,
        path_pattern: detail.path,
        name: `From ${detail.method} ${detail.path}`,
      }),
    );
    window.location.hash = '/endpoints';
  };

  const openEndpoint = () => {
    if (!detail.endpoint) return;
    sessionStorage.setItem('mockie.open-endpoint', detail.endpoint.id);
    window.location.hash = '/endpoints';
  };

  const client: Fact[] = [
    ['IP address', m.ip || detail.ip],
    ['City', m.city],
    ['Region', m.region],
    ['Country', m.country || detail.country],
    ['Postal code', m.postal_code],
    ['Continent', m.continent],
    ['Timezone', m.timezone],
    ['Coordinates', m.latitude && m.longitude ? `${m.latitude}, ${m.longitude}` : undefined],
    ['ASN', m.asn ? `AS${m.asn}` : undefined],
    ['Network', m.as_organization],
    ['EU country', m.is_eu ? 'yes' : undefined],
    ['Verified bot', m.verified_bot],
  ];

  const connection: Fact[] = [
    ['Edge colo', m.colo],
    ['CF-Ray', m.ray],
    ['Protocol', m.http_protocol],
    ['TLS', m.tls_version],
    ['Cipher', m.tls_cipher],
    ['TCP RTT', m.client_tcp_rtt !== undefined ? `${m.client_tcp_rtt}ms` : undefined],
    ['Handled in', `${detail.duration_ms}ms`],
    ['Received at', new Date(detail.created_at).toLocaleString()],
  ];

  const agent: Fact[] = [
    ['User-Agent', detail.user_agent],
    ['Referer', m.referer],
    ['Origin', m.origin],
    ['Content-Type', m.content_type],
    ['Content-Length', m.content_length],
  ];

  return (
    <div>
      <div className="drawer-head">
        <MethodTag method={detail.method} />
        <StatusCode status={detail.status} />
        <span
          className="pill"
          style={{
            color: detail.matched ? 'var(--ok)' : 'var(--warn)',
            borderColor: 'currentColor',
          }}
        >
          {detail.matched ? 'matched' : 'no match'}
        </span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="pad">
        <div className="row tight" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn sm" style={{ flex: '0 0 auto' }} onClick={asCurl}>
            Copy as cURL
          </button>
          <button
            className="btn sm"
            style={{ flex: '0 0 auto' }}
            onClick={() => copy(displayUrl, 'URL')}
          >
            Copy URL
          </button>
          {detail.matched ? (
            <button className="btn sm" style={{ flex: '0 0 auto' }} onClick={openEndpoint}>
              Open endpoint
            </button>
          ) : (
            <button
              className="btn sm"
              style={{ flex: '0 0 auto' }}
              onClick={mockThis}
              title="Create an endpoint for this path"
            >
              Mock this
            </button>
          )}
        </div>

        <Section title="Request">
          <pre className="code" style={{ maxHeight: 'none' }}>
            {detail.method} {displayUrl}
          </pre>
          {detail.endpoint ? (
            <p className="mono faint" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
              matched{' '}
              <span style={{ color: 'var(--accent)' }}>
                {detail.endpoint.method} {detail.endpoint.path_pattern}
              </span>
              {detail.endpoint.name ? ` — ${detail.endpoint.name}` : ''} (priority{' '}
              {detail.endpoint.priority})
            </p>
          ) : (
            <p className="mono faint" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
              no endpoint matched — the project fallback answered
            </p>
          )}
        </Section>

        {Object.keys(detail.params).length > 0 && (
          <Section title="Path parameters">
            <Facts facts={Object.entries(detail.params)} />
          </Section>
        )}

        {Object.keys(detail.query).length > 0 && (
          <Section title="Query string">
            <Facts facts={Object.entries(detail.query)} mono />
          </Section>
        )}

        <Section title="Where it came from">
          <Facts facts={client} />
        </Section>

        <Section title="How it arrived">
          <Facts facts={connection} />
        </Section>

        <Section title="What the client said">
          <Facts facts={agent} />
        </Section>

        <Section
          title="Request headers"
          count={Object.keys(detail.req_headers).length}
          onCopy={() => copy(JSON.stringify(detail.req_headers, null, 2), 'Request headers')}
        >
          <Facts facts={Object.entries(detail.req_headers)} mono />
          {project.redact_headers && (
            <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>
              Authorization and Cookie are masked. Turn off “Mask sensitive headers” in Settings to
              store them in full.
            </p>
          )}
        </Section>

        <Section
          title={`Request body${detail.req_truncated ? ' (truncated)' : ''}`}
          count={detail.req_body.length || undefined}
          onCopy={detail.req_body ? () => copy(detail.req_body, 'Request body') : undefined}
        >
          <Body text={detail.req_body} />
        </Section>

        <Section
          title="Response headers"
          count={Object.keys(detail.res_headers).length}
          onCopy={() => copy(JSON.stringify(detail.res_headers, null, 2), 'Response headers')}
        >
          <Facts facts={Object.entries(detail.res_headers)} mono />
        </Section>

        <Section
          title={`Response body${detail.res_truncated ? ' (truncated)' : ''}`}
          count={detail.res_body.length || undefined}
          onCopy={detail.res_body ? () => copy(detail.res_body, 'Response body') : undefined}
        >
          <Body text={detail.res_body} />
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  count,
  onCopy,
  children,
}: {
  title: string;
  count?: number;
  onCopy?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span className="side-label" style={{ padding: 0 }}>
          {title}
        </span>
        {count !== undefined && <span className="count-badge">{count}</span>}
        <span className="spacer" />
        {onCopy && (
          <button className="btn ghost sm" onClick={onCopy} title="Copy">
            copy
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Facts({ facts, mono }: { facts: Fact[]; mono?: boolean }) {
  const rows = facts.filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && v !== false,
  );
  if (rows.length === 0) return <p className="faint mono">(none)</p>;

  return (
    <dl className={`kv${mono ? '' : ' kv-label-sans'}`}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Body viewer with a pretty/raw switch — JSON is pretty-printed by default. */
function Body({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);

  if (!text) return <p className="faint mono">(empty)</p>;

  const pretty = prettyJson(text);
  const isJson = pretty !== text;

  return (
    <div>
      {isJson && (
        <div className="row tight" style={{ marginBottom: 6 }}>
          <button className={`btn sm${raw ? '' : ' primary'}`} style={{ flex: '0 0 auto' }} onClick={() => setRaw(false)}>
            pretty
          </button>
          <button className={`btn sm${raw ? ' primary' : ''}`} style={{ flex: '0 0 auto' }} onClick={() => setRaw(true)}>
            raw
          </button>
          <span className="spacer" />
        </div>
      )}
      <pre className="code">{raw ? text : pretty}</pre>
    </div>
  );
}
