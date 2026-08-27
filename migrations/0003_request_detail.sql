-- Richer request capture: full URL, extracted path params, and the network /
-- geo / TLS facts Cloudflare attaches to every request.
ALTER TABLE requests ADD COLUMN url    TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN params TEXT NOT NULL DEFAULT '{}';
ALTER TABLE requests ADD COLUMN meta   TEXT NOT NULL DEFAULT '{}';

-- Per-project switch for masking Authorization/Cookie in the stored log.
-- On by default; turn it off when you need to debug the token you sent.
ALTER TABLE projects ADD COLUMN redact_headers INTEGER NOT NULL DEFAULT 1;
