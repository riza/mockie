import { invalidateBundle, rowToEndpoint, rowToProject, slugForProject } from '../db';
import { renderTemplate } from '../mock/template';
import type { Condition, Endpoint, Env, HttpMethod } from '../types';
import { checkToken, clearSessionCookie, createSessionCookie, isAuthorized } from './auth';

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object') throw new Error('not an object');
    return data as Record<string, any>;
  } catch {
    throw new HttpError('invalid_json_body', 400);
  }
}

const now = () => Date.now();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function validateSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) throw new HttpError('invalid_slug');
  if (slug === '__admin' || slug === '__api') throw new HttpError('reserved_slug');
  return slug;
}

function validatePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) throw new HttpError('path_must_start_with_slash');
  if (trimmed.length > 512) throw new HttpError('path_too_long');
  return trimmed;
}

function validateMethod(method: string): HttpMethod {
  const upper = String(method || 'GET').toUpperCase() as HttpMethod;
  if (!METHODS.includes(upper)) throw new HttpError('invalid_method');
  return upper;
}

function validateStatus(status: unknown): number {
  const n = Number(status ?? 200);
  if (!Number.isInteger(n) || n < 100 || n > 599) throw new HttpError('invalid_status');
  return n;
}

function validateHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError('invalid_headers');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new HttpError(`invalid_header_name:${k}`);
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

function validateConditions(input: unknown): Condition[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new HttpError('invalid_conditions');
  return input.map((raw) => {
    const c = raw as Condition;
    if (!['query', 'header', 'body', 'path'].includes(c.source)) {
      throw new HttpError('invalid_condition_source');
    }
    const ops = ['eq', 'neq', 'contains', 'not_contains', 'exists', 'not_exists', 'regex', 'gt', 'lt'];
    if (!ops.includes(c.op)) throw new HttpError('invalid_condition_op');
    return { source: c.source, key: String(c.key ?? ''), op: c.op, value: c.value ?? '' };
  });
}

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

async function listProjects(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM endpoints e WHERE e.project_id = p.id) AS endpoint_count,
            (SELECT COUNT(*) FROM requests r WHERE r.project_id = p.id)  AS request_count
     FROM projects p
     ORDER BY p.created_at ASC`,
  ).all<Record<string, any>>();

  return json(
    (results ?? []).map((row) => ({
      ...rowToProject(row),
      endpoint_count: row.endpoint_count,
      request_count: row.request_count,
    })),
  );
}

async function createProject(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError('name_required');

  const slug = validateSlug(String(body.slug ?? '').trim() || slugify(name));
  const id = crypto.randomUUID();
  const ts = now();

  try {
    await env.DB.prepare(
      `INSERT INTO projects (id, slug, name, description, default_headers,
                             fallback_status, fallback_body, cors_enabled,
                             redact_headers, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        slug,
        name,
        String(body.description ?? ''),
        JSON.stringify(validateHeaders(body.default_headers)),
        validateStatus(body.fallback_status ?? 404),
        String(body.fallback_body ?? ''),
        body.cors_enabled === false ? 0 : 1,
        body.redact_headers === false ? 0 : 1,
        ts,
        ts,
      )
      .run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError('slug_already_exists', 409);
    throw err;
  }

  await invalidateBundle(env, slug);
  return json({ id, slug }, 201);
}

async function updateProject(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request);
  const existing = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<Record<string, any>>();
  if (!existing) return fail('project_not_found', 404);

  const slug = body.slug === undefined ? existing.slug : validateSlug(String(body.slug).trim());

  await env.DB.prepare(
    `UPDATE projects SET slug = ?, name = ?, description = ?, default_headers = ?,
            fallback_status = ?, fallback_body = ?, cors_enabled = ?,
            redact_headers = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      slug,
      body.name === undefined ? existing.name : String(body.name),
      body.description === undefined ? existing.description : String(body.description),
      body.default_headers === undefined
        ? existing.default_headers
        : JSON.stringify(validateHeaders(body.default_headers)),
      body.fallback_status === undefined
        ? existing.fallback_status
        : validateStatus(body.fallback_status),
      body.fallback_body === undefined ? existing.fallback_body : String(body.fallback_body),
      body.cors_enabled === undefined ? existing.cors_enabled : body.cors_enabled ? 1 : 0,
      body.redact_headers === undefined ? existing.redact_headers : body.redact_headers ? 1 : 0,
      now(),
      id,
    )
    .run();

  await invalidateBundle(env, existing.slug);
  if (slug !== existing.slug) await invalidateBundle(env, slug);
  return json({ ok: true });
}

async function deleteProject(env: Env, id: string): Promise<Response> {
  const slug = await slugForProject(env, id);
  if (!slug) return fail('project_not_found', 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM endpoints WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM requests WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ]);

  await invalidateBundle(env, slug);
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* endpoints                                                           */
/* ------------------------------------------------------------------ */

async function listEndpoints(env: Env, projectId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM endpoints WHERE project_id = ? ORDER BY priority ASC, created_at ASC`,
  )
    .bind(projectId)
    .all<Record<string, any>>();
  return json((results ?? []).map(rowToEndpoint));
}

