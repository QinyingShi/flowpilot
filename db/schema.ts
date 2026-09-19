export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'project_manager', 'member', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_email
    ON workspace_members(email)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(code)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_status_updated
    ON projects(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS project_memberships (
    member_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(member_id, project_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_memberships_project
    ON project_memberships(project_id, status, member_id)`,
  `CREATE TABLE IF NOT EXISTS project_records (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_records_type_status
    ON project_records(project_id, entity_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_project_records_owner
    ON project_records(project_id, owner_id)`,
  `CREATE TABLE IF NOT EXISTS project_member_permissions (
    member_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    permission TEXT NOT NULL CHECK (permission IN ('manage_version', 'approve_change', 'approve_release')),
    version_id TEXT NOT NULL DEFAULT '*',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(member_id, project_id, permission, version_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_member_permissions_lookup
    ON project_member_permissions(project_id, member_id, version_id, permission)`,
  `CREATE TABLE IF NOT EXISTS change_task_links (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    change_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, id),
    UNIQUE(project_id, change_id, task_id, relation_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_change_task_links_change
    ON change_task_links(project_id, change_id, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_change_task_links_task
    ON change_task_links(project_id, task_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS task_hierarchy (
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    parent_task_id TEXT,
    root_task_id TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 8),
    sort_order INTEGER NOT NULL DEFAULT 0,
    work_type TEXT NOT NULL,
    acceptance_criteria TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, task_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_hierarchy_parent_order
    ON task_hierarchy(project_id, parent_task_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_task_hierarchy_root
    ON task_hierarchy(project_id, root_task_id, level, sort_order)`,
  `CREATE TABLE IF NOT EXISTS plan_baselines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    baseline_key TEXT NOT NULL,
    label TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, version_id, baseline_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_baselines_version_time
    ON plan_baselines(project_id, version_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS milestone_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    milestone_key TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('planned', 'replanned', 'actual', 'forecast')),
    occurred_at TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'workbench',
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_milestone_events_version_node_time
    ON milestone_events(project_id, version_id, milestone_key, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform',
    connector TEXT NOT NULL,
    direction TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_events_connector_time
    ON sync_events(connector, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_events_project_time
    ON sync_events(project_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS connector_configs (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_connector_configs_project_status
    ON connector_configs(project_id, status, connector)`,
  `CREATE TABLE IF NOT EXISTS automation_rules (
    project_id TEXT NOT NULL,
    rule_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    channel TEXT NOT NULL DEFAULT 'workspace',
    rule_json TEXT NOT NULL DEFAULT '{}',
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, rule_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automation_rules_project_enabled
    ON automation_rules(project_id, enabled, rule_key)`,
  `CREATE TABLE IF NOT EXISTS inspection_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    summary_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inspection_runs_project_started
    ON inspection_runs(project_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS inspection_findings (
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    owner TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'acknowledged', 'resolved')),
    resolution_note TEXT,
    first_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    updated_by TEXT NOT NULL,
    PRIMARY KEY(project_id, fingerprint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inspection_findings_project_status
    ON inspection_findings(project_id, status, severity, last_detected_at DESC)`,
  `CREATE TABLE IF NOT EXISTS inspection_run_findings (
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(run_id, fingerprint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inspection_run_findings_project
    ON inspection_run_findings(project_id, run_id)`,
  `CREATE TABLE IF NOT EXISTS requirement_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('parsed', 'failed', 'archived')),
    parse_summary_json TEXT NOT NULL DEFAULT '{}',
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_documents_project_created
    ON requirement_documents(project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS requirement_drafts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('agile', 'waterfall')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'archived')),
    draft_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_drafts_project_status
    ON requirement_drafts(project_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS requirement_task_links (
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, task_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_task_links_document
    ON requirement_task_links(project_id, document_id, draft_id)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform',
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_time
    ON audit_logs(entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time
    ON audit_logs(actor_id, created_at DESC)`,
];
