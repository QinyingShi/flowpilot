CREATE INDEX IF NOT EXISTS idx_sync_events_project_time
  ON sync_events(project_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS connector_configs (
  project_id TEXT NOT NULL,
  connector TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'live')),
  status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'configured', 'connected', 'error')),
  display_name TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_tested_at TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, connector)
);

CREATE INDEX IF NOT EXISTS idx_connector_configs_project_status
  ON connector_configs(project_id, status, connector);

CREATE TABLE IF NOT EXISTS automation_rules (
  project_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  channel TEXT NOT NULL DEFAULT 'workspace',
  rule_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_project_enabled
  ON automation_rules(project_id, enabled, rule_key);
