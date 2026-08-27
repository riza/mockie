-- Mockie schema
-- A "project" namespaces a set of mock endpoints under /m/<slug>/...

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Response headers merged into every response of this project (JSON object).
  default_headers TEXT NOT NULL DEFAULT '{}',
  -- Reply to unmatched requests with this status/body instead of 404.
  fallback_status INTEGER NOT NULL DEFAULT 404,
  fallback_body   TEXT NOT NULL DEFAULT '',
  cors_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE endpoints (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  -- GET/POST/... or ANY
  method       TEXT NOT NULL DEFAULT 'GET',
  -- /users/:id  |  /files/*  |  /exact/path
  path_pattern TEXT NOT NULL,
  -- Lower number wins when several endpoints match.
  priority     INTEGER NOT NULL DEFAULT 100,
  enabled      INTEGER NOT NULL DEFAULT 1,
  -- JSON array of extra match conditions, see src/mock/match.ts
  conditions   TEXT NOT NULL DEFAULT '[]',

  status       INTEGER NOT NULL DEFAULT 200,
  headers      TEXT NOT NULL DEFAULT '{"content-type":"application/json"}',
  body         TEXT NOT NULL DEFAULT '',
  -- 'template' runs the {{...}} interpolator over the body, 'raw' does not.
  body_mode    TEXT NOT NULL DEFAULT 'template',

  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_endpoints_project ON endpoints (project_id, enabled, priority);

CREATE TABLE requests (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  endpoint_id   TEXT,
  matched       INTEGER NOT NULL DEFAULT 0,

  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  query         TEXT NOT NULL DEFAULT '{}',
  req_headers   TEXT NOT NULL DEFAULT '{}',
  req_body      TEXT NOT NULL DEFAULT '',
  req_truncated INTEGER NOT NULL DEFAULT 0,

  status        INTEGER NOT NULL DEFAULT 0,
  res_headers   TEXT NOT NULL DEFAULT '{}',
  res_body      TEXT NOT NULL DEFAULT '',
  res_truncated INTEGER NOT NULL DEFAULT 0,

  ip            TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_requests_recent  ON requests (created_at DESC);
CREATE INDEX idx_requests_project ON requests (project_id, created_at DESC);
CREATE INDEX idx_requests_endpoint ON requests (endpoint_id, created_at DESC);
