import type { Condition, Endpoint } from '../types';

export interface MatchContext {
  method: string;
  /** Path relative to the project root, always starting with '/'. */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Raw request body as text. */
  rawBody: string;
  /** Parsed JSON body when the body is valid JSON, otherwise null. */
  jsonBody: unknown;
}

export interface MatchResult {
  endpoint: Endpoint;
  params: Record<string, string>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile an Express-style pattern into a regex.
 *   /users/:id        -> one path segment captured as `id`
 *   /files/*          -> the rest of the path captured as `wildcard`
 * A trailing slash in the request is ignored.
 */
export function compilePattern(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const normalized = '/' + pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = normalized === '/' ? [] : normalized.slice(1).split('/');

  let source = '';
  for (const segment of segments) {
    if (segment === '*' || segment === '**') {
      keys.push('wildcard');
      source += '/(.*)';
    } else if (segment.startsWith(':')) {
      keys.push(segment.slice(1));
      source += '/([^/]+)';
    } else {
      source += '/' + escapeRe(segment);
    }
  }
  if (source === '') source = '/';

  return { re: new RegExp(`^${source}/?$`), keys };
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const { re, keys } = compilePattern(pattern);
  const m = re.exec(path);
  if (!m) return null;

  const params: Record<string, string> = {};
  keys.forEach((key, i) => {
    params[key] = decodeURIComponent(m[i + 1] ?? '');
  });
  return params;
}

/** Read `a.b.0.c` out of a parsed JSON body. */
function dotGet(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

function conditionValue(
  cond: Condition,
  ctx: MatchContext,
  params: Record<string, string>,
): string | undefined {
  switch (cond.source) {
    case 'query':
      return ctx.query[cond.key];
    case 'header':
      return ctx.headers[cond.key.toLowerCase()];
    case 'path':
      return params[cond.key];
    case 'body': {
      // An empty key means "the whole raw body".
      if (!cond.key) return ctx.rawBody;
      const v = dotGet(ctx.jsonBody, cond.key);
      if (v === undefined || v === null) return undefined;
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    default:
      return undefined;
  }
}

function evalCondition(
  cond: Condition,
  ctx: MatchContext,
  params: Record<string, string>,
): boolean {
  const actual = conditionValue(cond, ctx, params);
  const expected = cond.value ?? '';

  switch (cond.op) {
    case 'exists':
      return actual !== undefined;
    case 'not_exists':
      return actual === undefined;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'contains':
      return actual !== undefined && actual.includes(expected);
    case 'not_contains':
      return actual === undefined || !actual.includes(expected);
    case 'regex':
      if (actual === undefined) return false;
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    case 'gt':
      return actual !== undefined && Number(actual) > Number(expected);
    case 'lt':
      return actual !== undefined && Number(actual) < Number(expected);
    default:
      return false;
  }
}

/**
 * First endpoint that matches wins. `endpoints` is expected to arrive already
 * ordered by priority (see loadBundle).
 */
export function findMatch(endpoints: Endpoint[], ctx: MatchContext): MatchResult | null {
  for (const endpoint of endpoints) {
    if (endpoint.method !== 'ANY' && endpoint.method !== ctx.method) continue;

    const params = matchPath(endpoint.path_pattern, ctx.path);
    if (!params) continue;

    if (endpoint.conditions.length > 0) {
      const allPass = endpoint.conditions.every((c) => evalCondition(c, ctx, params));
      if (!allPass) continue;
    }

    return { endpoint, params };
  }
  return null;
}
