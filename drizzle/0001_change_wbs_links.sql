CREATE TABLE IF NOT EXISTS change_task_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, change_id, task_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_change_task_links_change
  ON change_task_links(project_id, change_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_change_task_links_task
  ON change_task_links(project_id, task_id, created_at DESC);
