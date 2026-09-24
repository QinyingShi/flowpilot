from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4
from zoneinfo import ZoneInfo

from .ai_requirements import analyze_requirement_with_openai
from .requirement_parser import (
    build_requirement_draft,
    decode_document,
    document_sha256,
    extract_text,
    merge_ai_requirement_draft,
    safe_file_name,
)


PROJECT_ID = "nebula-customer-platform"
DEFAULT_DATABASE_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "project_command_center.db"
)
SEED_DATA_PATH = Path(__file__).resolve().parents[1] / "seed_data.json"

SCHEMA = """
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

CREATE TABLE IF NOT EXISTS project_memberships (
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(member_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_memberships_project
  ON project_memberships(project_id, status, member_id);

CREATE TABLE IF NOT EXISTS project_records (
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

CREATE TABLE IF NOT EXISTS change_task_links (
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
CREATE INDEX IF NOT EXISTS idx_change_task_links_change
  ON change_task_links(project_id, change_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_change_task_links_task
  ON change_task_links(project_id, task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_hierarchy (
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
CREATE INDEX IF NOT EXISTS idx_task_hierarchy_parent_order
  ON task_hierarchy(project_id, parent_task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_task_hierarchy_root
  ON task_hierarchy(project_id, root_task_id, level, sort_order);

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
  project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform',
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

CREATE TABLE IF NOT EXISTS external_work_evidence (
  project_id TEXT NOT NULL,
  connector TEXT NOT NULL,
  external_id TEXT NOT NULL,
  task_id TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('commit', 'pull_request')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, connector, external_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_external_work_evidence_task_time
  ON external_work_evidence(project_id, task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_work_evidence_connector_time
  ON external_work_evidence(project_id, connector, occurred_at DESC);

CREATE TABLE IF NOT EXISTS external_quality_issues (
  project_id TEXT NOT NULL,
  connector TEXT NOT NULL DEFAULT 'jira',
  external_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
  status TEXT NOT NULL,
  status_category TEXT NOT NULL CHECK (status_category IN ('todo', 'in_progress', 'done')),
  assignee TEXT NOT NULL DEFAULT '',
  version_id TEXT,
  task_id TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  created_at_external TEXT NOT NULL,
  updated_at_external TEXT NOT NULL,
  resolved_at TEXT,
  url TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, connector, external_id)
);
CREATE INDEX IF NOT EXISTS idx_quality_issues_project_version_status
  ON external_quality_issues(project_id, version_id, status_category, severity);
CREATE INDEX IF NOT EXISTS idx_quality_issues_project_task
  ON external_quality_issues(project_id, task_id, updated_at_external DESC);

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL DEFAULT 'nebula-customer-platform',
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
"""

DEMO_BASELINES = [
    (
        "demo-v09-b0",
        "v0.9",
        "B0",
        "初始版本计划",
        {
            "development": "08/20–09/02",
            "integration": "09/03–09/04",
            "testEntry": "09/06",
            "testing": "09/06–09/11",
            "release": "09/14",
            "reason": "立项范围确认",
        },
    ),
    (
        "demo-v10-b0",
        "v1.0",
        "B0",
        "初始版本计划",
        {
            "development": "09/03–09/16",
            "integration": "09/17–09/22",
            "testEntry": "09/23",
            "testing": "09/23–09/26",
            "release": "09/27",
            "reason": "需求基线冻结",
        },
    ),
    (
        "demo-v10-b1",
        "v1.0",
        "B1",
        "支付变更后计划",
        {
            "development": "09/03–09/17",
            "integration": "09/18–09/24",
            "testEntry": "09/28",
            "testing": "09/28–09/29",
            "release": "09/30",
            "reason": "支付接口范围变化并避开中秋假期",
        },
    ),
    (
        "demo-v11-b0",
        "v1.1",
        "B0",
        "初始版本计划",
        {
            "development": "09/18–09/30",
            "integration": "10/08–10/12",
            "testEntry": "10/13",
            "testing": "10/13–10/19",
            "release": "10/20",
            "reason": "初始排期并避开国庆假期",
        },
    ),
]

DEMO_ACTUALS = [
    ("v0.9", "需求评审", "2026-08-20", "需求基线按期确认"),
    ("v0.9", "技术评审", "2026-08-23", "技术方案评审通过"),
    ("v0.9", "用例评审", "2026-08-28", "验收用例评审通过"),
    ("v0.9", "联合联调", "2026-09-04", "较计划晚 1 天完成"),
    ("v0.9", "提测", "2026-09-06", "准入检查通过"),
    ("v1.0", "需求评审", "2026-09-03", "需求基线按期确认"),
    ("v1.0", "技术评审", "2026-09-07", "较计划晚 1 天完成"),
]

DEFAULT_AUTOMATION_RULES = [
    ("task_assignment", True, "workspace", {"sendImmediately": True}),
    ("progress_drift", True, "workspace", {"thresholdPercent": 5}),
    ("due_reminder", True, "workspace", {"leadHours": 24, "repeatHours": 12}),
    (
        "git_verification",
        True,
        "workspace",
        {"staleHours": 24, "syncIntervalMinutes": 30},
    ),
    (
        "quality_warning",
        True,
        "workspace",
        {"p0Limit": 0, "p1Limit": 3, "reopenRate": 10, "syncIntervalMinutes": 30},
    ),
    (
        "ai_inspection",
        True,
        "workspace",
        {"intervalMinutes": 30, "loadThreshold": 105, "riskStaleHours": 24},
    ),
]


def _insert_default_automation_rules(
    db: sqlite3.Connection, project_id: str, actor_id: str
) -> None:
    db.executemany(
        """INSERT OR IGNORE INTO automation_rules
          (project_id, rule_key, enabled, channel, rule_json, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (
                project_id,
                rule_key,
                int(enabled),
                channel,
                json.dumps(config, ensure_ascii=False),
                actor_id,
            )
            for rule_key, enabled, channel, config in DEFAULT_AUTOMATION_RULES
        ],
    )


def _merge_automation_rule_defaults(db: sqlite3.Connection) -> None:
    """Add newly introduced defaults without overwriting user choices."""
    defaults = {rule_key: config for rule_key, _, _, config in DEFAULT_AUTOMATION_RULES}
    rows = db.execute(
        "SELECT project_id, rule_key, rule_json FROM automation_rules"
    ).fetchall()
    for row in rows:
        default_config = defaults.get(str(row["rule_key"]))
        if default_config is None:
            continue
        try:
            current_config = json.loads(row["rule_json"] or "{}")
        except json.JSONDecodeError:
            current_config = {}
        merged_config = {**default_config, **current_config}
        if merged_config == current_config:
            continue
        db.execute(
            """UPDATE automation_rules
               SET rule_json = ?, updated_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND rule_key = ?""",
            (
                json.dumps(merged_config, ensure_ascii=False),
                row["project_id"],
                row["rule_key"],
            ),
        )


def database_path() -> Path:
    configured = os.getenv("PROJECT_DB_PATH")
    return (
        Path(configured).expanduser().resolve()
        if configured
        else DEFAULT_DATABASE_PATH
    )


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def database_health() -> dict[str, str]:
    with connection() as db:
        result = db.execute("PRAGMA quick_check(1)").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("database_quick_check_failed")
        db.execute("SELECT 1 FROM projects LIMIT 1").fetchone()
    return {"status": "ok", "database": "sqlite"}


def _migrate_project_record_scope(db: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in db.execute("PRAGMA table_info(project_records)")
    }
    if "project_id" not in columns:
        db.execute("ALTER TABLE project_records RENAME TO project_records_legacy")
        db.execute(
            """CREATE TABLE project_records (
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
            )"""
        )
        db.execute(
            """INSERT INTO project_records
              (project_id, id, entity_type, title, owner_id, status, source_system,
               source_ref, payload_json, created_at, updated_at)
            SELECT ?, id, entity_type, title, owner_id, status, source_system,
                   source_ref, payload_json, created_at, updated_at
            FROM project_records_legacy""",
            (PROJECT_ID,),
        )
        db.execute("DROP TABLE project_records_legacy")
    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_project_records_type_status
           ON project_records(project_id, entity_type, status)"""
    )
    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_project_records_owner
           ON project_records(project_id, owner_id)"""
    )


def _migrate_event_scope(db: sqlite3.Connection) -> None:
    for table_name in ("sync_events", "audit_logs"):
        columns = {
            row["name"]
            for row in db.execute(f"PRAGMA table_info({table_name})")
        }
        if "project_id" not in columns:
            db.execute(
                f"""ALTER TABLE {table_name}
                    ADD COLUMN project_id TEXT NOT NULL
                    DEFAULT '{PROJECT_ID}'"""
            )


def _migrate_project_child_keys(db: sqlite3.Connection) -> None:
    hierarchy_pk = {
        row["name"]
        for row in db.execute("PRAGMA table_info(task_hierarchy)")
        if row["pk"]
    }
    if hierarchy_pk != {"project_id", "task_id"}:
        db.execute("ALTER TABLE task_hierarchy RENAME TO task_hierarchy_legacy")
        db.execute(
            """CREATE TABLE task_hierarchy (
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
            )"""
        )
        db.execute(
            """INSERT INTO task_hierarchy
              (project_id, task_id, parent_task_id, root_task_id, level,
               sort_order, work_type, acceptance_criteria, created_at, updated_at)
            SELECT project_id, task_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria, created_at, updated_at
            FROM task_hierarchy_legacy"""
        )
        db.execute("DROP TABLE task_hierarchy_legacy")

    links_pk = {
        row["name"]
        for row in db.execute("PRAGMA table_info(change_task_links)")
        if row["pk"]
    }
    if links_pk != {"project_id", "id"}:
        db.execute("ALTER TABLE change_task_links RENAME TO change_task_links_legacy")
        db.execute(
            """CREATE TABLE change_task_links (
              project_id TEXT NOT NULL,
              id TEXT NOT NULL,
              change_id TEXT NOT NULL,
              task_id TEXT NOT NULL,
              relation_type TEXT NOT NULL,
              note TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(project_id, id),
              UNIQUE(project_id, change_id, task_id, relation_type)
            )"""
        )
        db.execute(
            """INSERT INTO change_task_links
              (project_id, id, change_id, task_id, relation_type, note, created_at)
            SELECT project_id, id, change_id, task_id, relation_type, note, created_at
            FROM change_task_links_legacy"""
        )
        db.execute("DROP TABLE change_task_links_legacy")

    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_task_hierarchy_parent_order
           ON task_hierarchy(project_id, parent_task_id, sort_order)"""
    )
    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_task_hierarchy_root
           ON task_hierarchy(project_id, root_task_id, level, sort_order)"""
    )
    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_change_task_links_change
           ON change_task_links(project_id, change_id, created_at ASC)"""
    )
    db.execute(
        """CREATE INDEX IF NOT EXISTS idx_change_task_links_task
           ON change_task_links(project_id, task_id, created_at DESC)"""
    )


def _change_work_type(phase: str) -> str:
    if "后端" in phase or "接口" in phase:
        return "后端"
    if "前端" in phase or "交互" in phase:
        return "前端"
    if "联调" in phase:
        return "联调"
    if "测试" in phase or "验收" in phase or "回归" in phase:
        return "测试"
    return "需求"


