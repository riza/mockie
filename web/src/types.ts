export type HttpMethod =
  | 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const METHODS: HttpMethod[] =
  ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type ConditionSource = 'query' | 'header' | 'body' | 'path';
export type ConditionOp =
  | 'eq' | 'neq' | 'contains' | 'not_contains'
  | 'exists' | 'not_exists' | 'regex' | 'gt' | 'lt';

export const CONDITION_OPS: { value: ConditionOp; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'not exists' },
  { value: 'regex', label: 'matches regex' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
];

export interface Condition {
  source: ConditionSource;
  key: string;
  op: ConditionOp;
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
  endpoint_count?: number;
  request_count?: number;
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

export interface RequestSummary {
  id: string;
  project_id: string | null;
  endpoint_id: string | null;
  matched: boolean;
  method: string;
  path: string;
  query: Record<string, string>;
  status: number;
  ip: string;
  country: string;
  user_agent: string;
  duration_ms: number;
  created_at: number;
  req_size: number;
  res_size: number;
}

/** Network, geo and TLS facts Cloudflare attaches to the request. */
export interface RequestMeta {
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
  colo?: string;
  ray?: string;
  http_protocol?: string;
  tls_version?: string;
  tls_cipher?: string;
  client_tcp_rtt?: number;
  verified_bot?: string;
  referer?: string;
  origin?: string;
  content_type?: string;
  content_length?: string;
}

export interface MatchedEndpoint {
  id: string;
  name: string;
  method: string;
  path_pattern: string;
  priority: number;
}

export interface RequestDetail extends Omit<RequestSummary, 'req_size' | 'res_size'> {
  url: string;
  params: Record<string, string>;
  meta: RequestMeta;
  project_slug: string | null;
  endpoint: MatchedEndpoint | null;
  req_headers: Record<string, string>;
  req_body: string;
  req_truncated: boolean;
  res_headers: Record<string, string>;
  res_body: string;
  res_truncated: boolean;
}

export interface Stats {
  total: number;
  matched: number;
  unmatched: number;
  avg_ms: number;
  by_status: { status: number; count: number }[];
  top_paths: { path: string; method: string; count: number }[];
}
