CREATE TABLE IF NOT EXISTS task_hierarchy (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_task_id TEXT,
  root_task_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 8),
  sort_order INTEGER NOT NULL DEFAULT 0,
  work_type TEXT NOT NULL,
  acceptance_criteria TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_hierarchy_parent_order
  ON task_hierarchy(project_id, parent_task_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_task_hierarchy_root
  ON task_hierarchy(project_id, root_task_id, level, sort_order);