def _migrate_flat_change_wbs(db: sqlite3.Connection) -> None:
    """Upgrade already-applied flat change tasks to a parent/child hierarchy."""
    rows = db.execute(
        """SELECT id, payload_json FROM project_records
           WHERE project_id = ? AND entity_type = 'change'""",
        (PROJECT_ID,),
    ).fetchall()
    for row in rows:
        change = json.loads(row["payload_json"])
        draft = change.get("wbsDraft") or []
        child_ids = change.get("wbsAppliedTaskIds") or []
        if (
            not draft
            or not child_ids
            or any(item.get("parentTaskId") is None for item in draft if "parentTaskId" in item)
        ):
            continue
        children = [item for item in draft if item.get("task", [None])[0] in child_ids]
        if not children:
            continue
        parent_id = f"{change['id']}-WBS"
        starts = [item["task"][7] for item in children]
        ends = [item["task"][8] for item in children]
        parent_task = [
            parent_id,
            change["title"],
            "星云客户平台",
            change["targetVersion"],
            change["owner"],
            "未开始",
            "高",
            min(starts),
            max(ends),
            "0%",
            "0h",
            "—",
            "中",
        ]
        parent_draft = {
            "id": f"{change['id']}-DRAFT-PARENT",
            "operation": "新增",
            "phase": "需求/用户故事",
            "task": parent_task,
            "linkedTasks": change.get("affectedTasks", []),
            "reason": f"承接 {change['id']} 的整体交付责任与进度汇总",
            "parentTaskId": None,
            "workType": "父任务",
            "acceptanceCriteria": "全部子任务完成并通过版本验收",
        }
        upgraded = [parent_draft]
        for index, item in enumerate(children, start=1):
            phase = str(item.get("phase", item["task"][1]))
            item.update(
                {
                    "parentTaskId": parent_id,
                    "workType": _change_work_type(phase),
                    "acceptanceCriteria": "完成交付物、自测并通过对应阶段验收",
                }
            )
            upgraded.append(item)
            db.execute(
                """
                INSERT OR IGNORE INTO task_hierarchy
                  (task_id, project_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    item["task"][0],
                    PROJECT_ID,
                    parent_id,
                    parent_id,
                    index,
                    item["workType"],
                    item["acceptanceCriteria"],
                ),
            )
        change["wbsDraft"] = upgraded
        db.execute(
            """
            INSERT OR IGNORE INTO project_records
              (project_id, id, entity_type, title, owner_id, status, payload_json)
            VALUES (?, ?, 'task', ?, ?, '未开始', ?)
            """,
            (
                PROJECT_ID,
                parent_id,
                change["title"],
                change["owner"],
                json.dumps(parent_task, ensure_ascii=False),
            ),
        )
        db.execute(
            """
            INSERT OR IGNORE INTO task_hierarchy
              (task_id, project_id, parent_task_id, root_task_id, level,
               sort_order, work_type, acceptance_criteria)
            VALUES (?, ?, NULL, ?, 0, 0, '父任务', ?)
            """,
            (parent_id, PROJECT_ID, parent_id, parent_draft["acceptanceCriteria"]),
        )
        db.execute(
            """UPDATE project_records SET payload_json = ?, updated_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND id = ?""",
            (json.dumps(change, ensure_ascii=False), PROJECT_ID, change["id"]),
        )


def initialize_database() -> None:
    with connection() as db:
        seed_demo_data = os.getenv(
            "PROJECT_SEED_DEMO_DATA",
            "true" if os.getenv("PROJECT_ENV") != "production" else "false",
        ).lower() == "true"
        db.executescript(SCHEMA)
        _migrate_project_record_scope(db)
        _migrate_event_scope(db)
        db.execute(
            """CREATE INDEX IF NOT EXISTS idx_sync_events_project_time
               ON sync_events(project_id, occurred_at DESC)"""
        )
        _migrate_project_child_keys(db)
        default_project_name = "星云客户平台" if seed_demo_data else "FlowPilot 项目"
        default_project_code = "NEBULA" if seed_demo_data else "FLOWPILOT"
        default_project_description = (
            "客户、订单、支付与增长能力建设"
            if seed_demo_data
            else "生产工作区默认项目，可在项目中心修改"
        )
        db.execute(
            """INSERT OR IGNORE INTO projects
              (id, name, code, description, owner_id, status)
            VALUES (?, ?, ?, ?, 'local-user', 'active')""",
            (
                PROJECT_ID,
                default_project_name,
                default_project_code,
                default_project_description,
            ),
        )
        _insert_default_automation_rules(db, PROJECT_ID, "system")
        _merge_automation_rule_defaults(db)
        seed_data = (
            json.loads(SEED_DATA_PATH.read_text(encoding="utf-8"))
            if seed_demo_data
            else {"tasks": [], "resources": [], "risks": [], "meetings": []}
        )
        seed_records = []
        for task in seed_data["tasks"]:
            seed_records.append(
                (
                    PROJECT_ID,
                    task[0],
                    "task",
                    task[1],
                    task[4],
                    task[5],
                    json.dumps(task, ensure_ascii=False),
                )
            )
        for resource in seed_data["resources"]:
            seed_records.append(
                (
                    PROJECT_ID,
                    resource["name"],
                    "resource",
                    resource["name"],
                    None,
                    "active",
                    json.dumps(resource, ensure_ascii=False),
                )
            )
        for risk in seed_data["risks"]:
            seed_records.append(
                (
                    PROJECT_ID,
                    risk["id"],
                    "risk",
                    risk["title"],
                    risk["owner"],
                    risk["status"],
                    json.dumps(risk, ensure_ascii=False),
                )
            )
        for meeting in seed_data["meetings"]:
            seed_records.append(
                (
                    PROJECT_ID,
                    meeting["id"],
                    "meeting",
                    meeting["title"],
                    meeting["attendees"],
                    meeting["status"],
                    json.dumps(meeting, ensure_ascii=False),
                )
            )
        for change in seed_data.get("changes", []):
            seed_records.append(
                (
                    PROJECT_ID,
                    change["id"],
                    "change",
                    change["title"],
                    change["owner"],
                    change["status"],
                    json.dumps(change, ensure_ascii=False),
                )
            )
        for blocker in seed_data.get("blockers", []):
            seed_records.append(
                (
                    PROJECT_ID,
                    blocker["id"],
                    "blocker",
                    blocker["reason"],
                    blocker["owner"],
                    blocker["status"],
                    json.dumps(blocker, ensure_ascii=False),
                )
            )
        for config in (
            [
                {"version": "v0.9", "mode": "waterfall", "label": "传统瀑布", "locked": True},
                {"version": "v1.0", "mode": "agile", "label": "敏捷迭代", "locked": True},
                {"version": "v1.1", "mode": "agile", "label": "敏捷迭代", "locked": True},
            ]
            if seed_demo_data
            else []
        ):
            seed_records.append(
                (
                    PROJECT_ID,
                    f"VERSION-CONFIG-{config['version']}",
                    "version_config",
                    f"{config['version']} delivery mode",
                    None,
                    "locked" if config["locked"] else "draft",
                    json.dumps(config, ensure_ascii=False),
                )
            )
        db.executemany(
            """
            INSERT OR IGNORE INTO project_records
              (project_id, id, entity_type, title, owner_id, status, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            seed_records,
        )
        _migrate_flat_change_wbs(db)
        db.executemany(
            """
            INSERT OR IGNORE INTO plan_baselines
              (id, project_id, version_id, baseline_key, label, snapshot_json, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'ai-demo')
            """,
            [
                (
                    row_id,
                    PROJECT_ID,
                    version_id,
                    key,
                    label,
                    json.dumps(snapshot, ensure_ascii=False),
                )
                for row_id, version_id, key, label, snapshot in (
                    DEMO_BASELINES if seed_demo_data else []
                )
            ],
        )
        db.executemany(
            """
            INSERT INTO milestone_events
              (project_id, version_id, milestone_key, event_type, occurred_at, source_system, detail)
            SELECT ?, ?, ?, 'actual', ?, 'workbench', ?
            WHERE NOT EXISTS (
              SELECT 1 FROM milestone_events
              WHERE project_id = ? AND version_id = ? AND milestone_key = ?
                AND event_type = 'actual' AND occurred_at = ?
            )
            """,
            [
                (
                    PROJECT_ID,
                    version_id,
                    milestone,
                    date,
                    detail,
                    PROJECT_ID,
                    version_id,
                    milestone,
                    date,
                )
                for version_id, milestone, date, detail in (
                    DEMO_ACTUALS if seed_demo_data else []
                )
            ],
        )
        db.executemany(
            """
            INSERT OR IGNORE INTO change_task_links
              (id, project_id, change_id, task_id, relation_type, note)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                [
                (
                    "CR-012-2.2-impact",
                    PROJECT_ID,
                    "CR-012",
                    "2.2",
                    "历史影响",
                    "支付失败补偿规则影响支付网关联调",
                ),
                (
                    "CR-012-2.3-impact",
                    PROJECT_ID,
                    "CR-012",
                    "2.3",
                    "历史影响",
                    "支付失败补偿规则影响订单状态补偿",
                ),
                ]
                if seed_demo_data
                else []
            ),
        )
        active_admins = db.execute(
            """SELECT COUNT(*) AS total FROM workspace_members
               WHERE role = 'admin' AND status = 'active'"""
        ).fetchone()["total"]
        if active_admins == 0:
            preferred_email = os.getenv("PROJECT_BOOTSTRAP_ADMIN_EMAIL", "").strip()
            if not preferred_email and os.getenv("PROJECT_ENV") != "production":
                preferred_email = "admin@flowpilot.local"
            if preferred_email:
                db.execute(
                    """UPDATE workspace_members
                       SET role = 'admin', status = 'active',
                           updated_at = CURRENT_TIMESTAMP
                       WHERE lower(email) = lower(?)""",
                    (preferred_email,),
                )
            if os.getenv("PROJECT_ENV") != "production":
                repaired_admins = db.execute(
                    "SELECT COUNT(*) AS total FROM workspace_members WHERE role = 'admin' AND status = 'active'"
                ).fetchone()["total"]
                if repaired_admins == 0:
                    db.execute(
                        """UPDATE workspace_members
                           SET role = 'admin', status = 'active', updated_at = CURRENT_TIMESTAMP
                           WHERE id = (SELECT id FROM workspace_members ORDER BY created_at ASC LIMIT 1)"""
                    )
        db.execute(
            """INSERT OR IGNORE INTO project_memberships
              (member_id, project_id, status)
            SELECT id, ?, CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END
            FROM workspace_members""",
            (PROJECT_ID,),
        )
        db.execute("PRAGMA optimize")


def ensure_member(user: dict[str, str]) -> str:
    with connection() as db:
        existing = db.execute(
            "SELECT id, role, status FROM workspace_members WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if existing:
            if existing["status"] == "disabled":
                raise PermissionError("member_disabled")
            db.execute(
                """
                UPDATE workspace_members
                SET email = ?, display_name = ?,
                    status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (user["email"], user["displayName"], user["id"]),
            )
            return str(existing["role"])
        invited = db.execute(
            "SELECT id, role, status FROM workspace_members WHERE lower(email) = lower(?)",
            (user["email"],),
        ).fetchone()
        if invited:
            if invited["status"] == "disabled":
                raise PermissionError("member_disabled")
            db.execute(
                """
                UPDATE workspace_members
                SET id = ?, email = ?, display_name = ?, status = 'active',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (user["id"], user["email"], user["displayName"], invited["id"]),
            )
            db.execute(
                """INSERT OR REPLACE INTO project_memberships
                  (member_id, project_id, status)
                SELECT ?, project_id, 'active' FROM project_memberships
                WHERE member_id = ?""",
                (user["id"], invited["id"]),
            )
            db.execute(
                "DELETE FROM project_memberships WHERE member_id = ?",
                (invited["id"],),
            )
            db.execute(
                """INSERT OR REPLACE INTO project_member_permissions
                  (member_id, project_id, permission, version_id, created_at)
                SELECT ?, project_id, permission, version_id, created_at
                FROM project_member_permissions
                WHERE member_id = ?""",
                (user["id"], invited["id"]),
            )
            db.execute(
                "DELETE FROM project_member_permissions WHERE member_id = ?",
                (invited["id"],),
            )
            return str(invited["role"])
        member_count = db.execute(
            "SELECT COUNT(*) AS total FROM workspace_members"
        ).fetchone()["total"]
        if member_count == 0 and os.getenv("PROJECT_ENV") == "production":
            bootstrap_email = os.getenv(
                "PROJECT_BOOTSTRAP_ADMIN_EMAIL", ""
            ).strip()
            if (
                not bootstrap_email
                or bootstrap_email.lower() != user["email"].lower()
            ):
                raise PermissionError("bootstrap_admin_required")
        invite_only = os.getenv("PROJECT_MEMBERSHIP_MODE") == "invite_only" or (
            os.getenv("PROJECT_ENV") == "production"
            and os.getenv("PROJECT_MEMBERSHIP_MODE") != "open"
        )
        if member_count > 0 and invite_only:
            raise PermissionError("membership_required")
        role = "admin" if member_count == 0 else "viewer"
        db.execute(
            """
            INSERT INTO workspace_members (id, email, display_name, role)
            VALUES (?, ?, ?, ?)
            """,
            (user["id"], user["email"], user["displayName"], role),
        )
        db.execute(
            """INSERT OR IGNORE INTO project_memberships
              (member_id, project_id, status)
              VALUES (?, ?, 'active')""",
            (user["id"], PROJECT_ID),
        )
        return role


def get_workspace_member(member_id: str) -> dict[str, Any] | None:
    with connection() as db:
        row = db.execute(
            """SELECT id, email, display_name, role, status
               FROM workspace_members WHERE id = ?""",
            (member_id,),
        ).fetchone()
        return dict(row) if row else None


def upsert_workspace_member(
    member: dict[str, str], project_id: str = PROJECT_ID
) -> dict[str, str]:
    valid_roles = {"admin", "project_manager", "member", "viewer"}
    valid_statuses = {"active", "invited", "disabled"}
    if member.get("role") not in valid_roles or member.get("status") not in valid_statuses:
        raise ValueError("invalid_member")
    email = member.get("email", "").strip().lower()
    display_name = member.get("displayName", "").strip()
    if not email or "@" not in email or not display_name:
        raise ValueError("invalid_member")
    with connection() as db:
        existing = db.execute(
            """SELECT id, role, status FROM workspace_members
               WHERE id = ? OR lower(email) = lower(?) LIMIT 1""",
            (member.get("id", ""), email),
        ).fetchone()
        member_id = str(existing["id"]) if existing else member.get("id") or f"invite-{uuid4()}"
        if (
            existing
            and existing["role"] == "admin"
            and existing["status"] == "active"
            and (member["role"] != "admin" or member["status"] != "active")
        ):
            admin_count = db.execute(
                "SELECT COUNT(*) AS total FROM workspace_members WHERE role = 'admin' AND status = 'active'"
            ).fetchone()["total"]
            if admin_count <= 1:
                raise ValueError("last_admin_required")
        if existing:
            db.execute(
                """UPDATE workspace_members
                   SET email = ?, display_name = ?, role = ?, status = ?,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (email, display_name, member["role"], member["status"], member_id),
            )
        else:
            db.execute(
                """INSERT INTO workspace_members
                   (id, email, display_name, role, status)
                   VALUES (?, ?, ?, ?, ?)""",
                (member_id, email, display_name, member["role"], member["status"]),
            )
        db.execute(
            """INSERT INTO project_memberships (member_id, project_id, status)
               VALUES (?, ?, ?)
               ON CONFLICT(member_id, project_id) DO UPDATE SET
                 status = excluded.status""",
            (
                member_id,
                project_id,
                "disabled" if member["status"] == "disabled" else "active",
            ),
        )
        return {
            "id": member_id,
            "email": email,
            "displayName": display_name,
            "role": member["role"],
            "status": member["status"],
        }


def member_has_project_access(member_id: str, project_id: str) -> bool:
    with connection() as db:
        row = db.execute(
            """SELECT 1 FROM project_memberships pm
               JOIN projects p ON p.id = pm.project_id
               WHERE pm.member_id = ? AND pm.project_id = ?
                 AND pm.status = 'active' AND p.status = 'active'""",
            (member_id, project_id),
        ).fetchone()
        return row is not None


def list_projects(member_id: str, role: str) -> list[dict[str, Any]]:
    with connection() as db:
        membership_join = "" if role == "admin" else (
            "JOIN project_memberships mine ON mine.project_id = p.id "
            "AND mine.member_id = ? AND mine.status = 'active'"
        )
        parameters: tuple[Any, ...] = () if role == "admin" else (member_id,)
        return _rows(
            db,
            f"""SELECT p.id, p.name, p.code, p.description, p.owner_id,
                       p.status, p.created_at, p.updated_at,
                       COALESCE(owner.display_name, p.owner_id) AS owner_name,
                       COUNT(DISTINCT pm.member_id) AS member_count,
                       COUNT(DISTINCT CASE WHEN pr.entity_type = 'version_config'
                                          THEN pr.id END) AS version_count
                FROM projects p
                {membership_join}
                LEFT JOIN workspace_members owner ON owner.id = p.owner_id
                LEFT JOIN project_memberships pm
                  ON pm.project_id = p.id AND pm.status = 'active'
                LEFT JOIN project_records pr ON pr.project_id = p.id
                GROUP BY p.id
                ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,
                         p.updated_at DESC, p.created_at ASC""",
            parameters,
        )


def list_workspace_members() -> list[dict[str, Any]]:
    with connection() as db:
        return _rows(
            db,
            """SELECT id, email, display_name, role, status
               FROM workspace_members
               ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
                        created_at ASC""",
        )


def create_project(
    *,
    project: dict[str, Any],
    creator_id: str,
    member_ids: list[str],
) -> dict[str, Any]:
    project_id = str(project.get("id") or f"project-{uuid4().hex[:10]}")
    name = str(project.get("name", "")).strip()
    code = str(project.get("code", "")).strip().upper()
    description = str(project.get("description", "")).strip()
    version_id = str(project.get("initialVersion", "v1.0"))
    mode = str(project.get("deliveryMode", "agile"))
    release_date = str(project.get("releaseDate", "")).strip()
    if (
        not name
        or not code
        or version_id not in {"v0.9", "v1.0", "v1.1"}
        or mode not in {"agile", "waterfall"}
    ):
        raise ValueError("invalid_project")
    unique_member_ids = list(dict.fromkeys([creator_id, *member_ids]))
    with connection() as db:
        known_members = {
            row["id"]
            for row in db.execute(
                f"SELECT id FROM workspace_members WHERE id IN ({','.join('?' for _ in unique_member_ids)})",
                unique_member_ids,
            )
        }
        if creator_id not in known_members or any(
            member_id not in known_members for member_id in unique_member_ids
        ):
            raise ValueError("member_not_found")
        try:
            db.execute(
                """INSERT INTO projects
                  (id, name, code, description, owner_id, status)
                VALUES (?, ?, ?, ?, ?, 'active')""",
                (project_id, name, code, description, creator_id),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError("project_already_exists") from error
        db.executemany(
            """INSERT INTO project_memberships
              (member_id, project_id, status) VALUES (?, ?, 'active')""",
            [(member_id, project_id) for member_id in unique_member_ids],
        )
        config = {
            "version": version_id,
            "mode": mode,
            "label": "敏捷迭代" if mode == "agile" else "传统瀑布",
            "locked": False,
            "releaseDate": release_date,
        }
        db.execute(
            """INSERT INTO project_records
              (project_id, id, entity_type, title, owner_id, status, payload_json)
            VALUES (?, ?, 'version_config', ?, ?, 'draft', ?)""",
            (
                project_id,
                f"VERSION-CONFIG-{version_id}",
                f"{version_id} delivery mode",
                creator_id,
                json.dumps(config, ensure_ascii=False),
            ),
        )
        _insert_default_automation_rules(db, project_id, creator_id)
        return {
            "id": project_id,
            "name": name,
            "code": code,
            "description": description,
            "owner_id": creator_id,
            "status": "active",
            "initialVersion": version_id,
            "deliveryMode": mode,
            "releaseDate": release_date,
        }


def update_project_status(project_id: str, status: str) -> None:
    if status not in {"active", "archived"}:
        raise ValueError("invalid_project_status")
    with connection() as db:
        result = db.execute(
            """UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (status, project_id),
        )
        if result.rowcount == 0:
            raise ValueError("project_not_found")


def update_project_details(
    project_id: str, name: str, description: str
) -> dict[str, str]:
    normalized_name = name.strip()
    normalized_description = description.strip()
    if not normalized_name:
        raise ValueError("invalid_project")
    with connection() as db:
        result = db.execute(
            """UPDATE projects
               SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (normalized_name, normalized_description, project_id),
        )
        if result.rowcount == 0:
            raise ValueError("project_not_found")
    return {
        "id": project_id,
        "name": normalized_name,
        "description": normalized_description,
    }


VALID_CONNECTORS = {"feishu", "dingtalk", "sheet", "git", "jira"}


def upsert_connector_config(
    *,
    project_id: str,
    connector: str,
    mode: str,
    display_name: str,
    base_url: str,
    config: dict[str, Any],
    actor_id: str,
) -> None:
    if connector not in VALID_CONNECTORS or mode not in {"sandbox", "live"}:
        raise ValueError("invalid_connector")
    sensitive_markers = {"secret", "token", "password", "credential", "key"}
    safe_config = {
        key: value
        for key, value in config.items()
        if not any(marker in key.lower() for marker in sensitive_markers)
    }
    with connection() as db:
        db.execute(
            """INSERT INTO connector_configs
              (project_id, connector, mode, status, display_name, base_url,
               config_json, updated_by)
            VALUES (?, ?, ?, 'configured', ?, ?, ?, ?)
            ON CONFLICT(project_id, connector) DO UPDATE SET
              mode = excluded.mode,
              status = 'configured',
              display_name = excluded.display_name,
              base_url = excluded.base_url,
              config_json = excluded.config_json,
              last_error = NULL,
              updated_by = excluded.updated_by,
              updated_at = CURRENT_TIMESTAMP""",
            (
                project_id,
                connector,
                mode,
                display_name.strip(),
                base_url.strip(),
                json.dumps(safe_config, ensure_ascii=False),
                actor_id,
            ),
        )


def get_connector_config(
    project_id: str, connector: str
) -> dict[str, Any] | None:
    with connection() as db:
        row = db.execute(
            """SELECT project_id, connector, mode, status, display_name,
                      base_url, config_json, last_tested_at, last_synced_at,
                      last_error, updated_by, updated_at
               FROM connector_configs
               WHERE project_id = ? AND connector = ?""",
            (project_id, connector),
        ).fetchone()
        return dict(row) if row else None


def set_connector_status(
    *,
    project_id: str,
    connector: str,
    status: str,
    error: str | None = None,
    synced: bool = False,
) -> None:
    if status not in {"configured", "connected", "error"}:
        raise ValueError("invalid_connector_status")
    with connection() as db:
        result = db.execute(
            """UPDATE connector_configs
               SET status = ?, last_error = ?,
                   last_tested_at = CURRENT_TIMESTAMP,
                   last_synced_at = CASE WHEN ? THEN CURRENT_TIMESTAMP
                                         ELSE last_synced_at END,
                   updated_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND connector = ?""",
            (status, error, int(synced), project_id, connector),
        )
        if result.rowcount == 0:
            raise ValueError("connector_not_configured")


def append_sync_event(
    *,
    project_id: str,
    connector: str,
    direction: str,
    entity_type: str,
    status: str,
    detail: str,
    entity_id: str | None = None,
) -> None:
    with connection() as db:
        db.execute(
            """INSERT INTO sync_events
              (project_id, connector, direction, entity_type, entity_id,
               status, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                project_id,
                connector,
                direction,
                entity_type,
                entity_id,
                status,
                detail,
            ),
        )


def replace_connector_evidence(
    *,
    project_id: str,
    connector: str,
    evidence: list[dict[str, Any]],
) -> int:
    if connector not in VALID_CONNECTORS:
        raise ValueError("invalid_connector")
    rows: list[tuple[Any, ...]] = []
    for item in evidence:
        evidence_type = str(item.get("evidenceType", ""))
        if evidence_type not in {"commit", "pull_request"}:
            raise ValueError("invalid_external_evidence")
        task_ids = item.get("taskIds")
        linked_task_ids = (
            [str(task_id) for task_id in task_ids if str(task_id).strip()]
            if isinstance(task_ids, list) and task_ids
            else [None]
        )
        for task_id in linked_task_ids:
            rows.append(
                (
                    project_id,
                    connector,
                    str(item.get("externalId", "")),
                    task_id,
                    evidence_type,
                    str(item.get("title", "")),
                    str(item.get("url", "")),
                    str(item.get("state", "")),
                    str(item.get("author", "")),
                    str(item.get("occurredAt", "")),
                    json.dumps(item.get("payload", {}), ensure_ascii=False),
                )
            )
    with connection() as db:
        db.execute(
            "DELETE FROM external_work_evidence WHERE project_id = ? AND connector = ?",
            (project_id, connector),
        )
        if rows:
            db.executemany(
                """INSERT INTO external_work_evidence
                  (project_id, connector, external_id, task_id, evidence_type,
                   title, url, state, author, occurred_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
    return len(rows)


def link_external_work_evidence(
    *,
    project_id: str,
    connector: str,
    external_id: str,
    task_id: str,
) -> None:
    if (
        connector not in VALID_CONNECTORS
        or not external_id.strip()
        or not task_id.strip()
    ):
        raise ValueError("invalid_external_evidence_link")
    with connection() as db:
        task_exists = db.execute(
            """SELECT 1 FROM project_records
               WHERE project_id = ? AND entity_type = 'task' AND id = ?""",
            (project_id, task_id),
        ).fetchone()
        if not task_exists:
            raise ValueError("task_not_found")
        source = db.execute(
            """SELECT 1 FROM external_work_evidence
               WHERE project_id = ? AND connector = ? AND external_id = ?
               LIMIT 1""",
            (project_id, connector, external_id),
        ).fetchone()
        if not source:
            raise ValueError("external_evidence_not_found")
        db.execute(
            """DELETE FROM external_work_evidence
               WHERE project_id = ? AND connector = ? AND external_id = ?
                 AND task_id = ?""",
            (project_id, connector, external_id, task_id),
        )
        updated = db.execute(
            """UPDATE external_work_evidence
               SET task_id = ?, synced_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND connector = ? AND external_id = ?
                 AND task_id IS NULL""",
            (task_id, project_id, connector, external_id),
        ).rowcount
        if not updated:
            raise ValueError("external_evidence_already_linked")


def replace_connector_quality_issues(
    *,
    project_id: str,
    connector: str,
    issues: list[dict[str, Any]],
) -> int:
    if connector != "jira":
        raise ValueError("invalid_quality_connector")
    with connection() as db:
        existing_links = {
            str(row["external_id"]): str(row["task_id"])
            for row in db.execute(
                """SELECT external_id, task_id FROM external_quality_issues
                   WHERE project_id = ? AND connector = ? AND task_id IS NOT NULL""",
                (project_id, connector),
            ).fetchall()
        }
        rows: list[tuple[Any, ...]] = []
        for item in issues:
            severity = str(item.get("severity", "P3"))
            status_category = str(item.get("statusCategory", "todo"))
            if severity not in {"P0", "P1", "P2", "P3"} or status_category not in {
                "todo",
                "in_progress",
                "done",
            }:
                raise ValueError("invalid_quality_issue")
            external_id = str(item.get("externalId", "")).strip()
            issue_key = str(item.get("issueKey", "")).strip()
            if not external_id or not issue_key:
                raise ValueError("invalid_quality_issue")
            task_id = str(item.get("taskId") or "").strip() or existing_links.get(
                external_id
            )
            rows.append(
                (
                    project_id,
                    connector,
                    external_id,
                    issue_key,
                    str(item.get("summary", "")),
                    severity,
                    str(item.get("status", "")),
                    status_category,
                    str(item.get("assignee", "")),
                    str(item.get("versionId") or "") or None,
                    task_id or None,
                    max(0, int(item.get("reopenCount", 0))),
                    str(item.get("dueDate") or "") or None,
                    str(item.get("createdAt", "")),
                    str(item.get("updatedAt", "")),
                    str(item.get("resolvedAt") or "") or None,
                    str(item.get("url", "")),
                    json.dumps(item.get("payload", {}), ensure_ascii=False),
                )
            )
        if rows:
            db.executemany(
                """INSERT INTO external_quality_issues
                  (project_id, connector, external_id, issue_key, summary,
                   severity, status, status_category, assignee, version_id,
                   task_id, reopen_count, due_date, created_at_external,
                   updated_at_external, resolved_at, url, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, connector, external_id) DO UPDATE SET
                  issue_key = excluded.issue_key,
                  summary = excluded.summary,
                  severity = excluded.severity,
                  status = excluded.status,
                  status_category = excluded.status_category,
                  assignee = excluded.assignee,
                  version_id = excluded.version_id,
                  task_id = COALESCE(external_quality_issues.task_id, excluded.task_id),
                  reopen_count = excluded.reopen_count,
                  due_date = excluded.due_date,
                  created_at_external = excluded.created_at_external,
                  updated_at_external = excluded.updated_at_external,
                  resolved_at = excluded.resolved_at,
                  url = excluded.url,
                  payload_json = excluded.payload_json,
                  synced_at = CURRENT_TIMESTAMP""",
                rows,
            )
    return len(rows)


def link_external_quality_issue(
    *, project_id: str, external_id: str, task_id: str
) -> None:
    if not external_id.strip() or not task_id.strip():
        raise ValueError("invalid_quality_issue_link")
    with connection() as db:
        task_exists = db.execute(
            """SELECT 1 FROM project_records
               WHERE project_id = ? AND entity_type = 'task' AND id = ?""",
            (project_id, task_id),
        ).fetchone()
        if not task_exists:
            raise ValueError("task_not_found")
        updated = db.execute(
            """UPDATE external_quality_issues
               SET task_id = ?, synced_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND connector = 'jira' AND external_id = ?""",
            (task_id, project_id, external_id),
        ).rowcount
        if not updated:
            raise ValueError("quality_issue_not_found")


def upsert_automation_rule(
    *,
    project_id: str,
    rule_key: str,
    enabled: bool,
    channel: str,
    config: dict[str, Any],
    actor_id: str,
) -> None:
    valid_rule_keys = {rule[0] for rule in DEFAULT_AUTOMATION_RULES}
    if rule_key not in valid_rule_keys or channel not in {
        "workspace",
        "feishu",
        "dingtalk",
        "email",
    }:
        raise ValueError("invalid_automation_rule")
    with connection() as db:
        db.execute(
            """INSERT INTO automation_rules
              (project_id, rule_key, enabled, channel, rule_json, updated_by)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, rule_key) DO UPDATE SET
              enabled = excluded.enabled,
              channel = excluded.channel,
              rule_json = excluded.rule_json,
              updated_by = excluded.updated_by,
              updated_at = CURRENT_TIMESTAMP""",
            (
                project_id,
                rule_key,
                int(enabled),
                channel,
                json.dumps(config, ensure_ascii=False),
                actor_id,
            ),
        )


def _inspection_candidates(
    tasks: list[list[str]],
    resources: list[dict[str, Any]],
    risks: list[dict[str, Any]],
    blockers: list[dict[str, Any]],
    config: dict[str, Any],
    external_evidence: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    year = now.year
    load_threshold = int(config.get("loadThreshold", 105))
    stale_hours = int(config.get("riskStaleHours", 24))
    findings: list[dict[str, Any]] = []

    evidence_by_task: dict[str, list[dict[str, Any]]] = {}
    unlinked_evidence = 0
    for item in external_evidence:
        task_id = item.get("task_id")
        if task_id:
            evidence_by_task.setdefault(str(task_id), []).append(item)
        else:
            unlinked_evidence += 1

    blocker_by_task = {
        str(item.get("taskId")): item
        for item in blockers
        if item.get("status") not in {"已解决", "已关闭"}
    }
    for task in tasks:
        if len(task) < 13 or task[5] == "已完成":
            continue
        task_id = str(task[0])
        progress = int(str(task[9]).rstrip("%") or 0)
        blocker = blocker_by_task.get(task_id)
        month, day = (int(part) for part in str(task[8]).split("/")[:2])
        overdue = datetime(year, month, day, tzinfo=now.tzinfo).date() < now.date()
        if task[5] != "有阻塞" and not overdue:
            pass
        else:
            reason = str(blocker.get("reason")) if blocker else "计划日期已过但任务尚未完成"
            findings.append(
                {
                    "fingerprint": f"task_progress:{task_id}",
                    "findingType": "progress",
                    "severity": "high" if task[6] == "高" or task[5] == "有阻塞" else "medium",
                    "title": f"{task[3]} · {task[1]}进度异常",
                    "detail": f"当前进度 {progress}%，计划完成日 {task[8]}；{reason}。",
                    "owner": str(task[4]),
                    "recommendation": str(blocker.get("resolutionPlan")) if blocker else "复核剩余工作量并调整计划或补充阻塞原因。",
                    "sourceRefs": [{"type": "task", "id": task_id}],
                }
            )

        task_evidence = evidence_by_task.get(task_id, [])
        merged_pull = next(
            (
                item
                for item in task_evidence
                if item.get("evidence_type") == "pull_request"
                and item.get("state") == "merged"
            ),
            None,
        )
        if merged_pull and progress < 100:
            findings.append(
                {
                    "fingerprint": f"git_progress_mismatch:{task_id}",
                    "findingType": "progress",
                    "severity": "medium",
                    "title": f"{task_id} 已有合并 PR，但 WBS 仍为 {progress}%",
                    "detail": f"GitHub 证据“{merged_pull.get('title')}”已合并，任务状态仍为“{task[5]}”。",
                    "owner": str(task[4]),
                    "recommendation": "核验验收条件；已完成则更新任务进度，未完成则补充剩余工作或新建子任务。",
                    "sourceRefs": [
                        {"type": "task", "id": task_id},
                        {"type": "github", "id": str(merged_pull.get("external_id", ""))},
                    ],
                }
            )

    if external_evidence and unlinked_evidence:
        findings.append(
            {
                "fingerprint": "git_unlinked_evidence",
                "findingType": "progress",
                "severity": "low" if unlinked_evidence < 10 else "medium",
                "title": f"{unlinked_evidence} 条 Git 记录未关联 WBS 任务",
                "detail": "提交信息或 PR 标题/描述中未识别到有效任务编号，无法作为计划进度证据。",
                "owner": "项目经理",
                "recommendation": "要求提交和 PR 引用 WBS 编号，或人工补充任务关联后重新巡检。",
                "sourceRefs": [{"type": "connector", "id": "git"}],
            }
        )

    for resource in resources:
        load = int(resource.get("load", 0))
        if load <= load_threshold or resource.get("memberStatus") == "已离职":
            continue
        name = str(resource.get("name", "未分配"))
        findings.append(
            {
                "fingerprint": f"resource_load:{name}",
                "findingType": "resource",
                "severity": "high" if load >= load_threshold + 10 else "medium",
                "title": f"{name}负载达到 {load}%",
                "detail": f"超过巡检阈值 {load_threshold}%，可用产能 {resource.get('available', 0)}h。",
                "owner": name,
                "recommendation": "将非关键任务转交同技能成员，优先保障关键路径并复核版本并行占用。",
                "sourceRefs": [{"type": "resource", "id": name}],
            }
        )

    for risk in risks:
        if risk.get("level") != "高" or risk.get("status") in {"已关闭", "已解决"}:
            continue
        risk_id = str(risk.get("id"))
        findings.append(
            {
                "fingerprint": f"risk_open:{risk_id}",
                "findingType": "risk",
                "severity": "high" if risk.get("status") == "待决策" else "medium",
                "title": f"{risk_id} · {risk.get('title')}",
                "detail": f"高风险仍处于“{risk.get('status')}”；触发条件：{risk.get('trigger')}。",
                "owner": str(risk.get("owner", "项目经理")),
                "recommendation": str(risk.get("plan", "制定处置方案并明确责任人和截止时间。")),
                "sourceRefs": [{"type": "risk", "id": risk_id}],
            }
        )

    for blocker in blockers:
        updated_at = blocker.get("updatedAt")
        if not updated_at or blocker.get("status") in {"已解决", "已关闭"}:
            continue
        try:
            updated = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=now.tzinfo)
            age_hours = int((now - updated.astimezone(now.tzinfo)).total_seconds() / 3600)
        except ValueError:
            continue
        if age_hours <= stale_hours:
            continue
        blocker_id = str(blocker.get("id"))
        findings.append(
            {
                "fingerprint": f"blocker_stale:{blocker_id}",
                "findingType": "risk",
                "severity": "medium",
                "title": f"{blocker_id} 超过 {stale_hours} 小时未更新",
                "detail": f"阻塞项已 {age_hours} 小时无状态更新，当前为“{blocker.get('status')}”。",
                "owner": str(blocker.get("owner", "项目经理")),
                "recommendation": "联系责任人更新处置证据；无法按期解除时立即升级并调整关键路径。",
                "sourceRefs": [
                    {"type": "blocker", "id": blocker_id},
                    {"type": "task", "id": str(blocker.get("taskId", ""))},
                ],
            }
        )
    return findings


def run_project_inspection(
    *,
    project_id: str,
    trigger_type: str,
    actor_id: str,
) -> dict[str, Any]:
    if trigger_type not in {"manual", "scheduled"}:
        raise ValueError("invalid_inspection_trigger")
    run_id = str(uuid4())
    with connection() as db:
        rule = db.execute(
            """SELECT enabled, rule_json FROM automation_rules
               WHERE project_id = ? AND rule_key = 'ai_inspection'""",
            (project_id,),
        ).fetchone()
        git_rule = db.execute(
            """SELECT enabled, rule_json FROM automation_rules
               WHERE project_id = ? AND rule_key = 'git_verification'""",
            (project_id,),
        ).fetchone()
        quality_rule = db.execute(
            """SELECT enabled, rule_json FROM automation_rules
               WHERE project_id = ? AND rule_key = 'quality_warning'""",
            (project_id,),
        ).fetchone()
        if trigger_type == "scheduled" and (not rule or not rule["enabled"]):
            db.execute(
                """INSERT INTO inspection_runs
                  (id, project_id, trigger_type, status, summary_json, created_by, completed_at)
                VALUES (?, ?, ?, 'skipped', ?, ?, CURRENT_TIMESTAMP)""",
                (run_id, project_id, trigger_type, '{"reason":"rule_disabled"}', actor_id),
            )
            return {"id": run_id, "status": "skipped", "total": 0, "findings": []}

        db.execute(
            """INSERT INTO inspection_runs
              (id, project_id, trigger_type, status, created_by)
            VALUES (?, ?, ?, 'running', ?)""",
            (run_id, project_id, trigger_type, actor_id),
        )
        rows = db.execute(
            """SELECT entity_type, payload_json FROM project_records
               WHERE project_id = ?
                 AND entity_type IN ('task', 'resource', 'risk', 'blocker')""",
            (project_id,),
        ).fetchall()
        records: dict[str, list[Any]] = {"task": [], "resource": [], "risk": [], "blocker": []}
        for row in rows:
            records[row["entity_type"]].append(json.loads(row["payload_json"]))
        external_evidence = (
            _rows(
                db,
                """SELECT external_id, task_id, evidence_type, title, url, state,
                          author, occurred_at
                   FROM external_work_evidence
                   WHERE project_id = ? AND connector = 'git'""",
                (project_id,),
            )
            if git_rule and git_rule["enabled"]
            else []
        )
        git_connector = (
            db.execute(
                """SELECT status, last_synced_at, last_error
                   FROM connector_configs
                   WHERE project_id = ? AND connector = 'git'
                     AND mode = 'live'""",
                (project_id,),
            ).fetchone()
            if git_rule and git_rule["enabled"]
            else None
        )
        quality_issues = (
            _rows(
                db,
                """SELECT external_id, issue_key, summary, severity, status,
                          status_category, assignee, version_id, task_id,
                          reopen_count, due_date, updated_at_external, url
                   FROM external_quality_issues
                   WHERE project_id = ? AND connector = 'jira'""",
                (project_id,),
            )
            if quality_rule and quality_rule["enabled"]
            else []
        )
        jira_connector = (
            db.execute(
                """SELECT status, last_synced_at, last_error
                   FROM connector_configs
                   WHERE project_id = ? AND connector = 'jira'
                     AND mode = 'live'""",
                (project_id,),
            ).fetchone()
            if quality_rule and quality_rule["enabled"]
            else None
        )
        config = json.loads(rule["rule_json"]) if rule else {}
        findings = _inspection_candidates(
            records["task"],
            records["resource"],
            records["risk"],
            records["blocker"],
            config,
            external_evidence,
        )
        git_config = json.loads(git_rule["rule_json"] or "{}") if git_rule else {}
        if git_connector:
            connector_status = str(git_connector["status"])
            if connector_status == "error":
                findings.append(
                    {
                        "fingerprint": "connector_sync_failure:git",
                        "findingType": "risk",
                        "severity": "high",
                        "title": "Git 自动同步失败",
                        "detail": str(
                            git_connector["last_error"]
                            or "Git 连接器返回未知错误。"
                        ),
                        "owner": "系统管理员",
                        "recommendation": "检查网络、仓库地址及访问凭证；恢复连接后系统会在下个周期自动重试并复核告警。",
                        "sourceRefs": [{"type": "connector", "id": "git"}],
                    }
                )
            elif connector_status == "connected":
                last_synced_at = git_connector["last_synced_at"]
                stale_hours = max(1, int(git_config.get("staleHours", 24)))
                sync_age_hours: int | None = None
                if last_synced_at:
                    try:
                        synced_at = datetime.fromisoformat(
                            str(last_synced_at)
                            .replace(" ", "T")
                            .replace("Z", "+00:00")
                        )
                        if synced_at.tzinfo is None:
                            synced_at = synced_at.replace(tzinfo=timezone.utc)
                        sync_age_hours = int(
                            (
                                datetime.now(timezone.utc)
                                - synced_at.astimezone(timezone.utc)
                            ).total_seconds()
                            / 3600
                        )
                    except ValueError:
                        sync_age_hours = stale_hours + 1
                if sync_age_hours is None or sync_age_hours > stale_hours:
                    findings.append(
                        {
                            "fingerprint": "connector_sync_stale:git",
                            "findingType": "risk",
                            "severity": "medium",
                            "title": "Git 进度证据未及时同步",
                            "detail": (
                                "Git 连接已建立，但尚未完成首次同步。"
                                if sync_age_hours is None
                                else f"最近一次 Git 同步距今约 {sync_age_hours} 小时，超过 {stale_hours} 小时阈值。"
                            ),
                            "owner": "系统管理员",
                            "recommendation": "立即检查自动同步状态；必要时手动同步，并确认后台巡检服务持续运行。",
                            "sourceRefs": [
                                {"type": "connector", "id": "git"}
                            ],
                        }
                    )
        quality_config = (
            json.loads(quality_rule["rule_json"] or "{}") if quality_rule else {}
        )
        if jira_connector and str(jira_connector["status"]) == "error":
            findings.append(
                {
                    "fingerprint": "connector_sync_failure:jira",
                    "findingType": "risk",
                    "severity": "high",
                    "title": "Jira 自动同步失败",
                    "detail": str(
                        jira_connector["last_error"] or "Jira 连接器返回未知错误。"
                    ),
                    "owner": "系统管理员",
                    "recommendation": "检查 Jira 地址、项目代码、服务账号和 API Token；恢复后系统会自动重试并复核质量告警。",
                    "sourceRefs": [{"type": "connector", "id": "jira"}],
                }
            )
        issues_by_version: dict[str, list[dict[str, Any]]] = {}
        for issue in quality_issues:
            version_id = str(issue.get("version_id") or "未分配版本")
            issues_by_version.setdefault(version_id, []).append(issue)
        for version_id, version_issues in issues_by_version.items():
            active_issues = [
                issue
                for issue in version_issues
                if issue.get("status_category") != "done"
            ]
            p0_count = sum(
                1 for issue in active_issues if issue.get("severity") == "P0"
            )
            p1_count = sum(
                1 for issue in active_issues if issue.get("severity") == "P1"
            )
            reopened_count = sum(
                1 for issue in version_issues if int(issue.get("reopen_count") or 0) > 0
            )
            reopen_rate = round(reopened_count * 100 / max(1, len(version_issues)))
            p0_limit = max(0, int(quality_config.get("p0Limit", 0)))
            p1_limit = max(0, int(quality_config.get("p1Limit", 3)))
            reopen_limit = max(0, int(quality_config.get("reopenRate", 10)))
            if (
                p0_count <= p0_limit
                and p1_count <= p1_limit
                and reopen_rate <= reopen_limit
            ):
                continue
            findings.append(
                {
                    "fingerprint": f"jira_quality_gate:{version_id}",
                    "findingType": "risk",
                    "severity": "high" if p0_count > p0_limit else "medium",
                    "title": f"{version_id} 暂不满足发布质量门禁",
                    "detail": (
                        f"未解决 P0 {p0_count} 个、P1 {p1_count} 个；"
                        f"缺陷重开率 {reopen_rate}%，当前未解决共 {len(active_issues)} 个。"
                    ),
                    "owner": "测试负责人",
                    "recommendation": "冻结非必要变更，优先清零 P0/P1；对重开缺陷补充根因分析和回归用例，达标后重新执行发布评估。",
                    "sourceRefs": [
                        {"type": "connector", "id": "jira"},
                        {"type": "version", "id": version_id},
                    ],
                }
            )
        fingerprints = {item["fingerprint"] for item in findings}
        for finding in findings:
            db.execute(
                """INSERT INTO inspection_findings
                  (project_id, fingerprint, finding_type, severity, title, detail,
                   owner, recommendation, source_refs_json, status, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
                ON CONFLICT(project_id, fingerprint) DO UPDATE SET
                  finding_type = excluded.finding_type,
                  severity = excluded.severity,
                  title = excluded.title,
                  detail = excluded.detail,
                  owner = excluded.owner,
                  recommendation = excluded.recommendation,
                  source_refs_json = excluded.source_refs_json,
                  status = CASE WHEN inspection_findings.status = 'resolved'
                                THEN 'open' ELSE inspection_findings.status END,
                  resolution_note = CASE WHEN inspection_findings.status = 'resolved'
                                         THEN NULL ELSE inspection_findings.resolution_note END,
                  resolved_at = CASE WHEN inspection_findings.status = 'resolved'
                                     THEN NULL ELSE inspection_findings.resolved_at END,
                  last_detected_at = CURRENT_TIMESTAMP,
                  updated_by = excluded.updated_by""",
                (
                    project_id,
                    finding["fingerprint"],
                    finding["findingType"],
                    finding["severity"],
                    finding["title"],
                    finding["detail"],
                    finding["owner"],
                    finding["recommendation"],
                    json.dumps(finding["sourceRefs"], ensure_ascii=False),
                    actor_id,
                ),
            )
            db.execute(
                """INSERT INTO inspection_run_findings (run_id, project_id, fingerprint)
                   VALUES (?, ?, ?)""",
                (run_id, project_id, finding["fingerprint"]),
            )
        open_rows = db.execute(
            """SELECT fingerprint FROM inspection_findings
               WHERE project_id = ? AND status != 'resolved'""",
            (project_id,),
        ).fetchall()
        for row in open_rows:
            if row["fingerprint"] not in fingerprints:
                db.execute(
                    """UPDATE inspection_findings
                       SET status = 'resolved', resolution_note = '巡检复核后条件已消失',
                           resolved_at = CURRENT_TIMESTAMP, updated_by = ?
                       WHERE project_id = ? AND fingerprint = ?""",
                    (actor_id, project_id, row["fingerprint"]),
                )
        counts = {"progress": 0, "resource": 0, "risk": 0}
        for finding in findings:
            counts[finding["findingType"]] += 1
        summary = {**counts, "total": len(findings)}
        db.execute(
            """UPDATE inspection_runs
               SET status = 'completed', summary_json = ?, completed_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (json.dumps(summary, ensure_ascii=False), run_id),
        )
        return {"id": run_id, "status": "completed", **summary, "findings": findings}


def update_inspection_finding(
    *, project_id: str, fingerprint: str, status: str, note: str, actor_id: str
) -> None:
    if status not in {"open", "acknowledged", "resolved"}:
        raise ValueError("invalid_finding_status")
    if status == "resolved" and not note.strip():
        raise ValueError("resolution_note_required")
    with connection() as db:
        result = db.execute(
            """UPDATE inspection_findings
               SET status = ?, resolution_note = ?,
                   resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END,
                   updated_by = ?
               WHERE project_id = ? AND fingerprint = ?""",
            (status, note.strip() or None, status, actor_id, project_id, fingerprint),
        )
        if result.rowcount == 0:
            raise ValueError("finding_not_found")


def projects_due_for_inspection() -> list[str]:
    now = datetime.now(timezone.utc)
    due: list[str] = []
    with connection() as db:
        rows = db.execute(
            """SELECT ar.project_id, ar.rule_json,
                      (SELECT MAX(started_at) FROM inspection_runs ir
                       WHERE ir.project_id = ar.project_id AND ir.trigger_type = 'scheduled') AS last_run
               FROM automation_rules ar
               JOIN projects p ON p.id = ar.project_id AND p.status = 'active'
               WHERE ar.rule_key = 'ai_inspection' AND ar.enabled = 1"""
        ).fetchall()
        for row in rows:
            interval = max(1, int(json.loads(row["rule_json"]).get("intervalMinutes", 30)))
            if not row["last_run"]:
                due.append(row["project_id"])
                continue
            last_run = datetime.fromisoformat(str(row["last_run"]).replace(" ", "T")).replace(
                tzinfo=timezone.utc
            )
            if (now - last_run).total_seconds() >= interval * 60:
                due.append(row["project_id"])
    return due


def projects_due_for_git_sync(
    now: datetime | None = None,
) -> list[str]:
    """Return active projects whose live Git connector should sync now."""
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    due: list[str] = []
    with connection() as db:
        rows = db.execute(
            """SELECT cc.project_id, cc.status, cc.last_tested_at,
                      cc.last_synced_at, ar.rule_json
               FROM connector_configs cc
               JOIN automation_rules ar
                 ON ar.project_id = cc.project_id
                AND ar.rule_key = 'git_verification'
                AND ar.enabled = 1
               JOIN projects p
                 ON p.id = cc.project_id AND p.status = 'active'
               WHERE cc.connector = 'git'
                 AND cc.mode = 'live'
                 AND cc.status IN ('connected', 'error')"""
        ).fetchall()
        for row in rows:
            try:
                config = json.loads(row["rule_json"] or "{}")
            except json.JSONDecodeError:
                config = {}
            interval = max(
                5,
                min(24 * 60, int(config.get("syncIntervalMinutes", 30))),
            )
            anchor_value = (
                row["last_tested_at"]
                if row["status"] == "error"
                else row["last_synced_at"]
            )
            if not anchor_value:
                due.append(str(row["project_id"]))
                continue
            try:
                anchor = datetime.fromisoformat(
                    str(anchor_value).replace(" ", "T").replace("Z", "+00:00")
                )
            except ValueError:
                due.append(str(row["project_id"]))
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=timezone.utc)
            if (current_time - anchor.astimezone(timezone.utc)).total_seconds() >= interval * 60:
                due.append(str(row["project_id"]))
    return due


def projects_due_for_jira_sync(
    now: datetime | None = None,
) -> list[str]:
    """Return active projects whose live Jira connector should sync now."""
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    due: list[str] = []
    with connection() as db:
        rows = db.execute(
            """SELECT cc.project_id, cc.status, cc.last_tested_at,
                      cc.last_synced_at, ar.rule_json
               FROM connector_configs cc
               JOIN automation_rules ar
                 ON ar.project_id = cc.project_id
                AND ar.rule_key = 'quality_warning'
                AND ar.enabled = 1
               JOIN projects p
                 ON p.id = cc.project_id AND p.status = 'active'
               WHERE cc.connector = 'jira'
                 AND cc.mode = 'live'
                 AND cc.status IN ('connected', 'error')"""
        ).fetchall()
        for row in rows:
            try:
                config = json.loads(row["rule_json"] or "{}")
            except json.JSONDecodeError:
                config = {}
            interval = max(
                5,
                min(24 * 60, int(config.get("syncIntervalMinutes", 30))),
            )
            anchor_value = (
                row["last_tested_at"]
                if row["status"] == "error"
                else row["last_synced_at"]
            )
            if not anchor_value:
                due.append(str(row["project_id"]))
                continue
            try:
                anchor = datetime.fromisoformat(
                    str(anchor_value).replace(" ", "T").replace("Z", "+00:00")
                )
            except ValueError:
                due.append(str(row["project_id"]))
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=timezone.utc)
            elapsed = (current_time - anchor.astimezone(timezone.utc)).total_seconds()
            if elapsed >= interval * 60:
                due.append(str(row["project_id"]))
    return due


def analyze_requirement_document(
    *,
    project_id: str,
    file_name: str,
    content_base64: str,
    version_id: str,
    delivery_mode: str,
    actor_id: str,
) -> dict[str, Any]:
    if version_id not in {"v0.9", "v1.0", "v1.1"}:
        raise ValueError("invalid_version")
    content, suffix = decode_document(file_name, content_base64)
    document_id = str(uuid4())
    draft_id = str(uuid4())
    normalized_name = safe_file_name(file_name)
    upload_root = DEFAULT_DATABASE_PATH.parent / "uploads"
    configured_path = os.getenv("PROJECT_UPLOAD_PATH")
    if configured_path:
        upload_root = Path(configured_path).expanduser().resolve()
    safe_project = re.sub(r"[^\w.-]", "_", project_id)
    target_dir = upload_root / safe_project
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{document_id}-{normalized_name}"
    target.write_bytes(content)
    text = extract_text(normalized_name, suffix, content)
    with connection() as db:
        resources = [
            json.loads(row["payload_json"])
            for row in db.execute(
                """SELECT payload_json FROM project_records
                   WHERE project_id = ? AND entity_type = 'resource'""",
                (project_id,),
            ).fetchall()
        ]
        local_draft = build_requirement_draft(
            file_name=normalized_name,
            text=text,
            version_id=version_id,
            delivery_mode=delivery_mode,
            resources=resources,
        )
        ai_result = analyze_requirement_with_openai(
            file_name=normalized_name,
            suffix=suffix,
            content=content,
            extracted_text=text,
            version_id=version_id,
            delivery_mode=delivery_mode,
            resources=resources,
            actor_id=actor_id,
        )
        draft = local_draft
        if ai_result.analysis is not None and ai_result.model:
            try:
                draft = merge_ai_requirement_draft(
                    fallback=local_draft,
                    analysis=ai_result.analysis,
                    resources=resources,
                    model=ai_result.model,
                    response_id=ai_result.response_id,
                    elapsed_ms=ai_result.elapsed_ms,
                )
            except (TypeError, ValueError, KeyError):
                ai_result = ai_result.__class__(
                    analysis=None,
                    provider="local",
                    model=ai_result.model,
                    response_id=ai_result.response_id,
                    elapsed_ms=ai_result.elapsed_ms,
                    fallback_reason="openai_validation_failed",
                )
        if ai_result.analysis is None:
            draft = {
                **draft,
                "assumptions": [],
                "confidence": 0.55 if text else 0.2,
                "aiProvider": "local",
                "aiModel": ai_result.model,
                "aiResponseId": ai_result.response_id,
                "aiElapsedMs": ai_result.elapsed_ms,
                "aiFallbackReason": ai_result.fallback_reason,
            }
        summary = {
            "featureCount": draft["featureCount"],
            "clarificationCount": len(draft["clarifications"]),
            "riskCount": len(draft["risks"]),
            "parserMode": draft["parserMode"],
            "textExtracted": bool(text),
            "aiProvider": draft["aiProvider"],
            "aiModel": draft.get("aiModel"),
            "confidence": draft.get("confidence"),
            "aiFallbackReason": draft.get("aiFallbackReason"),
        }
        db.execute(
            """INSERT INTO requirement_documents
              (id, project_id, file_name, file_type, file_size, storage_path,
               sha256, extracted_text, status, parse_summary_json, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?)""",
            (
                document_id,
                project_id,
                normalized_name,
                suffix,
                len(content),
                str(target),
                document_sha256(content),
                text,
                json.dumps(summary, ensure_ascii=False),
                actor_id,
            ),
        )
        db.execute(
            """INSERT INTO requirement_drafts
              (id, project_id, document_id, version_id, delivery_mode,
               status, draft_json, created_by)
            VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)""",
            (
                draft_id,
                project_id,
                document_id,
                version_id,
                delivery_mode,
                json.dumps(draft, ensure_ascii=False),
                actor_id,
            ),
        )
    return {
        "document": {
            "id": document_id,
            "fileName": normalized_name,
            "fileType": suffix,
            "fileSize": len(content),
            "summary": summary,
        },
        "draft": {"id": draft_id, **draft, "textExtracted": bool(text)},
    }


def update_requirement_draft(
    *, project_id: str, draft_id: str, tasks: list[dict[str, Any]], actor_id: str
) -> dict[str, Any]:
    with connection() as db:
        row = db.execute(
            """SELECT draft_json, status FROM requirement_drafts
               WHERE project_id = ? AND id = ?""",
            (project_id, draft_id),
        ).fetchone()
        if not row or row["status"] != "draft":
            raise ValueError("requirement_draft_not_editable")
        draft = json.loads(row["draft_json"])
        if not tasks or any(
            not {"sequence", "name", "type", "stage", "owner", "estimateHours", "dependencySequences", "acceptance", "start", "end"}.issubset(task)
            for task in tasks
        ):
            raise ValueError("invalid_requirement_tasks")
        draft["tasks"] = tasks
        db.execute(
            """UPDATE requirement_drafts SET draft_json = ?, created_by = ?
               WHERE project_id = ? AND id = ?""",
            (json.dumps(draft, ensure_ascii=False), actor_id, project_id, draft_id),
        )
        return {"id": draft_id, **draft}


def apply_requirement_draft(
    *, project_id: str, draft_id: str, actor_id: str
) -> dict[str, Any]:
    with connection() as db:
        row = db.execute(
            """SELECT rd.document_id, rd.version_id, rd.delivery_mode, rd.status,
                      rd.draft_json, d.file_name, p.name AS project_name
               FROM requirement_drafts rd
               JOIN requirement_documents d ON d.id = rd.document_id
               JOIN projects p ON p.id = rd.project_id
               WHERE rd.project_id = ? AND rd.id = ?""",
            (project_id, draft_id),
        ).fetchone()
        if not row:
            raise ValueError("requirement_draft_not_found")
        if row["status"] != "draft":
            raise ValueError("requirement_draft_already_applied")
        draft = json.loads(row["draft_json"])
        draft_tasks = draft.get("tasks", [])
        if not draft_tasks:
            raise ValueError("empty_requirement_draft")
        batch_key = uuid4().hex[:6].upper()
        parent_id = f"AI-{batch_key}-WBS"
        id_by_sequence = {
            int(item["sequence"]): f"AI-{batch_key}-{int(item['sequence'])}"
            for item in draft_tasks
        }
        tasks: list[list[str]] = []
        hierarchy: list[dict[str, Any]] = []
        for item in draft_tasks:
            task_id = id_by_sequence[int(item["sequence"])]
            dependencies = [
                id_by_sequence[int(sequence)]
                for sequence in item.get("dependencySequences", [])
                if int(sequence) in id_by_sequence
            ]
            task = [
                task_id,
                str(item["name"]),
                row["project_name"],
                row["version_id"],
                str(item["owner"]),
                "未开始",
                "高" if item["type"] in {"联合联调", "系统测试", "测试验收"} else "中",
                str(item["start"]),
                str(item["end"]),
                "0%",
                f"{int(item['estimateHours'])}h",
                "、".join(dependencies) if dependencies else "—",
                "中" if item["type"] in {"联合联调", "系统测试", "测试验收"} else "低",
            ]
            tasks.append(task)
            hierarchy.append(
                {
                    "taskId": task_id,
                    "parentTaskId": parent_id,
                    "rootTaskId": parent_id,
                    "level": 1,
                    "sortOrder": int(item["sequence"]),
                    "workType": str(item["type"]),
                    "acceptanceCriteria": str(item["acceptance"]),
                }
            )
        parent_task = [
            parent_id,
            f"{draft['topic']} · 交付包",
            row["project_name"],
            row["version_id"],
            str(draft_tasks[0]["owner"]),
            "未开始",
            "高",
            min(str(item["start"]) for item in draft_tasks),
            max(str(item["end"]) for item in draft_tasks),
            "0%",
            "0h",
            "—",
            "中",
        ]
        all_tasks = [parent_task, *tasks]
        all_hierarchy = [
            {
                "taskId": parent_id,
                "parentTaskId": None,
                "rootTaskId": parent_id,
                "level": 0,
                "sortOrder": 0,
                "workType": "用户故事" if row["delivery_mode"] == "agile" else "瀑布交付包",
                "acceptanceCriteria": "全部子任务完成并通过版本质量门禁",
            },
            *hierarchy,
        ]
        for task in all_tasks:
            db.execute(
                """INSERT INTO project_records
                  (project_id, id, entity_type, title, owner_id, status, payload_json)
                VALUES (?, ?, 'task', ?, ?, ?, ?)""",
                (project_id, task[0], task[1], task[4], task[5], json.dumps(task, ensure_ascii=False)),
            )
        for item in all_hierarchy:
            db.execute(
                """INSERT INTO task_hierarchy
                  (project_id, task_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    project_id,
                    item["taskId"],
                    item["parentTaskId"],
                    item["rootTaskId"],
                    item["level"],
                    item["sortOrder"],
                    item["workType"],
                    item["acceptanceCriteria"],
                ),
            )
            db.execute(
                """INSERT INTO requirement_task_links
                  (project_id, document_id, draft_id, task_id)
                VALUES (?, ?, ?, ?)""",
                (project_id, row["document_id"], draft_id, item["taskId"]),
            )
        config = {
            "version": row["version_id"],
            "mode": row["delivery_mode"],
            "label": "敏捷迭代" if row["delivery_mode"] == "agile" else "传统瀑布",
            "locked": True,
        }
        db.execute(
            """INSERT INTO project_records
              (project_id, id, entity_type, title, status, payload_json)
            VALUES (?, ?, 'version_config', ?, 'locked', ?)
            ON CONFLICT(project_id, id) DO UPDATE SET payload_json = excluded.payload_json,
              status = excluded.status, updated_at = CURRENT_TIMESTAMP""",
            (
                project_id,
                f"VERSION-CONFIG-{row['version_id']}",
                f"{row['version_id']} delivery mode",
                json.dumps(config, ensure_ascii=False),
            ),
        )
        db.execute(
            """UPDATE requirement_drafts SET status = 'applied', applied_at = CURRENT_TIMESTAMP
               WHERE project_id = ? AND id = ?""",
            (project_id, draft_id),
        )
        return {
            "documentId": row["document_id"],
            "draftId": draft_id,
            "tasks": all_tasks,
            "hierarchy": all_hierarchy,
            "versionConfig": config,
        }


def replace_member_permissions(
    *,
    member_id: str,
    project_id: str,
    permissions: list[dict[str, str]],
) -> None:
    valid_permissions = {"manage_version", "approve_change", "approve_release"}
    if any(
        item.get("permission") not in valid_permissions
        or item.get("versionId", "*") not in {"*", "v0.9", "v1.0", "v1.1"}
        for item in permissions
    ):
        raise ValueError("invalid_permission")
    with connection() as db:
        member = db.execute(
            "SELECT 1 FROM workspace_members WHERE id = ?",
            (member_id,),
        ).fetchone()
        if not member:
            raise ValueError("member_not_found")
        db.execute(
            """DELETE FROM project_member_permissions
               WHERE member_id = ? AND project_id = ?""",
            (member_id, project_id),
        )
        db.executemany(
            """INSERT INTO project_member_permissions
              (member_id, project_id, permission, version_id)
            VALUES (?, ?, ?, ?)""",
            [
                (
                    member_id,
                    project_id,
                    item["permission"],
                    item.get("versionId", "*"),
                )
                for item in permissions
            ],
        )


def member_has_permission(
    *,
    member_id: str,
    project_id: str,
    permission: str,
    version_id: str | None = None,
) -> bool:
    with connection() as db:
        row = db.execute(
            """SELECT 1 FROM project_member_permissions
               WHERE member_id = ? AND project_id = ? AND permission = ?
                 AND version_id IN ('*', ?)
               LIMIT 1""",
            (member_id, project_id, permission, version_id or "*"),
        ).fetchone()
        return row is not None


def _rows(
    db: sqlite3.Connection,
    query: str,
    parameters: tuple[Any, ...] = (),
) -> list[dict[str, Any]]:
    return [dict(row) for row in db.execute(query, parameters).fetchall()]


def workspace_snapshot(project_id: str = PROJECT_ID) -> dict[str, Any]:
    with connection() as db:
        project_records = _rows(
            db,
            """SELECT id, entity_type, payload_json
               FROM project_records
               WHERE project_id = ?
                 AND entity_type IN ('task', 'resource', 'risk', 'meeting', 'report', 'change', 'blocker', 'version_config')
               ORDER BY created_at ASC, id ASC""",
            (project_id,),
        )
        parsed_records: dict[str, list[Any]] = {
            "task": [],
            "resource": [],
            "risk": [],
            "meeting": [],
            "report": [],
            "change": [],
            "blocker": [],
            "version_config": [],
        }
        for record in project_records:
            parsed_records[record["entity_type"]].append(
                json.loads(record["payload_json"])
            )
        return {
            "members": _rows(
                db,
                """SELECT wm.id, wm.email, wm.display_name, wm.role, wm.status
                   FROM workspace_members wm
                   JOIN project_memberships pm ON pm.member_id = wm.id
                   WHERE pm.project_id = ?
                   ORDER BY wm.created_at ASC LIMIT 50""",
                (project_id,),
            ),
            "recordCounts": _rows(
                db,
                """SELECT entity_type, status, COUNT(*) AS total
                   FROM project_records WHERE project_id = ?
                   GROUP BY entity_type, status""",
                (project_id,),
            ),
            "syncEvents": _rows(
                db,
                """SELECT connector, direction, entity_type, status, detail, occurred_at
                   FROM sync_events WHERE project_id = ?
                   ORDER BY occurred_at DESC LIMIT 20""",
                (project_id,),
            ),
            "externalWorkEvidence": _rows(
                db,
                """SELECT connector, external_id, task_id, evidence_type, title,
                          url, state, author, occurred_at, payload_json, synced_at
                   FROM external_work_evidence WHERE project_id = ?
                   ORDER BY occurred_at DESC, external_id DESC LIMIT 200""",
                (project_id,),
            ),
            "externalQualityIssues": _rows(
                db,
                """SELECT connector, external_id, issue_key, summary, severity,
                          status, status_category, assignee, version_id, task_id,
                          reopen_count, due_date, created_at_external,
                          updated_at_external, resolved_at, url, payload_json,
                          synced_at
                   FROM external_quality_issues WHERE project_id = ?
                   ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1
                            WHEN 'P2' THEN 2 ELSE 3 END,
                            updated_at_external DESC LIMIT 300""",
                (project_id,),
            ),
            "connectorConfigs": _rows(
                db,
                """SELECT project_id, connector, mode, status, display_name,
                          base_url, config_json, last_tested_at, last_synced_at,
                          last_error, updated_by, updated_at
                   FROM connector_configs WHERE project_id = ?
                   ORDER BY connector""",
                (project_id,),
            ),
            "automationRules": _rows(
                db,
                """SELECT project_id, rule_key, enabled, channel, rule_json,
                          updated_by, updated_at
                   FROM automation_rules WHERE project_id = ?
                   ORDER BY rule_key""",
                (project_id,),
            ),
            "inspectionRuns": _rows(
                db,
                """SELECT id, project_id, trigger_type, status, summary_json,
                          created_by, started_at, completed_at
                   FROM inspection_runs WHERE project_id = ?
                   ORDER BY started_at DESC LIMIT 20""",
                (project_id,),
            ),
            "inspectionFindings": _rows(
                db,
                """SELECT project_id, fingerprint, finding_type, severity, title,
                          detail, owner, recommendation, source_refs_json, status,
                          resolution_note, first_detected_at, last_detected_at,
                          resolved_at, updated_by
                   FROM inspection_findings WHERE project_id = ?
                   ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                            last_detected_at DESC""",
                (project_id,),
            ),
            "requirementDocuments": _rows(
                db,
                """SELECT id, project_id, file_name, file_type, file_size, sha256,
                          status, parse_summary_json, uploaded_by, created_at, updated_at
                   FROM requirement_documents WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT 30""",
                (project_id,),
            ),
            "requirementDrafts": _rows(
                db,
                """SELECT id, project_id, document_id, version_id, delivery_mode,
                          status, draft_json, created_by, created_at, applied_at
                   FROM requirement_drafts WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT 30""",
                (project_id,),
            ),
            "requirementTaskLinks": _rows(
                db,
                """SELECT project_id, document_id, draft_id, task_id, created_at
                   FROM requirement_task_links WHERE project_id = ?
                   ORDER BY created_at DESC""",
                (project_id,),
            ),
            "auditLogs": _rows(
                db,
                """SELECT actor_id, actor_type, action, entity_type, entity_id, detail, created_at
                   FROM audit_logs WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT 30""",
                (project_id,),
            ),
            "planBaselines": _rows(
                db,
                """SELECT id, project_id, version_id, baseline_key, label, snapshot_json,
                          created_by, created_at
                   FROM plan_baselines WHERE project_id = ?
                   ORDER BY created_at DESC, version_id ASC LIMIT 50""",
                (project_id,),
            ),
            "milestoneEvents": _rows(
                db,
                """SELECT id, project_id, version_id, milestone_key, event_type, occurred_at,
                          source_system, detail, created_at
                   FROM milestone_events WHERE project_id = ?
                   ORDER BY occurred_at DESC, id DESC LIMIT 100""",
                (project_id,),
            ),
            "changeTaskLinks": _rows(
                db,
                """SELECT id, project_id, change_id, task_id, relation_type, note,
                          created_at
                   FROM change_task_links WHERE project_id = ?
                   ORDER BY created_at ASC, id ASC""",
                (project_id,),
            ),
            "taskHierarchy": _rows(
                db,
                """SELECT task_id, project_id, parent_task_id, root_task_id, level,
                          sort_order, work_type, acceptance_criteria, created_at, updated_at
                   FROM task_hierarchy WHERE project_id = ?
                   ORDER BY root_task_id ASC, level ASC, sort_order ASC""",
                (project_id,),
            ),
            "permissions": _rows(
                db,
                """SELECT member_id, project_id, permission, version_id, created_at
                   FROM project_member_permissions WHERE project_id = ?
                   ORDER BY member_id, permission, version_id""",
                (project_id,),
            ),
            "tasks": parsed_records["task"],
            "resources": parsed_records["resource"],
            "risks": parsed_records["risk"],
            "meetings": parsed_records["meeting"],
            "reports": parsed_records["report"],
            "changes": parsed_records["change"],
            "blockers": parsed_records["blocker"],
            "versionConfigs": parsed_records["version_config"],
        }


def upsert_project_record(
    *,
    record_id: str,
    entity_type: str,
    title: str,
    owner_id: str | None,
    status: str,
    payload: Any,
    project_id: str = PROJECT_ID,
) -> None:
    with connection() as db:
        db.execute(
            """
            INSERT INTO project_records
              (project_id, id, entity_type, title, owner_id, status, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
              entity_type = excluded.entity_type,
              title = excluded.title,
              owner_id = excluded.owner_id,
              status = excluded.status,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                project_id,
                record_id,
                entity_type,
                title,
                owner_id,
                status,
                json.dumps(payload, ensure_ascii=False),
            ),
        )


def upsert_tasks_with_hierarchy(
    *,
    tasks: list[list[str]],
    hierarchy: list[dict[str, Any]],
    actor_id: str,
    actor_type: str,
    action: str,
    version_config: dict[str, Any] | None = None,
    project_id: str = PROJECT_ID,
) -> None:
    """Persist tasks, hierarchy, delivery mode, and audit trail atomically."""
    with connection() as db:
        for task in tasks:
            db.execute(
                """
                INSERT INTO project_records
                  (project_id, id, entity_type, title, owner_id, status, payload_json)
                VALUES (?, ?, 'task', ?, ?, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                  title = excluded.title,
                  owner_id = excluded.owner_id,
                  status = excluded.status,
                  payload_json = excluded.payload_json,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    project_id,
                    task[0],
                    task[1],
                    task[4],
                    task[5],
                    json.dumps(task, ensure_ascii=False),
                ),
            )
        for record in hierarchy:
            db.execute(
                """
                INSERT INTO task_hierarchy
                  (task_id, project_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, task_id) DO UPDATE SET
                  parent_task_id = excluded.parent_task_id,
                  root_task_id = excluded.root_task_id,
                  level = excluded.level,
                  sort_order = excluded.sort_order,
                  work_type = excluded.work_type,
                  acceptance_criteria = excluded.acceptance_criteria,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    record["taskId"],
                    project_id,
                    record.get("parentTaskId"),
                    record["rootTaskId"],
                    record["level"],
                    record.get("sortOrder", 0),
                    record["workType"],
                    record.get("acceptanceCriteria"),
                ),
            )
        for task in tasks:
            db.execute(
                """
                INSERT INTO audit_logs
                  (project_id, actor_id, actor_type, action, entity_type, entity_id, detail)
                VALUES (?, ?, ?, ?, 'task', ?, ?)
                """,
                (
                    project_id,
                    actor_id,
                    actor_type,
                    action,
                    task[0],
                    f"{task[3]} {task[1]}",
                ),
            )
        if version_config:
            version_id = str(version_config["version"])
            db.execute(
                """
                INSERT INTO project_records
                  (project_id, id, entity_type, title, owner_id, status, payload_json)
                VALUES (?, ?, 'version_config', ?, NULL, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                  title = excluded.title,
                  status = excluded.status,
                  payload_json = excluded.payload_json,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    project_id,
                    f"VERSION-CONFIG-{version_id}",
                    f"{version_id} delivery mode",
                    "locked" if version_config["locked"] else "draft",
                    json.dumps(version_config, ensure_ascii=False),
                ),
            )
            db.execute(
                """
                INSERT INTO audit_logs
                  (project_id, actor_id, actor_type, action, entity_type, entity_id, detail)
                VALUES (?, ?, ?, ?, 'version_config', ?, ?)
                """,
                (
                    project_id,
                    actor_id,
                    actor_type,
                    action,
                    version_id,
                    f"mode={version_config['mode']} locked={version_config['locked']}",
                ),
            )


def upsert_task_hierarchy(
    records: list[dict[str, Any]], project_id: str = PROJECT_ID
) -> None:
    with connection() as db:
        for record in records:
            db.execute(
                """
                INSERT INTO task_hierarchy
                  (task_id, project_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, task_id) DO UPDATE SET
                  parent_task_id = excluded.parent_task_id,
                  root_task_id = excluded.root_task_id,
                  level = excluded.level,
                  sort_order = excluded.sort_order,
                  work_type = excluded.work_type,
                  acceptance_criteria = excluded.acceptance_criteria,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    record["taskId"],
                    project_id,
                    record.get("parentTaskId"),
                    record["rootTaskId"],
                    record["level"],
                    record.get("sortOrder", 0),
                    record["workType"],
                    record.get("acceptanceCriteria"),
                ),
            )


def apply_change_wbs(
    *,
    change: dict[str, Any],
    tasks: list[list[str]],
    links: list[dict[str, str]],
    hierarchy: list[dict[str, Any]],
    actor_id: str,
    project_id: str = PROJECT_ID,
) -> None:
    """Atomically persist an approved change, its WBS tasks, and trace links."""
    with connection() as db:
        for task in tasks:
            db.execute(
                """
                INSERT INTO project_records
                  (project_id, id, entity_type, title, owner_id, status, payload_json)
                VALUES (?, ?, 'task', ?, ?, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                  title = excluded.title,
                  owner_id = excluded.owner_id,
                  status = excluded.status,
                  payload_json = excluded.payload_json,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    project_id,
                    task[0],
                    task[1],
                    task[4],
                    task[5],
                    json.dumps(task, ensure_ascii=False),
                ),
            )
        for link in links:
            db.execute(
                """
                INSERT INTO change_task_links
                  (id, project_id, change_id, task_id, relation_type, note)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, change_id, task_id, relation_type)
                DO UPDATE SET note = excluded.note
                """,
                (
                    link["id"],
                    project_id,
                    change["id"],
                    link["taskId"],
                    link["relationType"],
                    link.get("note"),
                ),
            )
        for record in hierarchy:
            db.execute(
                """
                INSERT INTO task_hierarchy
                  (task_id, project_id, parent_task_id, root_task_id, level,
                   sort_order, work_type, acceptance_criteria)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, task_id) DO UPDATE SET
                  parent_task_id = excluded.parent_task_id,
                  root_task_id = excluded.root_task_id,
                  level = excluded.level,
                  sort_order = excluded.sort_order,
                  work_type = excluded.work_type,
                  acceptance_criteria = excluded.acceptance_criteria,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    record["taskId"],
                    project_id,
                    record.get("parentTaskId"),
                    record["rootTaskId"],
                    record["level"],
                    record.get("sortOrder", 0),
                    record["workType"],
                    record.get("acceptanceCriteria"),
                ),
            )
        db.execute(
            """
            INSERT INTO project_records
              (project_id, id, entity_type, title, owner_id, status, payload_json)
            VALUES (?, ?, 'change', ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
              title = excluded.title,
              owner_id = excluded.owner_id,
              status = excluded.status,
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                project_id,
                change["id"],
                change["title"],
                change["owner"],
                change["status"],
                json.dumps(change, ensure_ascii=False),
            ),
        )
        db.execute(
            """
            INSERT INTO audit_logs
              (project_id, actor_id, actor_type, action, entity_type, entity_id, detail)
            VALUES (?, ?, 'user', 'apply_change_wbs', 'change', ?, ?)
            """,
            (
                project_id,
                actor_id,
                change["id"],
                f"created_or_updated={len(tasks)} linked={len(links)} hierarchy={len(hierarchy)} target={change['targetVersion']}",
            ),
        )


def save_plan_baseline(
    *,
    row_id: str,
    version_id: str,
    baseline_key: str,
    label: str,
    snapshot: Any,
    created_by: str,
    project_id: str = PROJECT_ID,
) -> None:
    with connection() as db:
        db.execute(
            """
            INSERT INTO plan_baselines
              (id, project_id, version_id, baseline_key, label, snapshot_json, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row_id,
                project_id,
                version_id,
                baseline_key,
                label,
                json.dumps(snapshot, ensure_ascii=False),
                created_by,
            ),
        )


def record_milestone_actual(
    *,
    version_id: str,
    milestone_key: str,
    occurred_at: str,
    detail: str | None,
    project_id: str = PROJECT_ID,
) -> None:
    with connection() as db:
        db.execute(
            """
            INSERT INTO milestone_events
              (project_id, version_id, milestone_key, event_type, occurred_at, source_system, detail)
            VALUES (?, ?, ?, 'actual', ?, 'workbench', ?)
            """,
            (project_id, version_id, milestone_key, occurred_at, detail),
        )


def append_audit_log(
    *,
    project_id: str = PROJECT_ID,
    actor_id: str,
    actor_type: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    detail: str | None = None,
) -> None:
    with connection() as db:
        db.execute(
            """
            INSERT INTO audit_logs
              (project_id, actor_id, actor_type, action, entity_type, entity_id, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                actor_id,
                actor_type,
                action,
                entity_type,
                entity_id,
                detail,
            ),
        )
