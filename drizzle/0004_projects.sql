CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(code);

CREATE INDEX IF NOT EXISTS idx_projects_status_updated
ON projects(status, updated_at DESC);

INSERT OR IGNORE INTO projects
  (id, name, code, description, owner_id, status)
VALUES (
  'nebula-customer-platform',
  '星云客户平台',
  'NEBULA',
  '客户、订单、支付与增长能力建设',
  'local-user',
  'active'
);
