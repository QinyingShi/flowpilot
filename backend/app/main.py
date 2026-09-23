from __future__ import annotations

import asyncio
import hmac
import json
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import (
    PROJECT_ID,
    analyze_requirement_document,
    apply_change_wbs,
    apply_requirement_draft,
    append_sync_event,
    append_audit_log,
    create_project,
    database_health,
    ensure_member,
    get_connector_config,
    initialize_database,
    list_projects,
    list_workspace_members,
    link_external_work_evidence,
    member_has_permission,
    member_has_project_access,
    record_milestone_actual,
    save_plan_baseline,
    set_connector_status,
    upsert_project_record,
    upsert_workspace_member,
    replace_member_permissions,
    run_project_inspection,
    update_project_status,
    update_project_details,
    update_inspection_finding,
    update_requirement_draft,
    upsert_automation_rule,
    upsert_connector_config,
    upsert_tasks_with_hierarchy,
    workspace_snapshot,
)
from .connector_sync import sync_project_github_evidence
from .github_connector import (
    GitHubConnectorError,
    test_github_connection,
)
from .inspection_worker import run_due_projects
from .task_model import valid_task_hierarchy, valid_task_record
from .runtime import validate_runtime_configuration


VALID_VERSIONS = {"v0.9", "v1.0", "v1.1"}


def embedded_inspection_enabled() -> bool:
    return os.getenv("PROJECT_EMBED_INSPECTION_WORKER", "false").lower() == "true"


def inspection_poll_seconds() -> int:
    raw_value = os.getenv("PROJECT_INSPECTION_POLL_SECONDS", "30")
    try:
        return max(5, int(raw_value))
    except ValueError as error:
        raise RuntimeError(
            "PROJECT_INSPECTION_POLL_SECONDS must be an integer"
        ) from error


async def run_embedded_inspection_worker(stop_event: asyncio.Event) -> None:
    poll_seconds = inspection_poll_seconds()
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(run_due_projects)
        except Exception as error:  # keep the API available when one scan fails
            print(f"inspection worker failed: {error}", flush=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=poll_seconds)
        except TimeoutError:
            continue


def valid_milestone_datetime(value: str) -> bool:
    try:
        if len(value) == 10:
            date.fromisoformat(value)
        else:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


class WorkspaceAction(BaseModel):
    action: str
    entityType: str | None = None
    entityId: str | None = None
    detail: str | None = None
    versionId: str | None = None
    baselineKey: str | None = None
    label: str | None = None
    snapshot: Any | None = None
    milestoneKey: str | None = None
    occurredAt: str | None = None
    task: list[str] | None = None
    tasks: list[list[str]] | None = None
    risk: dict[str, Any] | None = None
    meeting: dict[str, Any] | None = None
    report: dict[str, Any] | None = None
    change: dict[str, Any] | None = None
    resource: dict[str, Any] | None = None
    resources: list[dict[str, Any]] | None = None
    blocker: dict[str, Any] | None = None
    versionConfig: dict[str, Any] | None = None
    links: list[dict[str, str]] | None = None
    hierarchy: list[dict[str, Any]] | None = None
    member: dict[str, str] | None = None
    memberId: str | None = None
    permissions: list[dict[str, str]] | None = None
    projectId: str | None = None
    project: dict[str, Any] | None = None
    memberIds: list[str] | None = None
    projectStatus: str | None = None
    connector: str | None = None
    connectorConfig: dict[str, Any] | None = None
    taskId: str | None = None
    automationRule: dict[str, Any] | None = None
    finding: dict[str, Any] | None = None
    requirementDocument: dict[str, Any] | None = None
    requirementDraft: dict[str, Any] | None = None


def current_user(
    user_id: str | None,
    email: str | None,
    display_name: str | None,
) -> dict[str, str]:
    if not user_id or not email:
        raise HTTPException(status_code=401, detail="authentication_required")
    return {
        "id": user_id,
        "email": email,
        "displayName": display_name or email,
    }


def verify_proxy_secret(provided_secret: str | None) -> None:
    expected_secret = os.getenv("PROJECT_API_PROXY_SECRET")
    if expected_secret and (
        not provided_secret
        or not hmac.compare_digest(provided_secret, expected_secret)
    ):
        raise HTTPException(status_code=401, detail="invalid_proxy_secret")
    if (
        not expected_secret
        and os.getenv("PROJECT_ENV", "development") == "production"
    ):
        raise HTTPException(status_code=503, detail="proxy_secret_not_configured")