function endpointFields(body: Record<string, any>, existing?: Endpoint) {
  return {
    name: body.name === undefined ? existing?.name ?? '' : String(body.name),
    method: body.method === undefined ? existing?.method ?? 'GET' : validateMethod(body.method),
    path_pattern:
      body.path_pattern === undefined
        ? existing?.path_pattern ?? '/'
        : validatePath(String(body.path_pattern)),
    priority: body.priority === undefined ? existing?.priority ?? 100 : Number(body.priority) || 0,
    enabled: (body.enabled === undefined ? existing?.enabled ?? true : !!body.enabled) ? 1 : 0,
    conditions:
      body.conditions === undefined
        ? JSON.stringify(existing?.conditions ?? [])
        : JSON.stringify(validateConditions(body.conditions)),
    status: body.status === undefined ? existing?.status ?? 200 : validateStatus(body.status),
    headers:
      body.headers === undefined
        ? JSON.stringify(existing?.headers ?? { 'content-type': 'application/json' })
        : JSON.stringify(validateHeaders(body.headers)),
    body: body.body === undefined ? existing?.body ?? '' : String(body.body),
    body_mode: body.body_mode === 'raw' ? 'raw' : body.body_mode === 'template' ? 'template' : existing?.body_mode ?? 'template',
  };
}

