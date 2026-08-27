-- A ready-to-hit demo project so a fresh install returns something on first try.
INSERT INTO projects (id, slug, name, description, default_headers,
                      fallback_status, fallback_body, cors_enabled, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'demo',
  'Demo API',
  'Sample project created on first install. Safe to delete.',
  '{}', 404, '', 1,
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);

INSERT INTO endpoints (id, project_id, name, method, path_pattern, priority, enabled,
                       conditions, status, headers, body, body_mode, created_at, updated_at)
VALUES
(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  'List users', 'GET', '/users', 100, 1, '[]', 200,
  '{"content-type":"application/json"}',
  '{
  "page": {{query.page ?? 1}},
  "items": [{{#repeat query.limit ?? 3}}
    {
      "id": {{@index1}},
      "name": "{{faker.name}}",
      "email": "{{faker.email}}",
      "city": "{{faker.city}}"
    }{{@comma}}{{/repeat}}
  ]
}',
  'template',
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
),
(
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000001',
  'Get user by id', 'GET', '/users/:id', 100, 1, '[]', 200,
  '{"content-type":"application/json"}',
  '{"id": "{{path.id}}", "name": "{{faker.name}}", "created_at": "{{now}}"}',
  'template',
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
),
(
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000001',
  'Create user', 'POST', '/users', 100, 1, '[]', 201,
  '{"content-type":"application/json","x-request-id":"{{uuid}}"}',
  '{"id": "{{uuid}}", "name": "{{body.name ?? anonymous}}", "echo": {{body}} }',
  'template',
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
),
(
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000001',
  'Unauthorized when no bearer token', 'ANY', '/secure/*', 10, 1,
  '[{"source":"header","key":"authorization","op":"not_exists","value":""}]',
  401, '{"content-type":"application/json"}',
  '{"error": "missing_authorization"}',
  'template',
  strftime('%s','now') * 1000, strftime('%s','now') * 1000
);
