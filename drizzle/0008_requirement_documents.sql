CREATE TABLE IF NOT EXISTS requirement_documents (
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
);

CREATE INDEX IF NOT EXISTS idx_requirement_documents_project_created
  ON requirement_documents(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS requirement_drafts (
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
);

CREATE INDEX IF NOT EXISTS idx_requirement_drafts_project_status
  ON requirement_drafts(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS requirement_task_links (
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_requirement_task_links_document
  ON requirement_task_links(project_id, document_id, draft_id);
