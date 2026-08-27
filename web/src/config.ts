/**
 * Panel-side view of the Worker's routing config, fetched once after login.
 * Module state rather than context: App only renders the shell once it is set.
 */
let wildcardHost = '';

export function setWildcardHost(host: string) {
  wildcardHost = host.trim();
}

export function getWildcardHost(): string {
  return wildcardHost;
}

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost');

/** `https://<slug>.<wildcard host>` — empty when subdomain routing is off. */
export function subdomainUrl(slug: string): string {
  if (!wildcardHost) return '';
  const protocol = isLocal(wildcardHost) ? window.location.protocol : 'https:';
  return `${protocol}//${slug}.${wildcardHost}`;
}

/** `<origin>/m/<slug>` — always available. */
export function pathUrl(slug: string): string {
  return `${window.location.origin}/m/${slug}`;
}

/** The URL to show first for a project. */
export function primaryUrl(slug: string): string {
  return subdomainUrl(slug) || pathUrl(slug);
}
