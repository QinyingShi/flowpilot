CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'project_manager', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_email
  ON workspace_members(email);

CREATE TABLE IF NOT EXISTS project_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_id TEXT,
  status TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'workbench',
  source_ref TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_records_type_status
  ON project_records(entity_type, status);
CREATE INDEX IF NOT EXISTS idx_project_records_owner
ON project_records(owner_id);

CREATE TABLE IF NOT EXISTS plan_baselines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  baseline_key TEXT NOT NULL,
  label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, version_id, baseline_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_baselines_version_time
ON plan_baselines(project_id, version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS milestone_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  milestone_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('planned', 'replanned', 'actual', 'forecast')),
  occurred_at TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'workbench',
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_milestone_events_version_node_time
ON milestone_events(project_id, version_id, milestone_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connector TEXT NOT NULL,
  direction TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_events_connector_time
  ON sync_events(connector, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_time
  ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time
  ON audit_logs(actor_id, created_at DESC);
