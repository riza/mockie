import { handleAdminApi } from './admin/api';
import { handleMock, writeLog } from './mock/handler';
import type { Env } from './types';

const ADMIN_PREFIX = '/__admin';
const API_PREFIX = '/__api';
const MOCK_PREFIX = '/m/';

interface MockTarget {
  slug: string;
  subPath: string;
}

/**
 * `<slug>.<WILDCARD_HOST>` serves one project at the host root. Returns null
 * for the base host itself and for anything deeper than a single label, so
 * `mock.example.com` and `a.b.mock.example.com` both fall through.
 */
function subdomainTarget(url: URL, env: Env): MockTarget | null {
  const base = env.WILDCARD_HOST?.trim().toLowerCase();
  if (!base) return null;

  const host = url.hostname.toLowerCase();
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;

  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;

  return { slug: label, subPath: url.pathname || '/' };
}

/** `/m/<slug>/rest` on any host. */
function pathTarget(path: string): MockTarget | null {
  if (!path.startsWith(MOCK_PREFIX)) return null;

  const rest = path.slice(MOCK_PREFIX.length);
  const slash = rest.indexOf('/');
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  if (!slug) return null;

  return { slug, subPath: slash === -1 ? '/' : rest.slice(slash) };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // A project subdomain is nothing but mocks: no panel, no admin API there,
    // so `/__admin` on it is just another mockable path. On the base host the
    // /m/ prefix can never collide with the admin surface.
    const target = subdomainTarget(url, env) ?? pathTarget(path);

    if (target) {
      const { response, log } = await handleMock(request, env, target.slug, target.subPath);
      ctx.waitUntil(
        writeLog(env, log).catch((err) => console.error('request log write failed', err)),
      );
      return response;
    }

    if (path === '/' || path === ADMIN_PREFIX) {
      return Response.redirect(new URL(`${ADMIN_PREFIX}/`, url).toString(), 302);
    }

    if (path.startsWith(API_PREFIX)) {
      return handleAdminApi(request, env);
    }

    if (path.startsWith(`${ADMIN_PREFIX}/`)) {
      // Assets live at the root of ./dist, so strip the prefix before handing
      // over. Unknown sub-paths fall back to index.html for client-side routing
      // (assets.not_found_handling: single-page-application).
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path.slice(ADMIN_PREFIX.length) || '/';
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return notFound('not_found', {
      hint: `Mock endpoints are served under ${MOCK_PREFIX}<project-slug>/... - the admin panel lives at ${ADMIN_PREFIX}/`,
    });
  },
} satisfies ExportedHandler<Env>;

function notFound(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error, ...extra }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
