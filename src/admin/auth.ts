import type { Env } from '../types';

const COOKIE_NAME = 'mockie_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(env: Env, secure: boolean): Promise<string> {
  const payload = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(secret(env), payload);
  const value = `${payload}.${sig}`;
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * A request is authorized by either a valid session cookie or an
 * `Authorization: Bearer <ADMIN_TOKEN>` header (for curl/CI use).
 */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!secret(env)) return false;

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    if (checkToken(env, auth.slice(7))) return true;
  }

  const cookie = readCookie(request, COOKIE_NAME);
  if (!cookie) return false;

  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return false;

  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);

  const expected = await hmac(secret(env), payload);
  if (!timingSafeEqual(sig, expected)) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Trimmed on both sides: `echo "$T" | wrangler secret put ADMIN_TOKEN` stores a
 * trailing newline, which would otherwise reject the correct token with a
 * completely silent 401.
 */
const secret = (env: Env) => (env.ADMIN_TOKEN ?? '').trim();

export function checkToken(env: Env, token: string): boolean {
  const expected = secret(env);
  return expected !== '' && timingSafeEqual(token.trim(), expected);
}
