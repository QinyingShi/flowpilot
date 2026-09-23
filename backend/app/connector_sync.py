from __future__ import annotations

import json
import os
from typing import Any

from .database import (
    append_sync_event,
    get_connector_config,
    replace_connector_evidence,
    run_project_inspection,
    set_connector_status,
    workspace_snapshot,
)
from .github_connector import GitHubConnectorError, sync_github_evidence


def sync_project_github_evidence(
    *,
    project_id: str,
    trigger_type: str,
    actor_id: str,
    allow_error_retry: bool = False,
) -> dict[str, Any]:
    """Synchronize GitHub evidence and immediately refresh inspection findings."""
    config = get_connector_config(project_id, "git")
    if not config:
        raise ValueError("connector_not_configured")
    allowed_statuses = {"connected", "error"} if allow_error_retry else {"connected"}
    if config["status"] not in allowed_statuses:
        raise ValueError("connector_not_connected")
    if config["mode"] != "live":
        raise ValueError("live_sync_not_available")

    options = json.loads(config["config_json"] or "{}")
    snapshot = workspace_snapshot(project_id)
    task_ids = [
        str(task[0])
        for task in snapshot.get("tasks", [])
        if isinstance(task, list) and task
    ]
    try:
        result = sync_github_evidence(
            base_url=str(config["base_url"]),
            scope=str(options.get("scope", "")),
            token=os.getenv("GIT_ACCESS_TOKEN", ""),
            task_ids=task_ids,
            lookback_days=int(options.get("lookbackDays", 30)),
        )
        stored = replace_connector_evidence(
            project_id=project_id,
            connector="git",
            evidence=result["evidence"],
        )
    except (GitHubConnectorError, ValueError) as error:
        detail = str(error)
        set_connector_status(
            project_id=project_id,
            connector="git",
            status="error",
            error=detail,
        )
        append_sync_event(
            project_id=project_id,
            connector="git",
            direction="inbound",
            entity_type="progress_evidence",
            status="failed",
            detail=f"自动同步失败：{detail}" if trigger_type == "scheduled" else detail,
        )
        run_project_inspection(
            project_id=project_id,
            trigger_type=trigger_type,
            actor_id=actor_id,
        )
        raise

    detail = (
        f"GitHub {'自动' if trigger_type == 'scheduled' else ''}同步完成："
        f"{result['commits']} 个提交、{result['pullRequests']} 个 PR；"
        f"{result['linked']} 条记录命中任务编号，"
        f"{result['unlinked']} 条待人工关联"
    )
    set_connector_status(
        project_id=project_id,
        connector="git",
        status="connected",
        synced=True,
    )
    append_sync_event(
        project_id=project_id,
        connector="git",
        direction="inbound",
        entity_type="progress_evidence",
        status="success",
        detail=detail,
    )
    inspection = run_project_inspection(
        project_id=project_id,
        trigger_type=trigger_type,
        actor_id=actor_id,
    )
    return {
        "connector": "git",
        "count": stored,
        "detail": detail,
        "inspection": {
            "id": inspection["id"],
            "total": inspection["total"],
        },
        **{key: value for key, value in result.items() if key != "evidence"},
    }
