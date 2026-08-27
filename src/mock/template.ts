/**
 * Tiny, sandbox-free template interpolator for mock response bodies.
 * No eval, no user code execution -- just a fixed set of resolvable names.
 *
 *   {{path.id}} {{query.page}} {{header.authorization}} {{body.user.email}}
 *   {{method}} {{url}} {{now}} {{timestamp}} {{uuid}}
 *   {{random.int(1,100)}} {{random.pick(red|green|blue)}} {{random.bool}}
 *   {{faker.firstName}} {{faker.email}} {{faker.city}}
 *   {{query.page ?? 1}}                        -- fallback when missing/empty
 *   {{#repeat 3}}{"i": {{@index}}}{{/repeat}}  -- repeated blocks (nestable)
 *   {{#repeat query.count}}...{{/repeat}}     -- count from a bare expression
 *
 * Inside a repeat block: {{@index}} {{@index1}} {{@first}} {{@last}} and
 * {{@comma}}, which emits a comma for every iteration but the last -- the
 * usual way to keep a generated JSON array valid.
 */

export interface TemplateScope {
  path: Record<string, string>;
  query: Record<string, string>;
  header: Record<string, string>;
  body: unknown;
  rawBody: string;
  method: string;
  url: string;
  /** Current iteration inside {{#repeat}}, 0 outside one. */
  index: number;
  /** Iteration count of the enclosing {{#repeat}}, 1 outside one. */
  count: number;
}

const FIRST_NAMES = ['Ada', 'Deniz', 'Elif', 'Kaan', 'Leyla', 'Mert', 'Nora', 'Onur', 'Selin', 'Tarik', 'Yasmin', 'Emre'];
const LAST_NAMES = ['Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Arslan', 'Dogan', 'Aydin', 'Ozturk', 'Kurt'];
const CITIES = ['Istanbul', 'Ankara', 'Izmir', 'Berlin', 'Lisbon', 'Osaka', 'Nairobi', 'Bogota', 'Toronto', 'Oslo'];
const COUNTRIES = ['Turkiye', 'Germany', 'Portugal', 'Japan', 'Kenya', 'Colombia', 'Canada', 'Norway'];
const COMPANIES = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay'];
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'tempor'];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function fakerValue(key: string): string | undefined {
  switch (key) {
    case 'firstName': return pick(FIRST_NAMES);
    case 'lastName': return pick(LAST_NAMES);
    case 'name': return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case 'email': return `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}@example.com`;
    case 'username': return `${pick(FIRST_NAMES).toLowerCase()}${randInt(10, 999)}`;
    case 'city': return pick(CITIES);
    case 'country': return pick(COUNTRIES);
    case 'company': return pick(COMPANIES);
    case 'phone': return `+90 5${randInt(10, 99)} ${randInt(100, 999)} ${randInt(1000, 9999)}`;
    case 'word': return pick(WORDS);
    case 'sentence': return Array.from({ length: randInt(5, 10) }, () => pick(WORDS)).join(' ') + '.';
    case 'paragraph': return Array.from({ length: randInt(3, 5) }, () =>
      Array.from({ length: randInt(5, 10) }, () => pick(WORDS)).join(' ') + '.').join(' ');
    case 'url': return `https://example.com/${pick(WORDS)}`;
    case 'avatar': return `https://i.pravatar.cc/150?u=${crypto.randomUUID()}`;
    case 'bool': return Math.random() < 0.5 ? 'true' : 'false';
    default: return undefined;
  }
}