async function createEndpoint(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const projectId = String(body.project_id ?? '');
  const slug = await slugForProject(env, projectId);
  if (!slug) return fail('project_not_found', 404);

  const f = endpointFields(body);
  const id = crypto.randomUUID();
  const ts = now();

  await env.DB.prepare(
    `INSERT INTO endpoints (id, project_id, name, method, path_pattern, priority, enabled,
                            conditions, status, headers, body, body_mode, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, projectId, f.name, f.method, f.path_pattern, f.priority, f.enabled,
      f.conditions, f.status, f.headers, f.body, f.body_mode, ts, ts)
    .run();

  await invalidateBundle(env, slug);
  return json({ id }, 201);
}

async function updateEndpoint(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM endpoints WHERE id = ?')
    .bind(id)
    .first<Record<string, any>>();
  if (!row) return fail('endpoint_not_found', 404);

  const f = endpointFields(body, rowToEndpoint(row));

  await env.DB.prepare(
    `UPDATE endpoints SET name = ?, method = ?, path_pattern = ?, priority = ?, enabled = ?,
            conditions = ?, status = ?, headers = ?, body = ?, body_mode = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(f.name, f.method, f.path_pattern, f.priority, f.enabled, f.conditions,
      f.status, f.headers, f.body, f.body_mode, now(), id)
    .run();

  const slug = await slugForProject(env, row.project_id);
  if (slug) await invalidateBundle(env, slug);
  return json({ ok: true });
}

async function deleteEndpoint(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT project_id FROM endpoints WHERE id = ?')
    .bind(id)
    .first<{ project_id: string }>();
  if (!row) return fail('endpoint_not_found', 404);

  await env.DB.prepare('DELETE FROM endpoints WHERE id = ?').bind(id).run();

  const slug = await slugForProject(env, row.project_id);
  if (slug) await invalidateBundle(env, slug);
  return json({ ok: true });
}

async function duplicateEndpoint(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM endpoints WHERE id = ?')
    .bind(id)
    .first<Record<string, any>>();
  if (!row) return fail('endpoint_not_found', 404);

  const newId = crypto.randomUUID();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO endpoints (id, project_id, name, method, path_pattern, priority, enabled,
                            conditions, status, headers, body, body_mode, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(newId, row.project_id, `${row.name || row.path_pattern} (copy)`, row.method,
      row.path_pattern, row.priority + 1, 0, row.conditions, row.status,
      row.headers, row.body, row.body_mode, ts, ts)
    .run();

  const slug = await slugForProject(env, row.project_id);
  if (slug) await invalidateBundle(env, slug);
  return json({ id: newId }, 201);
}

/* ------------------------------------------------------------------ */
/* request log                                                         */
/* ------------------------------------------------------------------ */

async function listRequests(url: URL, env: Env): Promise<Response> {
  const where: string[] = [];
  const binds: unknown[] = [];

  const project = url.searchParams.get('project');
  if (project) {
    where.push('project_id = ?');
    binds.push(project);
  }
  const endpoint = url.searchParams.get('endpoint');
  if (endpoint) {
    where.push('endpoint_id = ?');
    binds.push(endpoint);
  }
  const matched = url.searchParams.get('matched');
  if (matched === '1' || matched === '0') {
    where.push('matched = ?');
    binds.push(Number(matched));
  }
  const method = url.searchParams.get('method');
  if (method) {
    where.push('method = ?');
    binds.push(method.toUpperCase());
  }
  const status = url.searchParams.get('status');
  if (status) {
    where.push('status = ?');
    binds.push(Number(status));
  }
  const q = url.searchParams.get('q');
  if (q) {
    where.push('(path LIKE ? OR req_body LIKE ? OR res_body LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  // `since` powers the panel's live tail: only rows newer than the last seen one.
  const since = url.searchParams.get('since');
  if (since) {
    where.push('created_at > ?');
    binds.push(Number(since));
  }
  const before = url.searchParams.get('before');
  if (before) {
    where.push('created_at < ?');
    binds.push(Number(before));
  }

  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id, project_id, endpoint_id, matched, method, path, query,
            status, ip, country, user_agent, duration_ms, created_at,
            LENGTH(req_body) AS req_size, LENGTH(res_body) AS res_size
     FROM requests ${clause}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<Record<string, any>>();

  return json(
    (results ?? []).map((r) => ({
      ...r,
      matched: !!r.matched,
      query: JSON.parse(r.query || '{}'),
    })),
  );
}

async function getRequest(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT r.*,
            e.name         AS endpoint_name,
            e.path_pattern AS endpoint_pattern,
            e.method       AS endpoint_method,
            e.priority     AS endpoint_priority,
            p.slug         AS project_slug
     FROM requests r
     LEFT JOIN endpoints e ON e.id = r.endpoint_id
     LEFT JOIN projects  p ON p.id = r.project_id
     WHERE r.id = ?`,
  )
    .bind(id)
    .first<Record<string, any>>();
  if (!row) return fail('request_not_found', 404);

  return json({
    ...row,
    matched: !!row.matched,
    req_truncated: !!row.req_truncated,
    res_truncated: !!row.res_truncated,
    query: JSON.parse(row.query || '{}'),
    params: JSON.parse(row.params || '{}'),
    meta: JSON.parse(row.meta || '{}'),
    req_headers: JSON.parse(row.req_headers || '{}'),
    res_headers: JSON.parse(row.res_headers || '{}'),
    endpoint: row.endpoint_id
      ? {
          id: row.endpoint_id,
          name: row.endpoint_name,
          method: row.endpoint_method,
          path_pattern: row.endpoint_pattern,
          priority: row.endpoint_priority,
        }
      : null,
  });
}

async function clearRequests(url: URL, env: Env): Promise<Response> {
  const project = url.searchParams.get('project');
  if (project) {
    await env.DB.prepare('DELETE FROM requests WHERE project_id = ?').bind(project).run();
  } else {
    await env.DB.prepare('DELETE FROM requests').run();
  }
  return json({ ok: true });
}

async function stats(url: URL, env: Env): Promise<Response> {
  const project = url.searchParams.get('project');
  const clause = project ? 'WHERE project_id = ?' : '';
  const binds = project ? [project] : [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(matched) AS matched,
            AVG(duration_ms) AS avg_ms
     FROM requests ${clause}`,
  )
    .bind(...binds)
    .first<Record<string, any>>();

  const { results: byStatus } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM requests
     ${clause ? clause + ' AND' : 'WHERE'} created_at > ?
     GROUP BY status ORDER BY count DESC LIMIT 10`,
  )
    .bind(...binds, dayAgo)
    .all<Record<string, any>>();

  const { results: topPaths } = await env.DB.prepare(
    `SELECT path, method, COUNT(*) AS count FROM requests
     ${clause ? clause + ' AND' : 'WHERE'} created_at > ?
     GROUP BY path, method ORDER BY count DESC LIMIT 10`,
  )
    .bind(...binds, dayAgo)
    .all<Record<string, any>>();

  return json({
    total: totals?.total ?? 0,
    matched: totals?.matched ?? 0,
    unmatched: (totals?.total ?? 0) - (totals?.matched ?? 0),
    avg_ms: Math.round(totals?.avg_ms ?? 0),
    by_status: byStatus ?? [],
    top_paths: topPaths ?? [],
  });
}

/** Render a template body against sample data so the editor can show a preview. */
async function preview(request: Request): Promise<Response> {
  const body = await readJson(request);
  const rendered = renderTemplate(String(body.body ?? ''), {
    path: (body.path ?? {}) as Record<string, string>,
    query: (body.query ?? {}) as Record<string, string>,
    header: (body.header ?? {}) as Record<string, string>,
    body: body.json ?? null,
    rawBody: JSON.stringify(body.json ?? null),
    method: String(body.method ?? 'GET'),
    url: 'https://example.com/preview',
    index: 0,
    count: 1,
  });
  return json({ rendered });
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export async function handleAdminApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/__api/, '') || '/';
  const method = request.method;

  try {
    // --- unauthenticated ---
    if (path === '/auth/login' && method === 'POST') {
      const body = await readJson(request);
      if (!checkToken(env, String(body.token ?? ''))) {
        return fail('invalid_token', 401);
      }
      const cookie = await createSessionCookie(env, url.protocol === 'https:');
      return json({ ok: true }, 200, { 'set-cookie': cookie });
    }

    if (path === '/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
    }

    if (path === '/auth/me') {
      return json({ authenticated: await isAuthorized(request, env) });
    }

    if (path === '/config' && method === 'GET') {
      if (!(await isAuthorized(request, env))) return fail('unauthorized', 401);
      // Lets the panel show the right base URL for a project.
      return json({ wildcard_host: env.WILDCARD_HOST?.trim() ?? '' });
    }

    // --- everything below requires auth ---
    if (!(await isAuthorized(request, env))) return fail('unauthorized', 401);

    if (path === '/projects') {
      if (method === 'GET') return await listProjects(env);
      if (method === 'POST') return await createProject(request, env);
    }

    let m = /^\/projects\/([^/]+)$/.exec(path);
    if (m) {
      if (method === 'PATCH' || method === 'PUT') return await updateProject(request, env, m[1]);
      if (method === 'DELETE') return await deleteProject(env, m[1]);
    }

    m = /^\/projects\/([^/]+)\/endpoints$/.exec(path);
    if (m && method === 'GET') return await listEndpoints(env, m[1]);

    if (path === '/endpoints' && method === 'POST') return await createEndpoint(request, env);

    m = /^\/endpoints\/([^/]+)$/.exec(path);
    if (m) {
      if (method === 'PATCH' || method === 'PUT') return await updateEndpoint(request, env, m[1]);
      if (method === 'DELETE') return await deleteEndpoint(env, m[1]);
    }

    m = /^\/endpoints\/([^/]+)\/duplicate$/.exec(path);
    if (m && method === 'POST') return await duplicateEndpoint(env, m[1]);

    if (path === '/requests') {
      if (method === 'GET') return await listRequests(url, env);
      if (method === 'DELETE') return await clearRequests(url, env);
    }

    m = /^\/requests\/([^/]+)$/.exec(path);
    if (m && method === 'GET') return await getRequest(env, m[1]);

    if (path === '/stats' && method === 'GET') return await stats(url, env);
    if (path === '/preview' && method === 'POST') return await preview(request);

    return fail('not_found', 404);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('admin api error', err);
    return fail('internal_error', 500);
  }
}
