CREATE TABLE IF NOT EXISTS inspection_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inspection_runs_project_started
  ON inspection_runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS inspection_findings (
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
);

CREATE INDEX IF NOT EXISTS idx_inspection_findings_project_status
  ON inspection_findings(project_id, status, severity, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS inspection_run_findings (
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(run_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_inspection_run_findings_project
  ON inspection_run_findings(project_id, run_id);
