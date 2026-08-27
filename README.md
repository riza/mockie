<h1 align="center">Mockie</h1>

<p align="center">
  <strong>Serverless mock API server on Cloudflare Workers</strong><br>
  Configure endpoints in a browser, watch every request arrive in full detail.
</p>

<p align="center">
  <a href="#quick-start"><img alt="platform" src="https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white"></a>
  <a href="#requirements"><img alt="typescript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white"></a>
  <a href="#the-admin-panel"><img alt="react" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black"></a>
  <a href="#architecture"><img alt="storage" src="https://img.shields.io/badge/storage-D1%20%2B%20KV-2ea043?style=flat-square"></a>
  <a href="#requirements"><img alt="runtime deps" src="https://img.shields.io/badge/runtime%20deps-none-8957e5?style=flat-square"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://x.com/rizasabuncu"><img alt="twitter" src="https://img.shields.io/badge/%40rizasabuncu-000000?style=flat-square&logo=x&logoColor=white"></a>
  <a href="https://buymeacoffee.com/rizasabuncu"><img alt="buy me a coffee" src="https://img.shields.io/badge/buy%20me%20a%20coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000000"></a>
</p>

---

Mockie is a mock HTTP API you configure from a browser and deploy to the edge.
Define endpoints with path patterns and match conditions, give them dynamic
response bodies, and inspect every incoming request — headers, body, path
parameters, geo, ASN, TLS, latency — in a live-tailing panel.

It exists because the alternatives are either a process you have to keep alive
somewhere, or a hosted service you have to trust with your traffic. This one is
a single Worker on your own Cloudflare account, with no server to run and
nothing to pay for at small scale.

> [!IMPORTANT]
> Mock endpoints are **public by design** — a mock server whose endpoints need
> credentials is not much use to the client you are testing. The admin panel and
> admin API are separate, and gated behind `ADMIN_TOKEN`. Do not put real
> secrets or personal data in mock responses, and remember that every request to
> a mock endpoint writes a row to your D1 database.

```console
$ curl -s https://mock.example.com/m/demo/users?limit=2
{
  "page": 1,
  "items": [
    {
      "id": 1,
      "name": "Deniz Sahin",
      "email": "mert.kurt@example.com",
      "city": "Oslo"
    },
    {
      "id": 2,
      "name": "Leyla Kaya",
      "email": "deniz.celik@example.com",
      "city": "Osaka"
    }
  ]
}

$ curl -s https://mock.example.com/m/demo/users/42
{"id": "42", "name": "Nora Celik", "created_at": "2026-08-27T09:10:00.913Z"}

$ curl -si https://mock.example.com/m/demo/secure/anything
HTTP/2 401
{"error": "missing_authorization"}
```

Three seeded endpoints produced that: a list with a templated array, a path
parameter echoed back, and a rule that answers `401` only when the
`Authorization` header is absent.

---

## Quick start

```bash
git clone https://github.com/riza/mockie.git
cd mockie
npm install

# Your own copy of the config — it will hold your account's resource ids
cp wrangler.example.jsonc wrangler.jsonc

# Create the two bindings, then paste the printed ids into wrangler.jsonc
npx wrangler d1 create mockie
npx wrangler kv namespace create CACHE

# Schema + a seeded demo project
npx wrangler d1 migrations apply mockie --local

# Pick an admin password for local use
echo 'ADMIN_TOKEN=choose-something' > .dev.vars

# Build the panel, then run the Worker
npm run build && npm run dev
```

Open <http://localhost:8787/__admin/>, sign in with the token you just chose,
and hit `http://localhost:8787/m/demo/users` to see the first request land in
the panel.

---

## What it does

1. **Endpoint matching** — method (or `ANY`) plus an Express-style path pattern
   (`/users/:id`, `/files/*`), resolved in `priority` order so a specific rule
   can shadow a general one.
2. **Match conditions** — an endpoint can additionally require something of the
   `query`, a `header`, the JSON `body` (by dot path), or an extracted path
   parameter, with `eq`, `neq`, `contains`, `not_contains`, `exists`,
   `not_exists`, `regex`, `gt`, `lt`. All conditions must pass.
