ALTER TABLE project_records RENAME TO project_records_legacy;

CREATE TABLE project_records (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_id TEXT,
  status TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'workbench',
  source_ref TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, id)
);

INSERT INTO project_records
  (project_id, id, entity_type, title, owner_id, status, source_system,
   source_ref, payload_json, created_at, updated_at)
SELECT 'nebula-customer-platform', id, entity_type, title, owner_id, status,
       source_system, source_ref, payload_json, created_at, updated_at
FROM project_records_legacy;

DROP TABLE project_records_legacy;

CREATE INDEX idx_project_records_type_status
ON project_records(project_id, entity_type, status);

CREATE INDEX idx_project_records_owner
ON project_records(project_id, owner_id);

CREATE TABLE IF NOT EXISTS project_memberships (
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(member_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_memberships_project
ON project_memberships(project_id, status, member_id);

CREATE TABLE IF NOT EXISTS project_member_permissions (
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('manage_version', 'approve_change', 'approve_release')),
  version_id TEXT NOT NULL DEFAULT '*',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(member_id, project_id, permission, version_id)
);

CREATE INDEX IF NOT EXISTS idx_project_member_permissions_lookup
ON project_member_permissions(project_id, member_id, version_id, permission);

INSERT OR IGNORE INTO project_memberships (member_id, project_id, status)
SELECT id, 'nebula-customer-platform',
       CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END
FROM workspace_members;

ALTER TABLE sync_events
ADD COLUMN project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform';

ALTER TABLE audit_logs
ADD COLUMN project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform';