def valid_meeting_minutes(meeting: dict[str, Any]) -> bool:
    minutes = meeting.get("minutes")
    required = {"mode", "notes", "transcript", "decisions", "actionItems"}
    if not (
        isinstance(minutes, dict)
        and required.issubset(minutes)
        and minutes.get("mode") in {"线上", "线下"}
        and all(
            isinstance(minutes.get(field), str)
            for field in required - {"mode"}
        )
    ):
        return False
    follow_ups = minutes.get("followUps", [])
    follow_up_fields = {
        "id",
        "title",
        "owner",
        "dueDate",
        "linkedType",
        "linkedId",
        "status",
        "evidence",
        "history",
    }
    return bool(
        isinstance(follow_ups, list)
        and all(
            isinstance(item, dict)
            and follow_up_fields.issubset(item)
            and item.get("status")
            in {"待执行", "执行中", "待验收", "已闭环"}
            and item.get("linkedType") in {"WBS任务", "风险", "需求变更"}
            and isinstance(item.get("history"), list)
            for item in follow_ups
        )
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_runtime_configuration()
    initialize_database()
    stop_event = asyncio.Event()
    worker_task: asyncio.Task[None] | None = None
    if embedded_inspection_enabled():
        worker_task = asyncio.create_task(run_embedded_inspection_worker(stop_event))
    try:
        yield
    finally:
        if worker_task is not None:
            stop_event.set()
            await worker_task


app = FastAPI(
    title="Project Command Center API",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "PROJECT_CORS_ORIGINS",
            "http://localhost:3001,http://127.0.0.1:3001",
        ).split(",")
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    try:
        return database_health()
    except (OSError, RuntimeError, sqlite3.Error) as error:
        raise HTTPException(status_code=503, detail="database_unavailable") from error


@app.get("/health/live")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def readiness() -> dict[str, str]:
    return health()


@app.get("/api/workspace")
def get_workspace(
    x_user_id: str | None = Header(default=None),
    x_user_email: str | None = Header(default=None),
    x_user_display_name: str | None = Header(default=None),
    x_project_api_secret: str | None = Header(default=None),
    x_project_id: str | None = Header(default=None),
) -> dict[str, Any]:
    verify_proxy_secret(x_project_api_secret)
    user = current_user(x_user_id, x_user_email, x_user_display_name)
    try:
        role = ensure_member(user)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    project_id = x_project_id if isinstance(x_project_id, str) else PROJECT_ID
    if role != "admin" and not member_has_project_access(user["id"], project_id):
        raise HTTPException(status_code=403, detail="project_access_required")
    return {
        "user": {**user, "role": role},
        "projectId": project_id,
        "projects": list_projects(user["id"], role),
        "workspaceMembers": list_workspace_members() if role == "admin" else [],
        "snapshot": workspace_snapshot(project_id),
    }


@app.post("/api/workspace")
def mutate_workspace(
    body: WorkspaceAction,
    x_user_id: str | None = Header(default=None),
    x_user_email: str | None = Header(default=None),
    x_user_display_name: str | None = Header(default=None),
    x_project_api_secret: str | None = Header(default=None),
    x_project_id: str | None = Header(default=None),
) -> dict[str, Any]:
    verify_proxy_secret(x_project_api_secret)
    user = current_user(x_user_id, x_user_email, x_user_display_name)
    try:
        role = ensure_member(user)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    project_id = body.projectId or (
        x_project_id if isinstance(x_project_id, str) else PROJECT_ID
    )
    if role != "admin" and not member_has_project_access(user["id"], project_id):
        raise HTTPException(status_code=403, detail="project_access_required")

    def require_project_permission(permission: str, version_id: str | None) -> None:
        if role == "admin":
            return
        if not member_has_permission(
            member_id=user["id"],
            project_id=project_id,
            permission=permission,
            version_id=version_id,
        ):
            raise HTTPException(
                status_code=403,
                detail=f"permission_required:{permission}:{version_id or '*'}",
            )

    def append_project_audit_log(**details: Any) -> None:
        append_audit_log(project_id=project_id, **details)

    if body.action == "create_project":
        if role != "admin":
            raise HTTPException(status_code=403, detail="admin_required")
        if not body.project:
            raise HTTPException(status_code=400, detail="invalid_project")
        try:
            saved_project = create_project(
                project=body.project,
                creator_id=user["id"],
                member_ids=body.memberIds or [],
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        append_audit_log(
            project_id=saved_project["id"],
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type="project",
            entity_id=saved_project["id"],
            detail=(
                f"{saved_project['name']} {saved_project['initialVersion']} "
                f"mode={saved_project['deliveryMode']}"
            ),
        )
        return {"ok": True, "project": saved_project}

    if body.action == "update_project_status":
        if role != "admin":
            raise HTTPException(status_code=403, detail="admin_required")
        if not body.projectId or not body.projectStatus:
            raise HTTPException(status_code=400, detail="invalid_project_status")
        if body.projectId == PROJECT_ID and body.projectStatus == "archived":
            raise HTTPException(status_code=400, detail="default_project_required")
        try:
            update_project_status(body.projectId, body.projectStatus)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        append_audit_log(
            project_id=body.projectId,
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type="project",
            entity_id=body.projectId,
            detail=f"status={body.projectStatus}",
        )
        return {"ok": True, "projectId": body.projectId}

    if body.action == "update_project_details":
        if role not in {"admin", "project_manager"}:
            raise HTTPException(status_code=403, detail="insufficient_role")
        if not body.projectId or not body.project:
            raise HTTPException(status_code=400, detail="invalid_project")
        try:
            saved_project = update_project_details(
                body.projectId,
                str(body.project.get("name", "")),
                str(body.project.get("description", "")),
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        append_audit_log(
            project_id=body.projectId,
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type="project",
            entity_id=body.projectId,
            detail=saved_project["name"],
        )
        return {"ok": True, "project": saved_project}

    if body.action == "upsert_workspace_member":
        if role != "admin":
            raise HTTPException(status_code=403, detail="admin_required")
        member = body.member
        if not member:
            raise HTTPException(status_code=400, detail="invalid_member")
        try:
            saved_member = upsert_workspace_member(member, project_id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        append_project_audit_log(
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type="workspace_member",
            entity_id=saved_member["id"],
            detail=(
                f"role={saved_member['role']} status={saved_member['status']} "
                f"email={saved_member['email']}"
            ),
        )
        return {"ok": True, "member": saved_member}

    if body.action == "replace_member_permissions":
        if role != "admin":
            raise HTTPException(status_code=403, detail="admin_required")
        if not body.memberId:
            raise HTTPException(status_code=400, detail="invalid_permission")
        try:
            replace_member_permissions(
                member_id=body.memberId,
                project_id=project_id,
                permissions=body.permissions or [],
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        append_project_audit_log(
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type="project_permission",
            entity_id=body.memberId,
            detail=f"project={project_id} permissions={len(body.permissions or [])}",
        )
        return {"ok": True, "memberId": body.memberId}

    privileged_permission: tuple[str, str | None] | None = None
    if body.action in {
        "save_plan_baseline",
        "upsert_version_config",
        "apply_change_wbs",
        "apply_requirement_draft",
    }:
        privileged_permission = (
            "manage_version",
            body.versionId
            or (body.versionConfig or {}).get("version")
            or (body.change or {}).get("targetVersion"),
        )
    if (
        body.action == "update_change"
        and body.change
        and body.change.get("currentStep") == 2
    ):
        privileged_permission = (
            "approve_change",
            body.change.get("targetVersion"),
        )
    if privileged_permission and role != "admin" and not member_has_permission(
        member_id=user["id"],
        project_id=project_id,
        permission=privileged_permission[0],
        version_id=privileged_permission[1],
    ):
        raise HTTPException(status_code=403, detail="project_permission_required")

    if role not in {"admin", "project_manager"}:
        member_actions = {
            "sync_task_progress",
            "upsert_task_blocker",
            "update_meeting_minutes",
            "complete_personal_work_item",
            "reopen_personal_work_item",
        }
        if role != "member" or body.action not in member_actions:
            raise HTTPException(status_code=403, detail="insufficient_role")
        if body.action == "sync_task_progress":
            task_records = body.tasks or ([body.task] if body.task else [])
            if any(
                user["displayName"]
                not in [name.strip() for name in task[4].split("、")]
                for task in task_records
                if len(task) > 4
            ):
                raise HTTPException(status_code=403, detail="task_owner_required")
        if body.action == "upsert_task_blocker" and (
            not body.blocker
            or body.blocker.get("owner") != user["displayName"]
        ):
            raise HTTPException(status_code=403, detail="blocker_owner_required")
        if body.action == "update_meeting_minutes" and (
            not body.meeting
            or user["displayName"]
            not in str(body.meeting.get("attendees", ""))
        ):
            raise HTTPException(status_code=403, detail="meeting_attendee_required")

    try:
        if body.action == "analyze_requirement_document":
            document = body.requirementDocument or {}
            required = {"fileName", "contentBase64", "versionId", "deliveryMode"}
            if not required.issubset(document):
                raise HTTPException(status_code=400, detail="invalid_requirement_document")
            try:
                result = analyze_requirement_document(
                    project_id=project_id,
                    file_name=str(document["fileName"]),
                    content_base64=str(document["contentBase64"]),
                    version_id=str(document["versionId"]),
                    delivery_mode=str(document["deliveryMode"]),
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="ai",
                action=body.action,
                entity_type="requirement_document",
                entity_id=result["document"]["id"],
                detail=(
                    f"{result['document']['fileName']} version={document['versionId']} "
                    f"tasks={len(result['draft']['tasks'])}"
                ),
            )
            return {"ok": True, **result}

        if body.action == "update_requirement_draft":
            draft = body.requirementDraft or {}
            if not draft.get("id") or not isinstance(draft.get("tasks"), list):
                raise HTTPException(status_code=400, detail="invalid_requirement_draft")
            try:
                saved = update_requirement_draft(
                    project_id=project_id,
                    draft_id=str(draft["id"]),
                    tasks=draft["tasks"],
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="requirement_draft",
                entity_id=str(draft["id"]),
                detail=f"tasks={len(draft['tasks'])}",
            )
            return {"ok": True, "draft": saved}

        if body.action == "apply_requirement_draft":
            draft = body.requirementDraft or {}
            if not draft.get("id") or not body.versionId:
                raise HTTPException(status_code=400, detail="invalid_requirement_draft")
            require_project_permission("manage_version", body.versionId)
            try:
                result = apply_requirement_draft(
                    project_id=project_id,
                    draft_id=str(draft["id"]),
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="ai",
                action=body.action,
                entity_type="requirement_draft",
                entity_id=str(draft["id"]),
                detail=(
                    f"document={result['documentId']} version={body.versionId} "
                    f"tasks={len(result['tasks'])}"
                ),
            )
            return {"ok": True, **result}

        if body.action == "save_connector_config":
            config = body.connectorConfig or {}
            connector = body.connector or ""
            try:
                upsert_connector_config(
                    project_id=project_id,
                    connector=connector,
                    mode=str(config.get("mode", "sandbox")),
                    display_name=str(config.get("displayName", "")),
                    base_url=str(config.get("baseUrl", "")),
                    config=(
                        config.get("options")
                        if isinstance(config.get("options"), dict)
                        else {}
                    ),
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="connector",
                entity_id=connector,
                detail=f"mode={config.get('mode', 'sandbox')}",
            )
            return {"ok": True, "connector": connector, "status": "configured"}

        if body.action == "test_connector":
            connector = body.connector or ""
            config = get_connector_config(project_id, connector)
            if not config:
                raise HTTPException(status_code=400, detail="connector_not_configured")
            if config["mode"] == "sandbox":
                detail = "本地沙箱连接验证通过（未访问真实第三方）"
                set_connector_status(
                    project_id=project_id,
                    connector=connector,
                    status="connected",
                )
                append_sync_event(
                    project_id=project_id,
                    connector=connector,
                    direction="inbound",
                    entity_type="connection_test",
                    status="success",
                    detail=detail,
                )
                append_project_audit_log(
                    actor_id=user["id"],
                    actor_type="connector",
                    action=body.action,
                    entity_type="connector",
                    entity_id=connector,
                    detail=detail,
                )
                return {
                    "ok": True,
                    "connector": connector,
                    "status": "connected",
                    "mode": "sandbox",
                    "detail": detail,
                }

            required_credentials = {
                "feishu": ("FEISHU_APP_ID", "FEISHU_APP_SECRET"),
                "dingtalk": ("DINGTALK_APP_KEY", "DINGTALK_APP_SECRET"),
                "sheet": ("SHEET_CONNECTOR_TOKEN",),
                "git": (),
                "jira": ("JIRA_BASE_URL", "JIRA_API_TOKEN"),
            }
            missing = [
                name
                for name in required_credentials.get(connector, ())
                if not os.getenv(name)
            ]
            if connector == "git" and not missing:
                options = json.loads(config["config_json"] or "{}")
                try:
                    repository = test_github_connection(
                        base_url=str(config["base_url"]),
                        scope=str(options.get("scope", "")),
                        token=os.getenv("GIT_ACCESS_TOKEN", ""),
                    )
                except GitHubConnectorError as error:
                    detail = str(error)
                    set_connector_status(
                        project_id=project_id,
                        connector=connector,
                        status="error",
                        error=detail,
                    )
                    append_sync_event(
                        project_id=project_id,
                        connector=connector,
                        direction="inbound",
                        entity_type="connection_test",
                        status="failed",
                        detail=detail,
                    )
                    raise HTTPException(status_code=502, detail=detail) from error
                detail = (
                    f"GitHub 仓库 {repository['scope']} 连接成功；"
                    f"默认分支 {repository['defaultBranch']}"
                    + (
                        "（公共仓库免 Token 模式）"
                        if not os.getenv("GIT_ACCESS_TOKEN")
                        else ""
                    )
                )
                set_connector_status(
                    project_id=project_id,
                    connector=connector,
                    status="connected",
                )
                append_sync_event(
                    project_id=project_id,
                    connector=connector,
                    direction="inbound",
                    entity_type="connection_test",
                    status="success",
                    detail=detail,
                )
                append_project_audit_log(
                    actor_id=user["id"],
                    actor_type="connector",
                    action=body.action,
                    entity_type="connector",
                    entity_id=connector,
                    detail=detail,
                )
                return {
                    "ok": True,
                    "connector": connector,
                    "status": "connected",
                    "mode": "live",
                    "detail": detail,
                    "repository": repository,
                }
            detail = (
                f"服务端缺少凭证：{', '.join(missing)}"
                if missing
                else "服务端凭证已发现，但真实第三方适配器尚未启用"
            )
            set_connector_status(
                project_id=project_id,
                connector=connector,
                status="error",
                error=detail,
            )
            append_sync_event(
                project_id=project_id,
                connector=connector,
                direction="inbound",
                entity_type="connection_test",
                status="failed",
                detail=detail,
            )
            return {
                "ok": False,
                "connector": connector,
                "status": "error",
                "mode": "live",
                "detail": detail,
            }

        if body.action == "sync_connector":
            connector = body.connector or ""
            config = get_connector_config(project_id, connector)
            if not config:
                raise HTTPException(status_code=400, detail="connector_not_configured")
            if config["status"] != "connected":
                raise HTTPException(status_code=409, detail="connector_not_connected")
            if config["mode"] == "live" and connector == "git":
                try:
                    result = sync_project_github_evidence(
                        project_id=project_id,
                        trigger_type="manual",
                        actor_id="github-connector",
                    )
                except (GitHubConnectorError, ValueError) as error:
                    detail = str(error)
                    raise HTTPException(status_code=502, detail=detail) from error
                append_project_audit_log(
                    actor_id=user["id"],
                    actor_type="connector",
                    action=body.action,
                    entity_type="progress_evidence",
                    entity_id=connector,
                    detail=result["detail"],
                )
                return {"ok": True, **result}
            if config["mode"] != "sandbox":
                raise HTTPException(status_code=409, detail="live_sync_not_available")
            demo_counts = {
                "feishu": 8,
                "dingtalk": 8,
                "sheet": 24,
                "git": 12,
                "jira": 23,
            }
            count = demo_counts.get(connector, 0)
            detail = f"沙箱同步演练完成：校验 {count} 条样例记录，未写入真实业务数据"
            set_connector_status(
                project_id=project_id,
                connector=connector,
                status="connected",
                synced=True,
            )
            append_sync_event(
                project_id=project_id,
                connector=connector,
                direction="inbound",
                entity_type="sandbox_sample",
                status="success",
                detail=detail,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="connector",
                action=body.action,
                entity_type="connector",
                entity_id=connector,
                detail=detail,
            )
            return {"ok": True, "connector": connector, "count": count, "detail": detail}

        if body.action == "link_external_evidence":
            connector = body.connector or ""
            external_id = body.entityId or ""
            task_id = body.taskId or ""
            try:
                link_external_work_evidence(
                    project_id=project_id,
                    connector=connector,
                    external_id=external_id,
                    task_id=task_id,
                )
                inspection = run_project_inspection(
                    project_id=project_id,
                    trigger_type="manual",
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="progress_evidence",
                entity_id=external_id,
                detail=f"connector={connector} task={task_id}",
            )
            return {
                "ok": True,
                "connector": connector,
                "externalId": external_id,
                "taskId": task_id,
                "inspection": {
                    "id": inspection["id"],
                    "total": inspection["total"],
                },
            }

        if body.action == "disconnect_connector":
            connector = body.connector or ""
            try:
                set_connector_status(
                    project_id=project_id,
                    connector=connector,
                    status="configured",
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="connector",
                entity_id=connector,
                detail="连接已停用，配置仍保留",
            )
            return {"ok": True, "connector": connector, "status": "configured"}

        if body.action == "update_automation_rule":
            rule = body.automationRule or {}
            if not isinstance(rule.get("enabled"), bool):
                raise HTTPException(status_code=400, detail="invalid_automation_rule")
            try:
                upsert_automation_rule(
                    project_id=project_id,
                    rule_key=str(rule.get("ruleKey", "")),
                    enabled=rule["enabled"],
                    channel=str(rule.get("channel", "workspace")),
                    config=(
                        rule.get("config")
                        if isinstance(rule.get("config"), dict)
                        else {}
                    ),
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="automation_rule",
                entity_id=str(rule.get("ruleKey", "")),
                detail=(
                    f"enabled={rule['enabled']} channel={rule.get('channel', 'workspace')}"
                ),
            )
            return {"ok": True, "ruleKey": rule.get("ruleKey")}

        if body.action == "run_ai_inspection":
            result = run_project_inspection(
                project_id=project_id,
                trigger_type="manual",
                actor_id=user["id"],
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="ai",
                action=body.action,
                entity_type="workspace_inspection",
                entity_id=result["id"],
                detail=(
                    f"total={result['total']} progress={result['progress']} "
                    f"resource={result['resource']} risk={result['risk']}"
                ),
            )
            return {"ok": True, **result}

        if body.action == "update_inspection_finding":
            finding = body.finding or {}
            fingerprint = str(finding.get("fingerprint", ""))
            status = str(finding.get("status", ""))
            note = str(finding.get("note", ""))
            try:
                update_inspection_finding(
                    project_id=project_id,
                    fingerprint=fingerprint,
                    status=status,
                    note=note,
                    actor_id=user["id"],
                )
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="inspection_finding",
                entity_id=fingerprint,
                detail=f"status={status} note={note}",
            )
            return {"ok": True, "fingerprint": fingerprint, "status": status}

        if body.action == "apply_resource_reallocation":
            task = body.task
            resource_records = body.resources or []
            resource_fields = {
                "name",
                "role",
                "level",
                "project",
                "load",
                "available",
                "allocation",
                "skills",
                "domains",
                "risk",
            }
            if (
                not task
                or not valid_task_record(task)
                or len(resource_records) != 2
                or any(
                    not resource_fields.issubset(resource)
                    for resource in resource_records
                )
            ):
                raise HTTPException(
                    status_code=400, detail="invalid_resource_reallocation"
                )
            upsert_tasks_with_hierarchy(
                tasks=[task],
                hierarchy=[],
                actor_id=user["id"],
                actor_type="ai",
                action=body.action,
                project_id=project_id,
            )
            for resource in resource_records:
                upsert_project_record(
                    record_id=str(resource["name"]),
                    entity_type="resource",
                    title=str(resource["name"]),
                    owner_id=None,
                    status=str(resource.get("memberStatus", "在职")),
                    payload=resource,
                    project_id=project_id,
                )
                append_project_audit_log(
                    actor_id=user["id"],
                    actor_type="ai",
                    action=body.action,
                    entity_type="resource",
                    entity_id=str(resource["name"]),
                    detail=body.detail or "AI resource reallocation",
                )
            return {
                "ok": True,
                "taskId": task[0],
                "resources": [resource["name"] for resource in resource_records],
            }

        if body.action in {
            "create_task",
            "create_tasks",
            "sync_task_progress",
        }:
            task_records = body.tasks or ([body.task] if body.task else [])
            if (
                not task_records
                or len({task[0] for task in task_records if task})
                != len(task_records)
                or any(not valid_task_record(task) for task in task_records)
            ):
                raise HTTPException(status_code=400, detail="invalid_task")
            hierarchy = body.hierarchy or []
            task_ids = {task[0] for task in task_records}
            config = body.versionConfig
            if config and (
                config.get("version") not in VALID_VERSIONS
                or config.get("mode") not in {"agile", "waterfall"}
                or not isinstance(config.get("locked"), bool)
            ):
                raise HTTPException(status_code=400, detail="invalid_version_config")
            if not valid_task_hierarchy(hierarchy, task_ids):
                raise HTTPException(status_code=400, detail="invalid_task_hierarchy")
            upsert_tasks_with_hierarchy(
                tasks=task_records,
                hierarchy=hierarchy,
                actor_id=user["id"],
                actor_type=(
                    "ai" if body.action == "sync_task_progress" else "user"
                ),
                action=body.action,
                version_config=config,
                project_id=project_id,
            )
            return {"ok": True, "count": len(task_records)}

        if body.action in {"upsert_resource", "sync_directory_members"}:
            resource_records = body.resources or (
                [body.resource] if body.resource else []
            )
            required_fields = {
                "name",
                "role",
                "level",
                "project",
                "load",
                "available",
                "allocation",
                "skills",
                "domains",
                "risk",
            }
            if not resource_records or any(
                not required_fields.issubset(resource)
                for resource in resource_records
            ):
                raise HTTPException(status_code=400, detail="invalid_resource")
            for resource in resource_records:
                status = str(resource.get("memberStatus", "在职"))
                upsert_project_record(
                    record_id=str(resource["name"]),
                    entity_type="resource",
                    title=str(resource["name"]),
                    owner_id=None,
                    status=status,
                    payload=resource,
                    project_id=project_id,
                )
                append_project_audit_log(
                    actor_id=user["id"],
                    actor_type=(
                        "connector"
                        if body.action == "sync_directory_members"
                        else "user"
                    ),
                    action=body.action,
                    entity_type="resource",
                    entity_id=str(resource["name"]),
                    detail=(
                        f"{status} source={resource.get('source', 'workbench')}"
                    ),
                )
            return {"ok": True, "count": len(resource_records)}

        if body.action == "upsert_task_blocker":
            blocker = body.blocker
            required_fields = {
                "id",
                "taskId",
                "version",
                "category",
                "reason",
                "source",
                "owner",
                "discoveredAt",
                "expectedResolveAt",
                "status",
                "impact",
                "resolutionPlan",
                "updatedAt",
            }
            if not blocker or not required_fields.issubset(blocker):
                raise HTTPException(status_code=400, detail="invalid_blocker")
            if blocker["version"] not in VALID_VERSIONS:
                raise HTTPException(status_code=400, detail="invalid_blocker")
            upsert_project_record(
                record_id=str(blocker["id"]),
                entity_type="blocker",
                title=str(blocker["reason"]),
                owner_id=str(blocker["owner"]),
                status=str(blocker["status"]),
                payload=blocker,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="blocker",
                entity_id=str(blocker["id"]),
                detail=(
                    f"task={blocker['taskId']} status={blocker['status']} "
                    f"source={blocker['source']}"
                ),
            )
            return {"ok": True, "id": blocker["id"]}

        if body.action == "create_risk":
            risk = body.risk
            required_fields = {
                "id",
                "version",
                "level",
                "title",
                "owner",
                "impact",
                "trigger",
                "status",
                "plan",
            }
            if not risk or not required_fields.issubset(risk):
                raise HTTPException(status_code=400, detail="invalid_risk")
            if risk["version"] not in VALID_VERSIONS:
                raise HTTPException(status_code=400, detail="invalid_risk")
            upsert_project_record(
                record_id=str(risk["id"]),
                entity_type="risk",
                title=str(risk["title"]),
                owner_id=str(risk["owner"]),
                status=str(risk["status"]),
                payload=risk,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="risk",
                entity_id=str(risk["id"]),
                detail=f"{risk['version']} {risk['title']}",
            )
            return {"ok": True, "id": risk["id"]}

        if body.action == "upsert_version_config":
            config = body.versionConfig
            if (
                not config
                or config.get("version") not in VALID_VERSIONS
                or config.get("mode") not in {"agile", "waterfall"}
                or not isinstance(config.get("locked"), bool)
            ):
                raise HTTPException(status_code=400, detail="invalid_version_config")
            require_project_permission("manage_version", str(config["version"]))
            upsert_project_record(
                record_id=f"VERSION-CONFIG-{config['version']}",
                entity_type="version_config",
                title=f"{config['version']} delivery mode",
                owner_id=None,
                status="locked" if config["locked"] else "draft",
                payload=config,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="version_config",
                entity_id=str(config["version"]),
                detail=f"mode={config['mode']} locked={config['locked']}",
            )
            return {"ok": True, "version": config["version"]}

        if body.action in {"create_meeting", "update_meeting_minutes"}:
            meeting = body.meeting
            required_fields = {
                "id",
                "title",
                "date",
                "time",
                "attendees",
                "agenda",
                "status",
            }
            if not meeting or not required_fields.issubset(meeting):
                raise HTTPException(status_code=400, detail="invalid_meeting")
            if (
                body.action == "update_meeting_minutes"
                and not valid_meeting_minutes(meeting)
            ):
                raise HTTPException(
                    status_code=400, detail="invalid_meeting_minutes"
                )
            upsert_project_record(
                record_id=str(meeting["id"]),
                entity_type="meeting",
                title=str(meeting["title"]),
                owner_id=str(meeting["attendees"]),
                status=str(meeting["status"]),
                payload=meeting,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="meeting",
                entity_id=str(meeting["id"]),
                detail=(
                    f"{meeting['date']} {meeting['time']} {meeting['title']} "
                    f"status={meeting['status']}"
                ),
            )
            return {"ok": True, "id": meeting["id"]}

        if body.action == "create_report":
            report = body.report
            required_fields = {
                "id",
                "type",
                "version",
                "summary",
                "createdAt",
            }
            if not report or not required_fields.issubset(report):
                raise HTTPException(status_code=400, detail="invalid_report")
            upsert_project_record(
                record_id=str(report["id"]),
                entity_type="report",
                title=f"{report['version']} {report['type']}",
                owner_id=user["id"],
                status="已生成",
                payload=report,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="ai",
                action=body.action,
                entity_type="report",
                entity_id=str(report["id"]),
                detail=f"{report['version']} {report['type']}",
            )
            return {"ok": True, "id": report["id"]}

        if body.action in {"create_change", "update_change"}:
            change = body.change
            required_fields = {
                "id",
                "title",
                "description",
                "sourceVersion",
                "targetVersion",
                "status",
                "currentStep",
                "owner",
                "reviewer",
                "scheduleImpact",
                "resourceImpact",
                "affectedTasks",
                "recommendation",
                "updatedAt",
                "history",
            }
            if not change or not required_fields.issubset(change):
                raise HTTPException(status_code=400, detail="invalid_change")
            if body.action == "update_change" and change.get("currentStep") == 2:
                require_project_permission(
                    "approve_change", str(change["targetVersion"])
                )
            if (
                change["sourceVersion"] not in VALID_VERSIONS
                or change["targetVersion"] not in VALID_VERSIONS
                or not isinstance(change["history"], list)
            ):
                raise HTTPException(status_code=400, detail="invalid_change")
            upsert_project_record(
                record_id=str(change["id"]),
                entity_type="change",
                title=str(change["title"]),
                owner_id=str(change["owner"]),
                status=str(change["status"]),
                payload=change,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="change",
                entity_id=str(change["id"]),
                detail=(
                    f"{change['status']} step={change['currentStep']} "
                    f"target={change['targetVersion']}"
                ),
            )
            return {"ok": True, "id": change["id"]}

        if body.action == "apply_change_wbs":
            change = body.change
            task_records = body.tasks or []
            links = body.links or []
            hierarchy = body.hierarchy or []
            if (
                not change
                or not task_records
                or any(not valid_task_record(task) for task in task_records)
                or any(
                    not {"id", "taskId", "relationType"}.issubset(link)
                    for link in links
                )
                or len(hierarchy) != len(task_records)
                or not valid_task_hierarchy(
                    hierarchy, {task[0] for task in task_records}
                )
            ):
                raise HTTPException(status_code=400, detail="invalid_change_wbs")
            if change.get("targetVersion") not in VALID_VERSIONS:
                raise HTTPException(status_code=400, detail="invalid_change_wbs")
            if any(task[3] != change["targetVersion"] for task in task_records):
                raise HTTPException(status_code=400, detail="invalid_change_wbs")
            linked_task_ids = {link["taskId"] for link in links}
            if any(task[0] not in linked_task_ids for task in task_records):
                raise HTTPException(status_code=400, detail="invalid_change_wbs")
            require_project_permission(
                "manage_version", str(change["targetVersion"])
            )
            apply_change_wbs(
                change=change,
                tasks=task_records,
                links=links,
                hierarchy=hierarchy,
                actor_id=user["id"],
                project_id=project_id,
            )
            return {
                "ok": True,
                "changeId": change["id"],
                "taskIds": [task[0] for task in task_records],
            }

        if body.action == "save_plan_baseline":
            if (
                body.versionId not in VALID_VERSIONS
                or not body.baselineKey
                or not body.label
                or body.snapshot is None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="invalid_plan_baseline",
                )
            require_project_permission("manage_version", body.versionId)
            row_id = str(uuid4())
            save_plan_baseline(
                row_id=row_id,
                version_id=body.versionId,
                baseline_key=body.baselineKey,
                label=body.label,
                snapshot=body.snapshot,
                created_by=user["id"],
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="plan_baseline",
                entity_id=row_id,
                detail=f"{body.versionId} {body.baselineKey} {body.label}",
            )
            return {"ok": True, "id": row_id}

        if body.action == "record_milestone_actual":
            if (
                body.versionId not in VALID_VERSIONS
                or not body.milestoneKey
                or not body.occurredAt
                or not valid_milestone_datetime(body.occurredAt)
            ):
                raise HTTPException(
                    status_code=400,
                    detail="invalid_milestone_event",
                )
            require_project_permission(
                "approve_release"
                if "发布" in body.milestoneKey
                else "manage_version",
                body.versionId,
            )
            record_milestone_actual(
                version_id=body.versionId,
                milestone_key=body.milestoneKey,
                occurred_at=body.occurredAt,
                detail=body.detail,
                project_id=project_id,
            )
            append_project_audit_log(
                actor_id=user["id"],
                actor_type="user",
                action=body.action,
                entity_type="milestone_event",
                entity_id=(
                    f"{body.versionId}-{body.milestoneKey}-{body.occurredAt}"
                ),
                detail=body.detail,
            )
            return {"ok": True}

        if not body.entityType:
            raise HTTPException(status_code=400, detail="invalid_request")
        append_project_audit_log(
            actor_id=user["id"],
            actor_type="user",
            action=body.action,
            entity_type=body.entityType,
            entity_id=body.entityId,
            detail=body.detail,
        )
        return {"ok": True}
    except sqlite3.IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="conflicting_record",
        ) from error
