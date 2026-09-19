ALTER TABLE task_hierarchy RENAME TO task_hierarchy_legacy;

CREATE TABLE task_hierarchy (
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
);

INSERT INTO task_hierarchy
  (project_id, task_id, parent_task_id, root_task_id, level, sort_order,
   work_type, acceptance_criteria, created_at, updated_at)
SELECT project_id, task_id, parent_task_id, root_task_id, level, sort_order,
       work_type, acceptance_criteria, created_at, updated_at
FROM task_hierarchy_legacy;

DROP TABLE task_hierarchy_legacy;

CREATE INDEX idx_task_hierarchy_parent_order
ON task_hierarchy(project_id, parent_task_id, sort_order);

CREATE INDEX idx_task_hierarchy_root
ON task_hierarchy(project_id, root_task_id, level, sort_order);

ALTER TABLE change_task_links RENAME TO change_task_links_legacy;

CREATE TABLE change_task_links (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, id),
  UNIQUE(project_id, change_id, task_id, relation_type)
);

INSERT INTO change_task_links
  (project_id, id, change_id, task_id, relation_type, note, created_at)
SELECT project_id, id, change_id, task_id, relation_type, note, created_at
FROM change_task_links_legacy;

DROP TABLE change_task_links_legacy;

CREATE INDEX idx_change_task_links_change
ON change_task_links(project_id, change_id, created_at ASC);

CREATE INDEX idx_change_task_links_task
ON change_task_links(project_id, task_id, created_at DESC);
