import { loadBundle } from '../db';
import type { Env, ProjectBundle } from '../types';
import { findMatch, type MatchContext } from './match';
import { renderTemplate } from './template';

const DEFAULT_MAX_BODY = 64 * 1024;
const DEFAULT_LOG_LIMIT = 2000;
/** Fraction of writes that also run the log-pruning delete. */
const PRUNE_PROBABILITY = 0.05;

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

interface CapturedBody {
  text: string;
  truncated: boolean;
}

async function readBody(request: Request, max: number): Promise<CapturedBody> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return { text: '', truncated: false };
  }
  const raw = await request.text();
  if (raw.length <= max) return { text: raw, truncated: false };
  return { text: raw.slice(0, max), truncated: true };
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function redactSensitive(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.includes(k) ? mask(v) : v;
  }
  return out;
}

function mask(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

/**
 * Everything Cloudflare knows about where and how the request arrived.
 * Values are best-effort: `wrangler dev` fills some of them with placeholders
 * and a few are only present on paid plans.
 */
export interface RequestMeta {
  // where from
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
  postal_code?: string;
  continent?: string;
  timezone?: string;
  latitude?: string;
  longitude?: string;
  asn?: number;
  as_organization?: string;
  is_eu?: boolean;
  // how it arrived
  colo?: string;
  ray?: string;
  http_protocol?: string;
  tls_version?: string;
  tls_cipher?: string;
  client_tcp_rtt?: number;
  verified_bot?: string;
  // what it said about itself
  referer?: string;
  origin?: string;
  content_type?: string;
  content_length?: string;
}

function collectMeta(request: Request): RequestMeta {
  const cf = ((request as any).cf ?? {}) as Record<string, any>;
  const h = request.headers;

  const meta: RequestMeta = {
    ip: h.get('cf-connecting-ip') ?? undefined,
    country: cf.country,
    region: cf.region,
    city: cf.city,
    postal_code: cf.postalCode,
    continent: cf.continent,
    timezone: cf.timezone,
    latitude: cf.latitude,
    longitude: cf.longitude,
    asn: cf.asn,
    as_organization: cf.asOrganization,
    is_eu: cf.isEUCountry === '1' || cf.isEUCountry === true,
    colo: cf.colo,
    ray: h.get('cf-ray') ?? undefined,
    http_protocol: cf.httpProtocol,
    tls_version: cf.tlsVersion,
    tls_cipher: cf.tlsCipher,
    client_tcp_rtt: cf.clientTcpRtt,
    verified_bot: cf.botManagement?.verifiedBotCategory || undefined,
    referer: h.get('referer') ?? undefined,
    origin: h.get('origin') ?? undefined,
    content_type: h.get('content-type') ?? undefined,
    content_length: h.get('content-length') ?? undefined,
  };

  // Drop empties so the panel only renders facts we actually have.
  for (const key of Object.keys(meta) as (keyof RequestMeta)[]) {
    const v = meta[key];
    if (v === undefined || v === null || v === '' || v === false) delete meta[key];
  }
  return meta;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

export interface MockOutcome {
  response: Response;
  log: LogEntry;
}

export interface LogEntry {
  project_id: string | null;
  endpoint_id: string | null;
  matched: boolean;
  method: string;
  path: string;
  url: string;
  query: Record<string, string>;
  params: Record<string, string>;
  meta: RequestMeta;
  req_headers: Record<string, string>;
  req_body: string;
  req_truncated: boolean;
  status: number;
  res_headers: Record<string, string>;
  res_body: string;
  res_truncated: boolean;
  ip: string;
  country: string;
  user_agent: string;
  duration_ms: number;
}

/**
 * Handle one request against the mock engine.
 *
 * `slug` is the project namespace taken from /m/<slug>/..., `subPath` is the
 * remainder that endpoint patterns are matched against.
 */
export async function handleMock(
  request: Request,
  env: Env,
  slug: string,
  subPath: string,
): Promise<MockOutcome> {
  const started = Date.now();
  const url = new URL(request.url);
  const maxBody = Number(env.MAX_BODY_BYTES) || DEFAULT_MAX_BODY;

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // Matching sees the real header values; what gets *stored* is decided once we
  // know the project's redaction setting.
  const rawHeaders = headersToObject(request.headers);
  const meta = collectMeta(request);
  const captured = await readBody(request, maxBody);

  let jsonBody: unknown = null;
  if (captured.text && !captured.truncated) {
    try {
      jsonBody = JSON.parse(captured.text);
    } catch {
      jsonBody = null;
    }
  }

  const log: LogEntry = {
    project_id: null,
    endpoint_id: null,
    matched: false,
    method: request.method,
    path: subPath,
    url: request.url,
    query,
    params: {},
    meta,
    req_headers: redactSensitive(rawHeaders),
    req_body: captured.text,
    req_truncated: captured.truncated,
    status: 0,
    res_headers: {},
    res_body: '',
    res_truncated: false,
    ip: meta.ip ?? '',
    country: meta.country ?? '',
    user_agent: request.headers.get('user-agent') ?? '',
    duration_ms: 0,
  };

  const bundle = await loadBundle(env, slug);

  if (!bundle) {
    const body = JSON.stringify({ error: 'unknown_project', slug });
    return finish(log, started, new Response(body, {
      status: 404,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    }), maxBody);
  }

  log.project_id = bundle.project.id;
  // Explicit `false` only: a bundle cached before this setting existed must
  // still redact rather than fall through to storing raw credentials.
  if (bundle.project.redact_headers === false) log.req_headers = rawHeaders;

  // Preflight is answered before matching so mocks stay usable from browsers.
  if (request.method === 'OPTIONS' && bundle.project.cors_enabled) {
    const hasExplicitOptions = bundle.endpoints.some(
      (e) => e.method === 'OPTIONS' && e.path_pattern === subPath,
    );
    if (!hasExplicitOptions) {
      return finish(log, started, new Response(null, { status: 204, headers: CORS_HEADERS }), maxBody);
    }
  }

  const ctx: MatchContext = {
    method: request.method,
    path: subPath,
    query,
    headers: rawHeaders,
    rawBody: captured.text,
    jsonBody,
  };

  const match = findMatch(bundle.endpoints, ctx);

  if (!match) {
    return finish(log, started, unmatchedResponse(bundle), maxBody);
  }

  const { endpoint, params } = match;
  log.matched = true;
  log.endpoint_id = endpoint.id;
  log.params = params;

  const scope = {
    path: params,
    query,
    header: rawHeaders,
    body: jsonBody,
    rawBody: captured.text,
    method: request.method,
    url: request.url,
    index: 0,
    count: 1,
  };

  const body =
    endpoint.body_mode === 'template' ? renderTemplate(endpoint.body, scope) : endpoint.body;

  const headers = new Headers();
  for (const [k, v] of Object.entries(bundle.project.default_headers)) headers.set(k, v);
  for (const [k, v] of Object.entries(endpoint.headers)) {
    headers.set(k, endpoint.body_mode === 'template' ? renderTemplate(v, scope) : v);
  }
  if (bundle.project.cors_enabled) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');

  const bodyless =
    request.method === 'HEAD' || endpoint.status === 204 || endpoint.status === 304;

  return finish(
    log,
    started,
    new Response(bodyless ? null : body, { status: endpoint.status, headers }),
    maxBody,
  );
}

function unmatchedResponse(bundle: ProjectBundle): Response {
  const { project } = bundle;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (project.cors_enabled) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  }
  const body =
    project.fallback_body ||
    JSON.stringify({ error: 'no_matching_endpoint', project: project.slug });
  return new Response(body, { status: project.fallback_status, headers });
}

/** Snapshot the response into the log entry without consuming it. */
async function finish(
  log: LogEntry,
  started: number,
  response: Response,
  maxBody: number,
): Promise<MockOutcome> {
  const clone = response.clone();
  const text = await clone.text();

  log.status = response.status;
  log.res_headers = headersToObject(response.headers);
  log.res_body = text.length > maxBody ? text.slice(0, maxBody) : text;
  log.res_truncated = text.length > maxBody;
  log.duration_ms = Date.now() - started;

  return { response, log };
}

export async function writeLog(env: Env, log: LogEntry): Promise<void> {
  const id = crypto.randomUUID();
  const limit = Number(env.REQUEST_LOG_LIMIT) || DEFAULT_LOG_LIMIT;

  await env.DB.prepare(
    `INSERT INTO requests (
       id, project_id, endpoint_id, matched,
       method, path, url, query, params, meta,
       req_headers, req_body, req_truncated,
       status, res_headers, res_body, res_truncated,
       ip, country, user_agent, duration_ms, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      log.project_id,
      log.endpoint_id,
      log.matched ? 1 : 0,
      log.method,
      log.path,
      log.url,
      JSON.stringify(log.query),
      JSON.stringify(log.params),
      JSON.stringify(log.meta),
      JSON.stringify(log.req_headers),
      log.req_body,
      log.req_truncated ? 1 : 0,
      log.status,
      JSON.stringify(log.res_headers),
      log.res_body,
      log.res_truncated ? 1 : 0,
      log.ip,
      log.country,
      log.user_agent,
      log.duration_ms,
      Date.now(),
    )
    .run();

  // Keep the table bounded without paying for a count on every request.
  if (Math.random() < PRUNE_PROBABILITY) {
    await env.DB.prepare(
      `DELETE FROM requests
       WHERE id IN (
         SELECT id FROM requests ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
    )
      .bind(limit)
      .run();
  }
}
