import type { Endpoint, Env, Project, ProjectBundle } from './types';

const BUNDLE_TTL_SECONDS = 300;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToProject(row: Record<string, any>): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    default_headers: parseJson<Record<string, string>>(row.default_headers, {}),
    fallback_status: row.fallback_status ?? 404,
    fallback_body: row.fallback_body ?? '',
    cors_enabled: !!row.cors_enabled,
    redact_headers: row.redact_headers === undefined ? true : !!row.redact_headers,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToEndpoint(row: Record<string, any>): Endpoint {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name ?? '',
    method: row.method,
    path_pattern: row.path_pattern,
    priority: row.priority ?? 100,
    enabled: !!row.enabled,
    conditions: parseJson(row.conditions, []),
    status: row.status ?? 200,
    headers: parseJson<Record<string, string>>(row.headers, {}),
    body: row.body ?? '',
    body_mode: row.body_mode === 'raw' ? 'raw' : 'template',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const bundleKey = (slug: string) => `bundle:${slug}`;

/**
 * Load a project + its enabled endpoints. Served from KV when warm; a miss
 * falls back to D1 and repopulates. Returns null when the slug is unknown,
 * which is also cached (as a tombstone) to keep bogus traffic off D1.
 */
export async function loadBundle(env: Env, slug: string): Promise<ProjectBundle | null> {
  const cached = await env.CACHE.get(bundleKey(slug), 'json');
  if (cached !== null) {
    // `false` is the tombstone we store for "no such project".
    return cached === false ? null : (cached as ProjectBundle);
  }

  const projectRow = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?')
    .bind(slug)
    .first<Record<string, any>>();

  if (!projectRow) {
    await env.CACHE.put(bundleKey(slug), 'false', { expirationTtl: 60 });
    return null;
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM endpoints
     WHERE project_id = ? AND enabled = 1
     ORDER BY priority ASC, created_at ASC`,
  )
    .bind(projectRow.id)
    .all<Record<string, any>>();

  const bundle: ProjectBundle = {
    project: rowToProject(projectRow),
    endpoints: (results ?? []).map(rowToEndpoint),
  };

  await env.CACHE.put(bundleKey(slug), JSON.stringify(bundle), {
    expirationTtl: BUNDLE_TTL_SECONDS,
  });
  return bundle;
}

export async function invalidateBundle(env: Env, slug: string): Promise<void> {
  await env.CACHE.delete(bundleKey(slug));
}

/** Slug lookup for a project id, used to invalidate after endpoint writes. */
export async function slugForProject(env: Env, projectId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT slug FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ slug: string }>();
  return row?.slug ?? null;
}