3. **Dynamic responses** — response bodies and header values run through a small
   interpolator: request data, fake data, random values, repeated blocks. No
   `eval`, no user code execution — only a fixed set of names resolves.
4. **Full request capture** — every request is logged with its headers, body,
   response, path parameters, latency, and the geo/network/TLS facts Cloudflare
   attaches at the edge.
5. **Live inspection** — the panel tails new requests, filters them, and shows
   one request in full; unmatched ones can be turned into an endpoint in a click.
6. **Desktop notifications** — optional browser alerts for all traffic,
   unmatched requests only, or errors only.
7. **Projects** — independent sets of endpoints, each with its own base URL,
   fallback response, default headers and CORS behaviour.
8. **Two URL shapes** — `/m/<slug>/…` always works; per-project subdomains
   (`<slug>.mock.example.com/…`) are available when you own a domain.

---

## URL layout

| URL | What |
|---|---|
| `<host>/__admin/` | Admin panel (single-page app) |
| `<host>/__api/*` | Admin JSON API — requires `ADMIN_TOKEN` |
| `<host>/m/<slug>/*` | Mock endpoints for the project `<slug>` |
| `<slug>.<host>/*` | The same project served at the host root — [optional](#wildcard-subdomains) |

Both mock forms hit the same project and share one request log. The subdomain
form is the one to use when a client insists on owning the whole path space —
SDK base URLs, OAuth callbacks, anything that hardcodes `/`.

> [!NOTE]
> A project subdomain serves **nothing but mocks**. On
> `acme.mock.example.com`, the paths `/__admin` and `/__api` are ordinary
> mockable paths, so exposing a project never exposes the admin surface.

---

## Requirements

- A Cloudflare account (the free plan is enough).
- Node.js 20+ and npm.
- `wrangler` 4.x — installed as a dev dependency, no global install needed.

The Worker itself has **no runtime dependencies**: no framework, no router, no
template library. React, Vite and TypeScript are build-time only, and the panel
ships as one 70 KB gzipped bundle served from Workers Assets.

---

## Setup

### 1. Bindings

```bash
npx wrangler d1 create mockie
```

```bash
npx wrangler kv namespace create CACHE
```

Paste the two printed ids into `wrangler.jsonc` — `d1_databases[0].database_id`
and `kv_namespaces[0].id`.

### 2. Schema

```bash
npx wrangler d1 migrations apply mockie --local
```

```bash
npx wrangler d1 migrations apply mockie --remote
```

The second migration seeds a `demo` project so a fresh install answers something
on the first request. Delete it whenever you like.

### 3. Admin token

Locally, `.dev.vars`:

```bash
echo 'ADMIN_TOKEN=choose-something' > .dev.vars
```

In production it is a secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

> [!WARNING]
> Until `ADMIN_TOKEN` is set the admin API rejects every request — the panel
> fails closed rather than open. The token is compared after trimming
> whitespace, so `echo "$T" | wrangler secret put ADMIN_TOKEN` and its trailing
> newline will not lock you out.

### 4. Deploy

```bash
npm run deploy
```

That builds the panel and ships the Worker. Without a `routes` entry it lands on
`mockie.<your-subdomain>.workers.dev`, which is a perfectly usable mock server.

To put it on your own domain, uncomment `routes` in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "mock.example.com", "custom_domain": true }
]
```

Wrangler creates the DNS record and the binding itself, as long as the zone is
on the same Cloudflare account.

---

## Defining an endpoint

An endpoint is a method, a path pattern, an optional list of conditions, and a
response. Path patterns support `:name` for a single segment and `*` for the
rest of the path:

| Pattern | Matches | Does not match |
|---|---|---|
| `/users` | `/users`, `/users/` | `/users/1` |
| `/users/:id` | `/users/42` → `id = 42` | `/users`, `/users/42/posts` |
| `/files/*` | `/files/a/b.txt` → `wildcard = a/b.txt` | `/files` |

When several endpoints match, the lowest `priority` wins; ties break by creation
order. That is how the seeded `/secure/*` rule at priority 10 can intercept
anything under `/secure` before a more specific handler at priority 100 sees it.

Conditions are evaluated after the method and path already matched, and **all**
of them must pass:

| Source | `key` means | Example |
|---|---|---|
| `query` | Parameter name | `page` `exists` |
| `header` | Header name, case-insensitive | `authorization` `not_exists` |
| `body` | Dot path into the JSON body | `user.role` `eq` `admin` |
| `path` | A `:name` from the pattern | `id` `regex` `^\d+$` |

---

## Template reference

Response bodies and response header values are interpolated when the endpoint's
body mode is `template`.

| Expression | Result |
|---|---|
| `{{path.id}}` | Value of the `:id` path parameter |
| `{{query.page}}` | Query string parameter |
| `{{header.authorization}}` | Request header, case-insensitive |
| `{{body.user.email}}` | Dot path into the JSON request body |
| `{{body}}` | The raw request body, verbatim |
| `{{method}}` `{{url}}` | Request method / full URL |
| `{{uuid}}` `{{now}}` `{{timestamp}}` `{{now.unix}}` | Random UUID, ISO date, epoch ms, epoch s |
| `{{random.int(1,100)}}` | Random integer in range |
| `{{random.float(0,1,3)}}` | Random float, 3 decimals |
| `{{random.pick(red\|green\|blue)}}` | One of the options |
| `{{random.bool}}` `{{random.hex(8)}}` | Boolean, hex string |
| `{{faker.name}}` | Also `firstName`, `lastName`, `email`, `username`, `city`, `country`, `company`, `phone`, `word`, `sentence`, `paragraph`, `url`, `avatar` |
| `{{query.page ?? 1}}` | Fallback when the value is missing or empty |
| `{{#repeat 3}}…{{/repeat}}` | Repeat a block; the count may be an expression such as `query.limit` |
| `{{@index}}` `{{@index1}}` | Zero- and one-based iteration counter |
| `{{@comma}}` | A comma on every iteration but the last |
| `{{@first}}` `{{@last}}` | `true`/`false` for the current iteration |

`{{@comma}}` is what keeps a generated JSON array valid:

```jsonc
{
  "page": {{query.page ?? 1}},
  "items": [{{#repeat query.limit ?? 3}}
    { "id": {{@index1}}, "name": "{{faker.name}}" }{{@comma}}
  {{/repeat}}]
}
```

Repeat blocks nest up to five levels, and each level resolves its own
`{{@index}}` before the outer one does. Unknown expressions render as an empty
string. There is no `eval` anywhere — only the names above resolve, so a
template can never reach outside the request that triggered it.

The endpoint editor renders a live preview against sample values as you type.

---

## The admin panel

### Request inspection

Clicking a request shows everything that was captured:

| Group | Fields |
|---|---|
| Request line | Full URL, method, path, matched endpoint (pattern, label, priority) or "no match" |
| Path parameters | Values extracted by the matching pattern |
| Query string | Every parameter, decoded |
| Where it came from | IP, city, region, country, postal code, continent, timezone, coordinates, ASN + network name, EU flag, verified-bot category |
| How it arrived | Cloudflare edge colo, CF-Ray, HTTP protocol, TLS version, cipher, client TCP RTT, handling time, timestamp |
| What the client said | User-Agent, Referer, Origin, Content-Type, Content-Length |
| Request | All headers, full body — pretty-printed when JSON, with a raw toggle |
| Response | Status, all headers, full body |

Geo and TLS values come from Cloudflare's `request.cf`; `wrangler dev` fills them
with plausible placeholders and a few are only populated on paid plans. Missing
fields are simply not rendered.

Every section has a copy button, the whole request can be copied back out as a
runnable `curl` command, and an unmatched request gets a **Mock this** button
that opens the editor prefilled with its method and path.

### Desktop alerts

Pick a mode in the toolbar — **all**, **unmatched only**, or **4xx/5xx only** —
and the browser asks for notification permission on that click. While alerts are
on, the panel keeps polling in the background so notifications still arrive with
the tab hidden; with alerts off, polling pauses when the tab is not visible.

One notification per poll batch (they replace each other rather than stacking),
and clicking it focuses the tab and opens that request's detail. Notifications
need a secure context — the deployed HTTPS domain or `http://localhost` both
qualify.

### Sensitive headers

`authorization`, `cookie` and `proxy-authorization` are masked before being
written to the request log. Matching always sees the real values. Turn off
**Mask sensitive headers** in project settings when you need to verify the exact
token a client sent.

---

## Wildcard subdomains

Serving each project at `<slug>.mock.example.com` needs three things.

**1. The route.** A wildcard cannot be a custom domain, so it is a plain route
alongside the base one:

```jsonc
"routes": [
  { "pattern": "mock.example.com", "custom_domain": true },
  { "pattern": "*.mock.example.com/*", "zone_name": "example.com" }
],
"vars": {
  "WILDCARD_HOST": "mock.example.com"
}
```

**2. A proxied wildcard DNS record.** Wrangler cannot create this one — add it
on the zone: type `A`, name `*.mock`, content `192.0.2.1`, proxy status
**Proxied**. The address is a placeholder; a proxied record never reaches origin,
the Worker route takes over at the edge.

**3. A certificate that covers it.** Universal SSL covers `example.com` and
`*.example.com` — one label deep. A second-level wildcard such as
`*.mock.example.com` needs Total TLS or Advanced Certificate Manager. Check what
you already have before assuming:

```bash
echo | openssl s_client -servername mock.example.com -connect mock.example.com:443 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

Leave `WILDCARD_HOST` empty to disable subdomain routing entirely; `/m/<slug>/`
keeps working either way.

---

## Local development

```bash
# Build the panel once, then run the Worker: the real thing on :8787
npm run build && npm run dev
```

```bash
# While iterating on the panel, a second terminal gives hot reload on :5173
# (it proxies /__api and /m to the Worker on :8787)
npm run dev:ui
```

```bash
npm run typecheck
```

`worker-configuration.d.ts` is generated from `wrangler.jsonc` and committed, so
a fresh clone type-checks before you have a config of your own. Regenerate it
after changing bindings:

```bash
npm run cf-typegen
```

> [!NOTE]
> Once `routes` are configured, `wrangler dev` pins the request host to the
> first route and ignores the real `Host` header, so `foo.mock.localhost:8787`
> will not work. Force the host instead:
>
> ```bash
> npx wrangler dev --host demo.mock.example.com
> ```
>
> Every request then arrives as if it came in on that subdomain, and
> `http://localhost:8787/users/1` resolves against the `demo` project.

Local D1 state lives in `.wrangler/state`, keyed by `database_id`. Changing that
id in `wrangler.jsonc` points at a different local database, so re-run
`npx wrangler d1 migrations apply mockie --local` if tables go missing.

---

## Admin API

Every `/__api` route accepts `Authorization: Bearer <ADMIN_TOKEN>`, so the panel
is optional — endpoints can be provisioned from a script or CI.

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://mock.example.com/__api/projects
```

```bash
curl -X POST https://mock.example.com/__api/endpoints \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
        "project_id": "…",
        "method": "GET",
        "path_pattern": "/orders/:id",
        "status": 200,
        "body": "{\"id\": \"{{path.id}}\", \"total\": {{random.int(10,999)}}}"
      }'
```

| Route | Method | Purpose |
|---|---|---|
| `/__api/auth/login` `/logout` `/me` | `POST` `POST` `GET` | Session cookie for the panel |
| `/__api/config` | `GET` | Routing config the panel needs |
| `/__api/projects` | `GET` `POST` | List / create |
| `/__api/projects/:id` | `PATCH` `DELETE` | Update / delete with its endpoints and log |
| `/__api/projects/:id/endpoints` | `GET` | Endpoints of one project |
| `/__api/endpoints` | `POST` | Create |
| `/__api/endpoints/:id` | `PATCH` `DELETE` | Update / delete |
| `/__api/endpoints/:id/duplicate` | `POST` | Copy, disabled, at `priority + 1` |
| `/__api/requests` | `GET` `DELETE` | Filter the log / clear it |
| `/__api/requests/:id` | `GET` | One request in full |
| `/__api/stats` | `GET` | Totals, status breakdown, top paths |
| `/__api/preview` | `POST` | Render a template against sample values |

`GET /__api/requests` accepts `project`, `endpoint`, `matched`, `method`,
`status`, `q`, `since`, `before` and `limit`. `since` is what the panel's live
tail uses: pass the newest `created_at` you already hold.

Sessions are an HMAC-signed cookie keyed by `ADMIN_TOKEN` itself — there is no
session store to keep, and rotating the token invalidates every session.

---

## Architecture

```
Request
   │
   ├── <slug>.<WILDCARD_HOST>/*  ─┐
   ├── /m/<slug>/*               ─┴─► mock engine ──► KV bundle ──(miss)──► D1
   │                                       │
   │                                       └─► ctx.waitUntil(write request log)
   ├── /__api/*                  ────────► admin API ──► D1
   └── /__admin/*                ────────► Workers Assets (SPA)
```

| Path | Contents |
|---|---|
| `src/index.ts` | Host and path routing, the only place that decides what a request is |
| `src/mock/match.ts` | Pattern compilation and condition evaluation |
| `src/mock/template.ts` | The interpolator |
| `src/mock/handler.ts` | Request capture, response assembly, log writes |
| `src/admin/api.ts` | Admin API router and validation |
| `src/admin/auth.ts` | Token check and HMAC session cookies |
| `src/db.ts` | Row mapping and the KV-cached project bundle |
| `migrations/` | D1 schema |
| `web/` | React admin panel |

A project and its enabled endpoints are cached in KV as a single blob, so a
matched request usually costs one KV read and no D1 query. Writes from the admin
API invalidate that blob immediately, so an endpoint change takes effect on the
next request. Unknown slugs are cached as a tombstone for 60 s to keep bogus
traffic off D1.

Request logging happens in `ctx.waitUntil`, off the response path. The log is
pruned to `REQUEST_LOG_LIMIT` rows on roughly one write in twenty, which keeps
the table bounded without paying for a count on every request.

---

## Configuration

Set in `wrangler.jsonc` under `vars`:

| Var | Default | Meaning |
|---|---|---|
| `WILDCARD_HOST` | `""` | Base host for per-project subdomains. Empty disables them. |
| `REQUEST_LOG_LIMIT` | `2000` | Rows kept in the request log before pruning. |
| `MAX_BODY_BYTES` | `65536` | Largest request/response body stored; bigger ones are truncated and flagged. |

Set as a secret:

| Secret | Meaning |
|---|---|
| `ADMIN_TOKEN` | The only credential. Gates the panel and the whole admin API. |

---

## Limitations

- **No response delay or fault injection.** Latency simulation, random 5xx and
  timeouts are not implemented.
- **No proxy or record mode.** Mockie will not forward unmatched requests to a
  real upstream and capture the answer.
- **No OpenAPI import.** Endpoints are defined by hand or through the admin API.
- **The request log is a rolling buffer**, not an archive: old rows are deleted
  once the limit is passed.
- **Bodies are stored up to `MAX_BODY_BYTES`.** Anything larger is truncated for
  storage; the response the client receives is never affected.
- **The panel polls.** There is no WebSocket or SSE stream; new requests appear
  within about two seconds.

---

## Contributing

Issues and pull requests are welcome. Two things make a change easy to accept:

- `npm run typecheck` passes — both the Worker and the panel are strict
  TypeScript with no `any` in the seams.
- New matching or template behaviour comes with an example in the README table
  it belongs to.

The Worker deliberately has no runtime dependencies. A change that adds one
needs a reason that a few lines of code cannot cover.

---

## Author & License

[MIT](LICENSE) © **Rıza Sabuncu** — [@rizasabuncu](https://x.com/rizasabuncu)

If Mockie saved you from standing up yet another mock server,
you can [buy me a coffee](https://buymeacoffee.com/rizasabuncu).
