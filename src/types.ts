export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  /**
   * Base host for per-project subdomains, e.g. "mock.example.com" routes
   * acme.mock.example.com to the project with slug "acme". Empty disables it.
   */
  WILDCARD_HOST?: string;
  REQUEST_LOG_LIMIT?: string;
  MAX_BODY_BYTES?: string;
}

export type HttpMethod =
  | 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Extra match condition evaluated after method + path already matched. */
export interface Condition {
  /** Where to read the value from. */
  source: 'query' | 'header' | 'body' | 'path';
  /** Key within the source. For `body`, a dot path such as `user.email`. */
  key: string;
  op:
    | 'eq' | 'neq'
    | 'contains' | 'not_contains'
    | 'exists' | 'not_exists'
    | 'regex'
    | 'gt' | 'lt';
  value?: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  default_headers: Record<string, string>;
  fallback_status: number;
  fallback_body: string;
  cors_enabled: boolean;
  redact_headers: boolean;
  created_at: number;
  updated_at: number;
}

export interface Endpoint {
  id: string;
  project_id: string;
  name: string;
  method: HttpMethod;
  path_pattern: string;
  priority: number;
  enabled: boolean;
  conditions: Condition[];
  status: number;
  headers: Record<string, string>;
  body: string;
  body_mode: 'template' | 'raw';
  created_at: number;
  updated_at: number;
}

/** Everything the mock engine needs for one project, cached in KV as one blob. */
export interface ProjectBundle {
  project: Project;
  endpoints: Endpoint[];
}