function dotGet(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Parse `random.int(1,100)` / `random.pick(a|b)` into name + args. */
function parseCall(expr: string): { name: string; args: string[] } {
  const m = /^([A-Za-z0-9_.@]+)\s*\((.*)\)$/.exec(expr);
  if (!m) return { name: expr, args: [] };
  const inner = m[2].trim();
  if (inner === '') return { name: m[1], args: [] };
  const sep = inner.includes('|') ? '|' : ',';
  return { name: m[1], args: inner.split(sep).map((s) => s.trim()) };
}

function resolve(expr: string, scope: TemplateScope): string | undefined {
  const { name, args } = parseCall(expr.trim());

  if (name === '@index') return String(scope.index);
  if (name === '@index1') return String(scope.index + 1);
  if (name === '@first') return String(scope.index === 0);
  if (name === '@last') return String(scope.index === scope.count - 1);
  if (name === '@comma') return scope.index < scope.count - 1 ? ',' : '';
  if (name === 'method') return scope.method;
  if (name === 'url') return scope.url;
  if (name === 'uuid') return crypto.randomUUID();
  if (name === 'timestamp') return String(Date.now());
  if (name === 'now' || name === 'now.iso') return new Date().toISOString();
  if (name === 'now.unix') return String(Math.floor(Date.now() / 1000));

  if (name === 'random.int') return String(randInt(Number(args[0] ?? 0), Number(args[1] ?? 100)));
  if (name === 'random.float') {
    const lo = Number(args[0] ?? 0);
    const hi = Number(args[1] ?? 1);
    return (lo + Math.random() * (hi - lo)).toFixed(Number(args[2] ?? 2));
  }
  if (name === 'random.bool') return Math.random() < 0.5 ? 'true' : 'false';
  if (name === 'random.pick') return args.length ? pick(args) : '';
  if (name === 'random.hex') {
    const len = Number(args[0] ?? 8);
    let out = '';
    while (out.length < len) out += Math.floor(Math.random() * 16).toString(16);
    return out.slice(0, len);
  }

  if (name.startsWith('faker.')) return fakerValue(name.slice(6));

  const dot = name.indexOf('.');
  const root = dot === -1 ? name : name.slice(0, dot);
  const rest = dot === -1 ? '' : name.slice(dot + 1);

  switch (root) {
    case 'path': return scope.path[rest];
    case 'query': return scope.query[rest];
    case 'header': return scope.header[rest.toLowerCase()];
    case 'body': return rest === '' ? scope.rawBody : stringify(dotGet(scope.body, rest));
    default: return undefined;
  }
}

/** Split `expr ?? fallback` respecting nothing fancier than a literal fallback. */
function evaluate(raw: string, scope: TemplateScope): string {
  const idx = raw.indexOf('??');
  const expr = idx === -1 ? raw : raw.slice(0, idx);
  const fallback = idx === -1 ? '' : raw.slice(idx + 2).trim().replace(/^["'](.*)["']$/, '$1');

  const value = resolve(expr, scope);
  if (value === undefined || value === '') return fallback;
  return value;
}

const REPEAT_OPEN = /\{\{#repeat\s+([^}]*?)\}\}/;

/** Expand `{{#repeat n}}...{{/repeat}}` blocks, innermost-aware via depth counting. */
function expandRepeats(input: string, scope: TemplateScope, depth = 0): string {
  if (depth > 5) return input;

  const open = REPEAT_OPEN.exec(input);
  if (!open) return input;

  const bodyStart = open.index + open[0].length;

  // Walk forward tracking nested #repeat/\/repeat pairs to find our closing tag.
  let level = 1;
  let cursor = bodyStart;
  let closeStart = -1;
  const CLOSE = '{{/repeat}}';

  while (cursor < input.length) {
    const nextOpen = input.indexOf('{{#repeat', cursor);
    const nextClose = input.indexOf(CLOSE, cursor);
    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      level++;
      cursor = nextOpen + 9;
    } else {
      level--;
      if (level === 0) {
        closeStart = nextClose;
        break;
      }
      cursor = nextClose + CLOSE.length;
    }
  }

  if (closeStart === -1) return input; // unbalanced; leave as-is

  const inner = input.slice(bodyStart, closeStart);
  const after = input.slice(closeStart + CLOSE.length);

  // The count is a literal (`3`) or a bare expression (`query.n`), no braces.
  const countRaw = open[1].trim();
  const parsedCount = Number(countRaw) || Number(evaluate(countRaw, scope)) || 0;
  const count = Math.max(0, Math.min(500, parsedCount));

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    // Depth-first: nested blocks resolve their own @index before we resolve ours,
    // so only this level's tokens are left by the time we substitute.
    const piece = expandRepeats(inner, { ...scope, index: i, count }, depth + 1);
    parts.push(
      piece.replace(/\{\{\s*@(index1|index|first|last|comma)\s*\}\}/g, (_m, token: string) => {
        switch (token) {
          case 'index': return String(i);
          case 'index1': return String(i + 1);
          case 'first': return String(i === 0);
          case 'last': return String(i === count - 1);
          default: return i < count - 1 ? ',' : '';
        }
      }),
    );
  }

  return input.slice(0, open.index) + parts.join('') + expandRepeats(after, scope, depth);
}

export function renderTemplate(input: string, scope: TemplateScope): string {
  if (!input.includes('{{')) return input;

  const expanded = expandRepeats(input, scope);

  return expanded.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, expr: string) => {
    if (expr.startsWith('#') || expr.startsWith('/')) return whole;
    const value = evaluate(expr, scope);
    return value ?? '';
  });
}
