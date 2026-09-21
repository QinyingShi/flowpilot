from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path


class BackendDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ.pop("PROJECT_AI_REQUIREMENTS_ENABLED", None)
        os.environ.pop("OPENAI_API_KEY", None)
        os.environ["PROJECT_DB_PATH"] = str(
            Path(self.temp_dir.name) / "test.db"
        )

    def tearDown(self) -> None:
        os.environ.pop("PROJECT_DB_PATH", None)
        os.environ.pop("PROJECT_API_PROXY_SECRET", None)
        os.environ.pop("PROJECT_ENV", None)
        os.environ.pop("PROJECT_MEMBERSHIP_MODE", None)
        os.environ.pop("PROJECT_BOOTSTRAP_ADMIN_EMAIL", None)
        os.environ.pop("PROJECT_UPLOAD_PATH", None)
        for name in (
            "FEISHU_APP_ID",
            "FEISHU_APP_SECRET",
            "DINGTALK_APP_KEY",
            "DINGTALK_APP_SECRET",
            "SHEET_CONNECTOR_TOKEN",
            "GIT_ACCESS_TOKEN",
            "GITHUB_ALLOWED_HOSTS",
            "GITHUB_API_VERSION",
            "JIRA_BASE_URL",
            "JIRA_API_TOKEN",
            "PROJECT_AI_REQUIREMENTS_ENABLED",
            "OPENAI_API_KEY",
            "PROJECT_AI_MODEL",
            "OPENAI_RESPONSES_URL",
            "PROJECT_AI_TIMEOUT_SECONDS",
            "PROJECT_AI_PDF_DETAIL",
        ):
            os.environ.pop(name, None)
        self.temp_dir.cleanup()

    def test_plan_and_milestone_history_persist(self) -> None:
        from backend.app.database import (
            ensure_member,
            initialize_database,
            apply_change_wbs,
            record_milestone_actual,
            save_plan_baseline,
            upsert_project_record,
            workspace_snapshot,
        )

        initialize_database()
        ensure_member(
            {
                "id": "tester",
                "email": "tester@example.com",
                "displayName": "测试人",
            }
        )
        save_plan_baseline(
            row_id="test-plan",
            version_id="v1.1",
            baseline_key="TEST-1",
            label="测试计划",
            snapshot={"release": "10/21"},
            created_by="tester",
        )
        record_milestone_actual(
            version_id="v1.1",
            milestone_key="技术评审",
            occurred_at="2026-09-21T10:30:00+08:00",
            detail="测试记录",
        )
        custom_task = [
            "USR-TEST",
            "后端持久化验证",
            "星云客户平台",
            "v1.1",
            "测试人",
            "未开始",
            "中",
            "09/21",
            "09/22",
            "0%",
            "8h",
            "—",
            "低",
        ]
        upsert_project_record(
            record_id=custom_task[0],
            entity_type="task",
            title=custom_task[1],
            owner_id=custom_task[4],
            status=custom_task[5],
            payload=custom_task,
        )
        change_task = [
            "CR-TEST-W1",
            "测试变更 · 需求澄清",
            "星云客户平台",
            "v1.1",
            "测试人",
            "未开始",
            "中",
            "09/21",
            "09/22",
            "0%",
            "8h",
            "—",
            "低",
        ]
        change = {
            "id": "CR-TEST",
            "title": "测试变更",
            "owner": "测试人",
            "status": "计划已调整",
            "targetVersion": "v1.1",
        }
        apply_change_wbs(
            change=change,
            tasks=[change_task],
            links=[
                {
                    "id": "CR-TEST-CR-TEST-W1-created",
                    "taskId": "CR-TEST-W1",
                    "relationType": "变更新增",
                    "note": "测试原子写入",
                }
            ],
            hierarchy=[
                {
                    "taskId": "CR-TEST-W1",
                    "parentTaskId": "CR-TEST-WBS",
                    "rootTaskId": "CR-TEST-WBS",
                    "level": 1,
                    "sortOrder": 1,
                    "workType": "后端",
                    "acceptanceCriteria": "测试通过",
                }
            ],
            actor_id="tester",
        )

        snapshot = workspace_snapshot()
        self.assertGreaterEqual(len(snapshot["tasks"]), 30)
        self.assertEqual(len(snapshot["resources"]), 11)
        self.assertEqual(len(snapshot["risks"]), 3)
        self.assertEqual(len(snapshot["changes"]), 3)
        self.assertEqual(len(snapshot["blockers"]), 4)
        self.assertEqual(len(snapshot["versionConfigs"]), 3)
        self.assertTrue(
            any(
                config["version"] == "v0.9"
                and config["mode"] == "waterfall"
                and config["locked"] is True
                for config in snapshot["versionConfigs"]
            )
        )
        self.assertTrue(
            any(
                blocker["taskId"] == "2.2"
                and blocker["status"] == "待外部处理"
                for blocker in snapshot["blockers"]
            )
        )
        self.assertTrue(
            any(
                row["task_id"] == "CR-TEST-W1"
                and row["parent_task_id"] == "CR-TEST-WBS"
                and row["work_type"] == "后端"
                for row in snapshot["taskHierarchy"]
            )
        )
        self.assertTrue(
            any(
                change["id"] == "CR-012"
                and change["status"] == "已归档"
                and change["currentStep"] == 6
                for change in snapshot["changes"]
            )
        )
        self.assertTrue(
            any(task[0] == "USR-TEST" for task in snapshot["tasks"])
        )
        self.assertTrue(
            any(task[0] == "CR-TEST-W1" for task in snapshot["tasks"])
        )
        self.assertTrue(
            any(
                link["change_id"] == "CR-TEST"
                and link["task_id"] == "CR-TEST-W1"
                for link in snapshot["changeTaskLinks"]
            )
        )
        self.assertTrue(
            any(
                row["id"] == "test-plan"
                for row in snapshot["planBaselines"]
            )
        )
        self.assertTrue(
            any(
                row["version_id"] == "v1.1"
                and row["milestone_key"] == "技术评审"
                for row in snapshot["milestoneEvents"]
            )
        )

    def test_member_bootstrap_and_task_batch_are_safe(self) -> None:
        from backend.app.database import (
            ensure_member,
            initialize_database,
            member_has_project_access,
            upsert_tasks_with_hierarchy,
            workspace_snapshot,
        )

        initialize_database()
        first_role = ensure_member(
            {
                "id": "first-user",
                "email": "first@example.com",
                "displayName": "首位管理员",
            }
        )
        second_role = ensure_member(
            {
                "id": "second-user",
                "email": "second@example.com",
                "displayName": "只读成员",
            }
        )
        self.assertEqual(first_role, "admin")
        self.assertEqual(second_role, "viewer")
        self.assertTrue(member_has_project_access("second-user", "nebula-customer-platform"))

        task = [
            "TX-ROLLBACK",
            "事务回滚验证",
            "星云客户平台",
            "v1.1",
            "首位管理员",
            "未开始",
            "中",
            "09/21",
            "09/22",
            "0%",
            "8h",
            "—",
            "低",
        ]
        with self.assertRaises(KeyError):
            upsert_tasks_with_hierarchy(
                tasks=[task],
                hierarchy=[
                    {
                        "taskId": task[0],
                        "parentTaskId": None,
                        "level": 0,
                        "workType": "验证",
                    }
                ],
                actor_id="first-user",
                actor_type="user",
                action="create_task",
                version_config={
                    "version": "v1.1",
                    "mode": "waterfall",
                    "label": "传统瀑布",
                    "locked": False,
                },
            )
        snapshot = workspace_snapshot()
        self.assertFalse(any(item[0] == task[0] for item in snapshot["tasks"]))
        self.assertTrue(
            any(
                config["version"] == "v1.1"
                and config["mode"] == "agile"
                and config["locked"] is True
                for config in snapshot["versionConfigs"]
            )
        )

    def test_proxy_secret_is_required_when_configured(self) -> None:
        from fastapi import HTTPException

        from backend.app.main import verify_proxy_secret

        os.environ["PROJECT_API_PROXY_SECRET"] = "test-shared-secret"
        verify_proxy_secret("test-shared-secret")
        with self.assertRaises(HTTPException) as context:
            verify_proxy_secret("wrong-secret")
        self.assertEqual(context.exception.status_code, 401)

        os.environ.pop("PROJECT_API_PROXY_SECRET")
        os.environ["PROJECT_ENV"] = "production"
        with self.assertRaises(HTTPException) as context:
            verify_proxy_secret(None)
        self.assertEqual(context.exception.status_code, 503)

    def test_member_invitation_role_and_access_control(self) -> None:
        from fastapi import HTTPException

        from backend.app.database import (
            ensure_member,
            initialize_database,
            upsert_workspace_member,
            workspace_snapshot,
        )
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        self.assertEqual(
            ensure_member(
                {
                    "id": "workspace-admin",
                    "email": "admin@example.com",
                    "displayName": "管理员",
                }
            ),
            "admin",
        )
        invitation = upsert_workspace_member(
            {
                "email": "member@example.com",
                "displayName": "项目成员",
                "role": "member",
                "status": "invited",
            }
        )
        self.assertEqual(invitation["status"], "invited")
        self.assertEqual(
            ensure_member(
                {
                    "id": "member-login-id",
                    "email": "member@example.com",
                    "displayName": "项目成员",
                }
            ),
            "member",
        )
        activated = next(
            member
            for member in workspace_snapshot()["members"]
            if member["email"] == "member@example.com"
        )
        self.assertEqual(activated["status"], "active")
        self.assertEqual(activated["id"], "member-login-id")
        with self.assertRaisesRegex(ValueError, "last_admin_required"):
            upsert_workspace_member(
                {
                    "id": "workspace-admin",
                    "email": "admin@example.com",
                    "displayName": "管理员",
                    "role": "viewer",
                    "status": "active",
                }
            )

        own_task = [
            "MEMBER-TASK",
            "成员更新权限测试",
            "星云客户平台",
            "v1.0",
            "项目成员",
            "进行中",
            "中",
            "09/12",
            "09/13",
            "50%",
            "8h",
            "—",
            "低",
        ]
        response = mutate_workspace(
            WorkspaceAction(action="sync_task_progress", task=own_task),
            x_user_id="member-login-id",
            x_user_email="member@example.com",
            x_user_display_name="项目成员",
            x_project_api_secret=None,
        )
        self.assertTrue(response["ok"])
        with self.assertRaises(HTTPException) as context:
            mutate_workspace(
                WorkspaceAction(
                    action="upsert_workspace_member",
                    member={
                        "email": "other@example.com",
                        "displayName": "其他成员",
                        "role": "viewer",
                        "status": "invited",
                    },
                ),
                x_user_id="member-login-id",
                x_user_email="member@example.com",
                x_user_display_name="项目成员",
                x_project_api_secret=None,
            )
        self.assertEqual(context.exception.status_code, 403)

    def test_production_bootstrap_requires_designated_admin(self) -> None:
        from backend.app.database import ensure_member, initialize_database

        os.environ["PROJECT_ENV"] = "production"
        os.environ["PROJECT_BOOTSTRAP_ADMIN_EMAIL"] = "owner@example.com"
        initialize_database()
        with self.assertRaisesRegex(PermissionError, "bootstrap_admin_required"):
            ensure_member(
                {
                    "id": "stranger",
                    "email": "stranger@example.com",
                    "displayName": "陌生用户",
                }
            )
        self.assertEqual(
            ensure_member(
                {
                    "id": "owner",
                    "email": "owner@example.com",
                    "displayName": "工作区管理员",
                }
            ),
            "admin",
        )
    def test_task_contract_rejects_invalid_records_and_hierarchy(self) -> None:
        from backend.app.task_model import (
            valid_task_hierarchy,
            valid_task_record,
        )

        task = [
            "TASK-CONTRACT",
            "任务契约校验",
            "星云客户平台",
            "v1.0",
            "测试人",
            "进行中",
            "高",
            "09/12",
            "09/18",
            "30%",
            "24h",
            "—",
            "中",
        ]
        self.assertTrue(valid_task_record(task))
        self.assertFalse(valid_task_record([*task[:9], "130%", *task[10:]]))
        self.assertFalse(valid_task_record([*task[:5], "未知", *task[6:]]))
        self.assertFalse(valid_task_record([*task[:7], "02/31", *task[8:]]))
        self.assertTrue(
            valid_task_hierarchy(
                [
                    {
                        "taskId": task[0],
                        "parentTaskId": None,
                        "rootTaskId": task[0],
                        "level": 0,
                        "workType": "用户故事",
                    }
                ],
                {task[0]},
            )
        )
        self.assertFalse(
            valid_task_hierarchy(
                [
                    {
                        "taskId": task[0],
                        "parentTaskId": "OTHER",
                        "rootTaskId": task[0],
                        "level": 0,
                        "workType": "用户故事",
                    }
                ],
                {task[0]},
            )
        )

    def test_legacy_project_records_migrate_without_data_loss(self) -> None:
        import json
        import sqlite3

        from backend.app.database import initialize_database, workspace_snapshot

        legacy_task = [
            "LEGACY-TASK",
            "迁移前任务",
            "星云客户平台",
            "v1.0",
            "历史成员",
            "进行中",
            "中",
            "09/10",
            "09/14",
            "40%",
            "16h",
            "—",
            "低",
        ]
        database_path = os.environ["PROJECT_DB_PATH"]
        with sqlite3.connect(database_path) as db:
            db.executescript(
                """CREATE TABLE audit_logs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  actor_id TEXT NOT NULL,
                  actor_type TEXT NOT NULL,
                  action TEXT NOT NULL,
                  entity_type TEXT NOT NULL,
                  entity_id TEXT,
                  detail TEXT,
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE sync_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  connector TEXT NOT NULL,
                  direction TEXT NOT NULL,
                  entity_type TEXT NOT NULL,
                  entity_id TEXT,
                  status TEXT NOT NULL,
                  detail TEXT,
                  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO audit_logs
                  (actor_id, actor_type, action, entity_type)
                VALUES ('legacy-user', 'user', 'legacy-action', 'task');"""
            )
            db.execute(
                """CREATE TABLE project_records (
                  id TEXT PRIMARY KEY,
                  entity_type TEXT NOT NULL,
                  title TEXT NOT NULL,
                  owner_id TEXT,
                  status TEXT NOT NULL,
                  source_system TEXT NOT NULL DEFAULT 'workbench',
                  source_ref TEXT,
                  payload_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            db.execute(
                """INSERT INTO project_records
                  (id, entity_type, title, owner_id, status, payload_json)
                VALUES (?, 'task', ?, ?, ?, ?)""",
                (
                    legacy_task[0],
                    legacy_task[1],
                    legacy_task[4],
                    legacy_task[5],
                    json.dumps(legacy_task, ensure_ascii=False),
                ),
            )

        initialize_database()

        migrated = {
            task[0]: task for task in workspace_snapshot()["tasks"]
        }
        self.assertEqual(migrated[legacy_task[0]], legacy_task)
        self.assertEqual(
            workspace_snapshot()["auditLogs"][0]["action"],
            "legacy-action",
        )
        with sqlite3.connect(database_path) as db:
            columns = {
                row[1] for row in db.execute("PRAGMA table_info(project_records)")
            }
            indexes = {
                row[1] for row in db.execute("PRAGMA index_list(project_records)")
            }
        self.assertIn("project_id", columns)
        self.assertIn("idx_project_records_type_status", indexes)
        self.assertIn("idx_project_records_owner", indexes)
        with sqlite3.connect(database_path) as db:
            self.assertIn(
                "project_id",
                {
                    row[1]
                    for row in db.execute("PRAGMA table_info(audit_logs)")
                },
            )
            self.assertIn(
                "project_id",
                {
                    row[1]
                    for row in db.execute("PRAGMA table_info(sync_events)")
                },
            )

    def test_project_records_are_isolated_and_version_permissions_apply(self) -> None:
        from fastapi import HTTPException

        from backend.app.database import (
            append_audit_log,
            ensure_member,
            initialize_database,
            member_has_permission,
            replace_member_permissions,
            upsert_project_record,
            upsert_tasks_with_hierarchy,
            upsert_workspace_member,
            workspace_snapshot,
        )
        from backend.app.main import WorkspaceAction, get_workspace, mutate_workspace

        initialize_database()
        ensure_member(
            {
                "id": "scope-admin",
                "email": "scope-admin@example.com",
                "displayName": "范围管理员",
            }
        )
        task_a = [
            "SAME-ID",
            "项目 A 任务",
            "项目 A",
            "v1.0",
            "范围管理员",
            "未开始",
            "中",
            "09/13",
            "09/14",
            "0%",
            "8h",
            "—",
            "低",
        ]
        task_b = [*task_a]
        task_b[1] = "项目 B 任务"
        task_b[2] = "项目 B"
        for project_id, task in (("project-a", task_a), ("project-b", task_b)):
            upsert_project_record(
                record_id=task[0],
                entity_type="task",
                title=task[1],
                owner_id=task[4],
                status=task[5],
                payload=task,
                project_id=project_id,
            )
        self.assertEqual(workspace_snapshot("project-a")["tasks"], [task_a])
        self.assertEqual(workspace_snapshot("project-b")["tasks"], [task_b])
        for project_id, task in (("project-a", task_a), ("project-b", task_b)):
            upsert_tasks_with_hierarchy(
                tasks=[task],
                hierarchy=[
                    {
                        "taskId": task[0],
                        "parentTaskId": None,
                        "rootTaskId": task[0],
                        "level": 0,
                        "sortOrder": 0,
                        "workType": "用户故事",
                        "acceptanceCriteria": "独立项目验收",
                    }
                ],
                actor_id="scope-admin",
                actor_type="user",
                action="test_scope",
                project_id=project_id,
            )
        self.assertEqual(
            workspace_snapshot("project-a")["taskHierarchy"][0]["project_id"],
            "project-a",
        )
        self.assertEqual(
            workspace_snapshot("project-b")["taskHierarchy"][0]["project_id"],
            "project-b",
        )
        append_audit_log(
            project_id="project-a",
            actor_id="scope-admin",
            actor_type="user",
            action="project-a-action",
            entity_type="task",
            entity_id=task_a[0],
        )
        append_audit_log(
            project_id="project-b",
            actor_id="scope-admin",
            actor_type="user",
            action="project-b-action",
            entity_type="task",
            entity_id=task_b[0],
        )
        self.assertIn(
            "project-a-action",
            {
                record["action"]
                for record in workspace_snapshot("project-a")["auditLogs"]
            },
        )
        self.assertIn(
            "project-b-action",
            {
                record["action"]
                for record in workspace_snapshot("project-b")["auditLogs"]
            },
        )

        invited = upsert_workspace_member(
            {
                "email": "version-owner@example.com",
                "displayName": "版本负责人",
                "role": "project_manager",
                "status": "invited",
            }
        )
        member_id = invited["id"]
        replace_member_permissions(
            member_id=member_id,
            project_id="nebula-customer-platform",
            permissions=[
                {"permission": "manage_version", "versionId": "v1.0"}
            ],
        )
        self.assertTrue(
            member_has_permission(
                member_id=member_id,
                project_id="nebula-customer-platform",
                permission="manage_version",
                version_id="v1.0",
            )
        )
        ensure_member(
            {
                "id": "version-owner-login",
                "email": "version-owner@example.com",
                "displayName": "版本负责人",
            }
        )
        response = mutate_workspace(
            WorkspaceAction(
                action="save_plan_baseline",
                versionId="v1.0",
                baselineKey="OWNER-TEST",
                label="负责人计划",
                snapshot={"release": "09/30"},
            ),
            x_user_id="version-owner-login",
            x_user_email="version-owner@example.com",
            x_user_display_name="版本负责人",
            x_project_api_secret=None,
        )
        self.assertTrue(response["ok"])
        with self.assertRaises(HTTPException) as context:
            mutate_workspace(
                WorkspaceAction(
                    action="save_plan_baseline",
                    versionId="v1.1",
                    baselineKey="DENIED-TEST",
                    label="越权计划",
                    snapshot={"release": "10/20"},
                ),
                x_user_id="version-owner-login",
                x_user_email="version-owner@example.com",
                x_user_display_name="版本负责人",
                x_project_api_secret=None,
            )
        self.assertEqual(context.exception.status_code, 403)

        with self.assertRaises(HTTPException) as context:
            get_workspace(
                x_user_id="version-owner-login",
                x_user_email="version-owner@example.com",
                x_user_display_name="版本负责人",
                x_project_api_secret=None,
                x_project_id="project-a",
            )
        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail, "project_access_required")

        with self.assertRaises(HTTPException) as context:
            mutate_workspace(
                WorkspaceAction(
                    action="record_milestone_actual",
                    versionId="v1.0",
                    milestoneKey="Beta 发布",
                    occurredAt="2026-09-30T18:00:00+08:00",
                    detail="未经发布审批授权",
                ),
                x_user_id="version-owner-login",
                x_user_email="version-owner@example.com",
                x_user_display_name="版本负责人",
                x_project_api_secret=None,
            )
        self.assertEqual(context.exception.status_code, 403)

        replace_member_permissions(
            member_id="version-owner-login",
            project_id="nebula-customer-platform",
            permissions=[
                {"permission": "manage_version", "versionId": "v1.0"},
                {"permission": "approve_release", "versionId": "v1.0"},
            ],
        )
        release_response = mutate_workspace(
            WorkspaceAction(
                action="record_milestone_actual",
                versionId="v1.0",
                milestoneKey="Beta 发布",
                occurredAt="2026-09-30T18:00:00+08:00",
                detail="发布审批通过",
            ),
            x_user_id="version-owner-login",
            x_user_email="version-owner@example.com",
            x_user_display_name="版本负责人",
            x_project_api_secret=None,
        )
        self.assertTrue(release_response["ok"])

    def test_project_lifecycle_membership_and_archive_access(self) -> None:
        from fastapi import HTTPException

        from backend.app.database import (
            ensure_member,
            initialize_database,
            list_projects,
            upsert_workspace_member,
        )
        from backend.app.main import WorkspaceAction, get_workspace, mutate_workspace

        initialize_database()
        ensure_member(
            {
                "id": "project-admin",
                "email": "project-admin@example.com",
                "displayName": "项目管理员",
            }
        )
        invitation = upsert_workspace_member(
            {
                "email": "new-project-member@example.com",
                "displayName": "新项目成员",
                "role": "member",
                "status": "invited",
            }
        )
        ensure_member(
            {
                "id": "new-project-member-login",
                "email": "new-project-member@example.com",
                "displayName": "新项目成员",
            }
        )
        created = mutate_workspace(
            WorkspaceAction(
                action="create_project",
                project={
                    "name": "智能客服升级",
                    "code": "AICS",
                    "description": "客服工作台与 AI 辅助升级",
                    "initialVersion": "v1.0",
                    "deliveryMode": "agile",
                    "releaseDate": "2026-10-20",
                },
                memberIds=["new-project-member-login"],
            ),
            x_user_id="project-admin",
            x_user_email="project-admin@example.com",
            x_user_display_name="项目管理员",
            x_project_api_secret=None,
        )
        project_id = created["project"]["id"]
        self.assertNotEqual(project_id, "nebula-customer-platform")
        member_workspace = get_workspace(
            x_user_id="new-project-member-login",
            x_user_email="new-project-member@example.com",
            x_user_display_name="新项目成员",
            x_project_api_secret=None,
            x_project_id=project_id,
        )
        self.assertEqual(member_workspace["projectId"], project_id)
        self.assertEqual(
            member_workspace["snapshot"]["versionConfigs"][0]["version"],
            "v1.0",
        )
        self.assertEqual(member_workspace["snapshot"]["tasks"], [])
        self.assertEqual(
            {
                project["code"]
                for project in list_projects("project-admin", "admin")
            },
            {"AICS", "NEBULA"},
        )
        updated = mutate_workspace(
            WorkspaceAction(
                action="update_project_details",
                projectId=project_id,
                project={
                    "name": "智能客服升级二期",
                    "description": "补充知识库与坐席协同范围",
                },
            ),
            x_user_id="project-admin",
            x_user_email="project-admin@example.com",
            x_user_display_name="项目管理员",
            x_project_api_secret=None,
        )
        self.assertEqual(updated["project"]["name"], "智能客服升级二期")

        with self.assertRaises(HTTPException) as context:
            mutate_workspace(
                WorkspaceAction(
                    action="create_project",
                    project={
                        "name": "越权项目",
                        "code": "DENIED",
                        "initialVersion": "v1.0",
                        "deliveryMode": "agile",
                    },
                ),
                x_user_id="new-project-member-login",
                x_user_email="new-project-member@example.com",
                x_user_display_name="新项目成员",
                x_project_api_secret=None,
                x_project_id=project_id,
            )
        self.assertEqual(context.exception.status_code, 403)

        mutate_workspace(
            WorkspaceAction(
                action="update_project_status",
                projectId=project_id,
                projectStatus="archived",
            ),
            x_user_id="project-admin",
            x_user_email="project-admin@example.com",
            x_user_display_name="项目管理员",
            x_project_api_secret=None,
        )
        with self.assertRaises(HTTPException) as context:
            get_workspace(
                x_user_id="new-project-member-login",
                x_user_email="new-project-member@example.com",
                x_user_display_name="新项目成员",
                x_project_api_secret=None,
                x_project_id=project_id,
            )
        self.assertEqual(context.exception.detail, "project_access_required")

        mutate_workspace(
            WorkspaceAction(
                action="update_project_status",
                projectId=project_id,
                projectStatus="active",
            ),
            x_user_id="project-admin",
            x_user_email="project-admin@example.com",
            x_user_display_name="项目管理员",
            x_project_api_secret=None,
        )
        self.assertEqual(
            get_workspace(
                x_user_id="new-project-member-login",
                x_user_email="new-project-member@example.com",
                x_user_display_name="新项目成员",
                x_project_api_secret=None,
                x_project_id=project_id,
            )["projectId"],
            project_id,
        )

        self.assertTrue(invitation["id"].startswith("invite-"))

    def test_meeting_minutes_contract(self) -> None:
        from backend.app.main import valid_meeting_minutes

        meeting = {
            "minutes": {
                "mode": "线下",
                "notes": "讨论记录",
                "transcript": "录音转写",
                "decisions": "会议决策",
                "actionItems": "负责人｜行动项｜截止时间",
                "followUps": [
                    {
                        "id": "DEC-TEST",
                        "title": "验证决策闭环",
                        "owner": "测试人",
                        "dueDate": "2026-09-13",
                        "linkedType": "WBS任务",
                        "linkedId": "2.2",
                        "status": "执行中",
                        "evidence": "",
                        "history": [],
                    }
                ],
            }
        }
        self.assertTrue(valid_meeting_minutes(meeting))
        self.assertFalse(
            valid_meeting_minutes(
                {"minutes": {**meeting["minutes"], "mode": "电话"}}
            )
        )
        self.assertFalse(valid_meeting_minutes({"minutes": {"mode": "线下"}}))
        invalid_follow_up = {
            "minutes": {
                **meeting["minutes"],
                "followUps": [
                    {**meeting["minutes"]["followUps"][0], "status": "未知"}
                ],
            }
        }
        self.assertFalse(valid_meeting_minutes(invalid_follow_up))

    def test_meeting_decision_follow_up_persists_through_api(self) -> None:
        from backend.app.database import initialize_database
        from backend.app.main import (
            WorkspaceAction,
            get_workspace,
            mutate_workspace,
        )

        meeting = {
            "id": "MEETING-DECISION-TEST",
            "title": "决策闭环接口测试",
            "date": "2026-09-12",
            "time": "17:00",
            "attendees": "测试人",
            "agenda": "验证会议决策状态保存",
            "status": "纪要已归档",
            "minutes": {
                "mode": "线上",
                "notes": "测试记录",
                "transcript": "",
                "decisions": "执行测试行动项",
                "actionItems": "测试人｜验证闭环｜09/12",
                "followUps": [
                    {
                        "id": "DEC-API-TEST",
                        "title": "验证会议决策接口",
                        "owner": "测试人",
                        "dueDate": "2026-09-12",
                        "linkedType": "WBS任务",
                        "linkedId": "2.2",
                        "status": "待验收",
                        "evidence": "接口测试证据",
                        "history": [
                            {
                                "status": "待验收",
                                "at": "09/12 17:00",
                                "note": "提交验收",
                            }
                        ],
                    }
                ],
            },
        }
        initialize_database()
        response = mutate_workspace(
            WorkspaceAction(
                action="update_meeting_minutes", meeting=meeting
            ),
            x_user_id="meeting-tester",
            x_user_email="meeting@example.com",
            x_user_display_name="会议测试人",
            x_project_api_secret=None,
        )
        self.assertTrue(response["ok"])
        snapshot = get_workspace(
            x_user_id="meeting-tester",
            x_user_email="meeting@example.com",
            x_user_display_name="会议测试人",
            x_project_api_secret=None,
        )["snapshot"]
        saved = next(
            item
            for item in snapshot["meetings"]
            if item["id"] == meeting["id"]
        )
        self.assertEqual(
            saved["minutes"]["followUps"][0]["status"], "待验收"
        )

    def test_resource_reallocation_creates_task_and_updates_members(self) -> None:
        from backend.app.database import initialize_database, workspace_snapshot
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        resources = workspace_snapshot()["resources"]
        source = next(item for item in resources if item["name"] == "赵一")
        target = next(item for item in resources if item["name"] == "周琪")
        source = {
            **source,
            "load": 92,
            "available": 20,
            "allocation": {**source["allocation"], "v1.0": 62},
        }
        target = {
            **target,
            "load": 94,
            "available": 14,
            "allocation": {**target["allocation"], "v1.0": 60},
        }
        task = [
            "AI-ALLOC-TEST",
            "兼容性测试资源交接与执行",
            "星云客户平台",
            "v1.0",
            "周琪",
            "未开始",
            "高",
            "09/12",
            "09/15",
            "0%",
            "20h",
            "3.2",
            "中",
        ]
        response = mutate_workspace(
            WorkspaceAction(
                action="apply_resource_reallocation",
                task=task,
                resources=[source, target],
                detail="测试资源调配",
            ),
            x_user_id="resource-tester",
            x_user_email="resource@example.com",
            x_user_display_name="资源测试人",
            x_project_api_secret=None,
        )
        self.assertTrue(response["ok"])
        snapshot = workspace_snapshot()
        self.assertTrue(any(item[0] == task[0] for item in snapshot["tasks"]))
        saved_target = next(
            item for item in snapshot["resources"] if item["name"] == "周琪"
        )
        self.assertEqual(saved_target["load"], 94)
        self.assertEqual(saved_target["allocation"]["v1.0"], 60)

    def test_connector_sandbox_and_automation_rules_persist(self) -> None:
        from backend.app.database import initialize_database, workspace_snapshot
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        identity = {
            "x_user_id": "integration-admin",
            "x_user_email": "integration@example.com",
            "x_user_display_name": "集成管理员",
            "x_project_api_secret": None,
        }
        saved = mutate_workspace(
            WorkspaceAction(
                action="save_connector_config",
                connector="feishu",
                connectorConfig={
                    "mode": "sandbox",
                    "displayName": "飞书沙箱",
                    "baseUrl": "https://open.feishu.cn",
                    "options": {
                        "scope": "demo-tenant",
                        "accessToken": "must-not-persist",
                    },
                },
            ),
            **identity,
        )
        self.assertEqual(saved["status"], "configured")
        tested = mutate_workspace(
            WorkspaceAction(action="test_connector", connector="feishu"),
            **identity,
        )
        self.assertTrue(tested["ok"])
        synced = mutate_workspace(
            WorkspaceAction(action="sync_connector", connector="feishu"),
            **identity,
        )
        self.assertEqual(synced["count"], 8)
        mutate_workspace(
            WorkspaceAction(
                action="update_automation_rule",
                automationRule={
                    "ruleKey": "progress_drift",
                    "enabled": False,
                    "channel": "feishu",
                    "config": {"thresholdPercent": 8},
                },
            ),
            **identity,
        )

        snapshot = workspace_snapshot()
        config = next(
            item
            for item in snapshot["connectorConfigs"]
            if item["connector"] == "feishu"
        )
        self.assertEqual(config["status"], "connected")
        self.assertNotIn("must-not-persist", config["config_json"])
        rule = next(
            item
            for item in snapshot["automationRules"]
            if item["rule_key"] == "progress_drift"
        )
        self.assertEqual(rule["enabled"], 0)
        self.assertEqual(rule["channel"], "feishu")
        self.assertIn('"thresholdPercent": 8', rule["rule_json"])
        self.assertTrue(
            any("未写入真实业务数据" in item["detail"] for item in snapshot["syncEvents"])
        )

    def test_live_connector_does_not_claim_connection_without_adapter(self) -> None:
        from backend.app.database import initialize_database, workspace_snapshot
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        identity = {
            "x_user_id": "integration-admin",
            "x_user_email": "integration@example.com",
            "x_user_display_name": "集成管理员",
            "x_project_api_secret": None,
        }
        mutate_workspace(
            WorkspaceAction(
                action="save_connector_config",
                connector="jira",
                connectorConfig={
                    "mode": "live",
                    "displayName": "正式 Jira",
                    "baseUrl": "https://jira.example.com",
                    "options": {"scope": "NEBULA"},
                },
            ),
            **identity,
        )
        tested = mutate_workspace(
            WorkspaceAction(action="test_connector", connector="jira"),
            **identity,
        )
        self.assertFalse(tested["ok"])
        config = next(
            item
            for item in workspace_snapshot()["connectorConfigs"]
            if item["connector"] == "jira"
        )
        self.assertEqual(config["status"], "error")
        self.assertIn("凭证", config["last_error"])

    def test_inspection_run_finding_lifecycle_and_reopen(self) -> None:
        from backend.app.database import initialize_database, workspace_snapshot
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        identity = {
            "x_user_id": "inspection-admin",
            "x_user_email": "inspection@example.com",
            "x_user_display_name": "巡检管理员",
            "x_project_api_secret": None,
        }
        first = mutate_workspace(
            WorkspaceAction(action="run_ai_inspection"), **identity
        )
        self.assertTrue(first["ok"])
        self.assertGreater(first["total"], 0)
        snapshot = workspace_snapshot()
        finding = next(
            item
            for item in snapshot["inspectionFindings"]
            if item["status"] == "open"
        )

        mutate_workspace(
            WorkspaceAction(
                action="update_inspection_finding",
                finding={
                    "fingerprint": finding["fingerprint"],
                    "status": "acknowledged",
                    "note": "负责人已接手",
                },
            ),
            **identity,
        )
        mutate_workspace(
            WorkspaceAction(
                action="update_inspection_finding",
                finding={
                    "fingerprint": finding["fingerprint"],
                    "status": "resolved",
                    "note": "已完成临时处置并提交证据",
                },
            ),
            **identity,
        )
        resolved = next(
            item
            for item in workspace_snapshot()["inspectionFindings"]
            if item["fingerprint"] == finding["fingerprint"]
        )
        self.assertEqual(resolved["status"], "resolved")
        self.assertEqual(
            resolved["resolution_note"], "已完成临时处置并提交证据"
        )

        mutate_workspace(WorkspaceAction(action="run_ai_inspection"), **identity)
        reopened = next(
            item
            for item in workspace_snapshot()["inspectionFindings"]
            if item["fingerprint"] == finding["fingerprint"]
        )
        self.assertEqual(reopened["status"], "open")
        self.assertIsNone(reopened["resolution_note"])

    def test_resolving_inspection_finding_requires_evidence(self) -> None:
        from fastapi import HTTPException

        from backend.app.database import initialize_database
        from backend.app.main import WorkspaceAction, mutate_workspace

        initialize_database()
        identity = {
            "x_user_id": "inspection-admin",
            "x_user_email": "inspection@example.com",
            "x_user_display_name": "巡检管理员",
            "x_project_api_secret": None,
        }
        result = mutate_workspace(
            WorkspaceAction(action="run_ai_inspection"), **identity
        )
        fingerprint = result["findings"][0]["fingerprint"]
        with self.assertRaises(HTTPException) as context:
            mutate_workspace(
                WorkspaceAction(
                    action="update_inspection_finding",
                    finding={
                        "fingerprint": fingerprint,
                        "status": "resolved",
                        "note": "",
                    },
                ),
                **identity,
            )
        self.assertEqual(context.exception.detail, "resolution_note_required")

    def test_requirement_document_analysis_edit_and_wbs_apply(self) -> None:
        import base64

        from backend.app.database import initialize_database, workspace_snapshot
        from backend.app.main import WorkspaceAction, mutate_workspace

        os.environ["PROJECT_UPLOAD_PATH"] = str(Path(self.temp_dir.name) / "uploads")
        initialize_database()
        identity = {
            "x_user_id": "requirement-admin",
            "x_user_email": "requirement@example.com",
            "x_user_display_name": "需求管理员",
            "x_project_api_secret": None,
        }
        content = """# 会员积分兑换需求
## 功能范围
- 用户可以用积分兑换优惠券
- 第三方券码失败时自动返还积分
## 验收标准
1. 支持库存并发扣减
2. 待确认：失败重试次数
""".encode()
        analyzed = mutate_workspace(
            WorkspaceAction(
                action="analyze_requirement_document",
                requirementDocument={
                    "fileName": "积分兑换需求.md",
                    "contentBase64": base64.b64encode(content).decode(),
                    "versionId": "v1.1",
                    "deliveryMode": "agile",
                },
            ),
            **identity,
        )
        self.assertTrue(analyzed["ok"])
        self.assertEqual(len(analyzed["draft"]["tasks"]), 5)
        self.assertEqual(analyzed["draft"]["aiProvider"], "local")
        self.assertEqual(analyzed["draft"]["aiFallbackReason"], "ai_disabled")
        self.assertIn("失败重试次数", analyzed["draft"]["clarifications"][0])
        self.assertTrue(analyzed["document"]["summary"]["textExtracted"])
        draft = analyzed["draft"]
        draft["tasks"][0]["name"] = "人工确认后的需求澄清"
        mutate_workspace(
            WorkspaceAction(
                action="update_requirement_draft",
                requirementDraft={"id": draft["id"], "tasks": draft["tasks"]},
            ),
            **identity,
        )
        applied = mutate_workspace(
            WorkspaceAction(
                action="apply_requirement_draft",
                versionId="v1.1",
                requirementDraft={"id": draft["id"]},
            ),
            **identity,
        )
        self.assertEqual(len(applied["tasks"]), 6)
        self.assertEqual(applied["tasks"][1][1], "人工确认后的需求澄清")
        snapshot = workspace_snapshot()
        self.assertTrue(
            any(task[0] == applied["tasks"][0][0] for task in snapshot["tasks"])
        )
        self.assertEqual(len(snapshot["requirementDocuments"]), 1)
        self.assertEqual(snapshot["requirementDrafts"][0]["status"], "applied")
        self.assertEqual(len(snapshot["requirementTaskLinks"]), 6)

    def test_requirement_schedule_excludes_china_holidays(self) -> None:
        from backend.app.requirement_parser import add_workdays, is_workday

        from datetime import date

        self.assertFalse(is_workday(date(2026, 9, 25)))
        self.assertTrue(is_workday(date(2026, 9, 20)))
        self.assertEqual(add_workdays(date(2026, 9, 24), 2), date(2026, 9, 28))

    def test_requirement_parser_extracts_docx_and_xmind(self) -> None:
        import io
        import zipfile

        from backend.app.requirement_parser import extract_text

        docx = io.BytesIO()
        with zipfile.ZipFile(docx, "w") as archive:
            archive.writestr(
                "word/document.xml",
                "<document><body><p><t>订单退款需求</t></p><p><t>支持原路退回</t></p></body></document>",
            )
        self.assertIn("支持原路退回", extract_text("退款.docx", ".docx", docx.getvalue()))

        xmind = io.BytesIO()
        with zipfile.ZipFile(xmind, "w") as archive:
            archive.writestr(
                "content.json",
                '[{"rootTopic":{"title":"营销活动","children":{"attached":[{"title":"优惠券发放"}]}}}]',
            )
        self.assertIn("优惠券发放", extract_text("营销.xmind", ".xmind", xmind.getvalue()))

    def test_openai_requirement_analysis_uses_structured_file_input(self) -> None:
        import io
        import json
        from unittest.mock import patch

        from backend.app.ai_requirements import analyze_requirement_with_openai
        from backend.app.requirement_parser import merge_ai_requirement_draft

        os.environ["PROJECT_AI_REQUIREMENTS_ENABLED"] = "true"
        os.environ["OPENAI_API_KEY"] = "test-key"
        os.environ["PROJECT_AI_MODEL"] = "test-model"
        analysis = {
            "topic": "扫码退款",
            "featureCount": 2,
            "clarifications": ["退款时限待确认"],
            "risks": ["支付回调可能重复"],
            "assumptions": ["沿用现有支付网关"],
            "confidence": 0.86,
            "tasks": [
                {
                    "sequence": 1,
                    "name": "退款规则澄清",
                    "type": "需求澄清",
                    "stage": "Sprint 1",
                    "owner": "林夏",
                    "estimateHours": 8,
                    "dependencySequences": [],
                    "acceptance": "退款范围和时限确认",
                },
                {
                    "sequence": 2,
                    "name": "退款接口实现",
                    "type": "后端开发",
                    "stage": "Sprint 1",
                    "owner": "不存在的成员",
                    "estimateHours": 16,
                    "dependencySequences": [1, 99],
                    "acceptance": "幂等测试通过",
                },
            ],
        }
        api_payload = {
            "id": "resp_test",
            "model": "test-model",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(analysis)}],
                }
            ],
        }
        resources = [
            {"name": "林夏", "role": "产品经理", "skills": ["需求"]},
            {"name": "陈默", "role": "后端工程师", "skills": ["后端"]},
        ]
        response = io.BytesIO(json.dumps(api_payload).encode())
        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            result = analyze_requirement_with_openai(
                file_name="退款.pdf",
                suffix=".pdf",
                content=b"%PDF-test",
                extracted_text="",
                version_id="v1.1",
                delivery_mode="agile",
                resources=resources,
                actor_id="private-user-id",
            )
        self.assertEqual(result.provider, "openai")
        self.assertEqual(result.response_id, "resp_test")
        request_body = json.loads(urlopen.call_args.args[0].data)
        self.assertFalse(request_body["store"])
        self.assertEqual(request_body["input"][0]["content"][0]["type"], "input_file")
        self.assertEqual(request_body["input"][0]["content"][0]["detail"], "auto")
        self.assertTrue(request_body["text"]["format"]["strict"])
        self.assertNotEqual(request_body["safety_identifier"], "private-user-id")

        merged = merge_ai_requirement_draft(
            fallback={"topic": "fallback", "versionId": "v1.1", "deliveryMode": "agile"},
            analysis=result.analysis or {},
            resources=resources,
            model=result.model or "",
            response_id=result.response_id,
            elapsed_ms=result.elapsed_ms,
        )
        self.assertEqual(merged["parserMode"], "openai-structured-output")
        self.assertEqual(merged["tasks"][1]["owner"], "陈默")
        self.assertEqual(merged["tasks"][1]["dependencySequences"], [1])

    def test_github_connector_matches_wbs_references(self) -> None:
        from datetime import datetime, timezone
        from unittest.mock import patch

        from backend.app.github_connector import (
            sync_github_evidence,
            test_github_connection as verify_github_connection,
        )

        repository_payload = {
            "full_name": "acme/flowpilot",
            "default_branch": "main",
            "private": True,
            "html_url": "https://github.com/acme/flowpilot",
        }
        commits_payload = [
            {
                "sha": "abc123",
                "html_url": "https://github.com/acme/flowpilot/commit/abc123",
                "commit": {
                    "message": "feat: finish 2.2 payment adapter",
                    "author": {"name": "Dev", "date": "2026-09-20T10:00:00Z"},
                },
                "author": {"login": "dev-user"},
            }
        ]
        current_time = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        pulls_payload = [
            {
                "number": 18,
                "title": "Deliver CR-018-W2 integration",
                "body": "Closes CR-018-W2",
                "state": "closed",
                "merged_at": current_time,
                "updated_at": current_time,
                "html_url": "https://github.com/acme/flowpilot/pull/18",
                "user": {"login": "dev-user"},
                "base": {"ref": "main"},
                "head": {"ref": "feature/cr-018"},
            }
        ]
        with patch(
            "backend.app.github_connector._request_json",
            side_effect=[repository_payload, commits_payload, pulls_payload],
        ):
            connection = verify_github_connection(
                base_url="https://github.com",
                scope="acme/flowpilot",
                token="secret",
            )
            result = sync_github_evidence(
                base_url="https://github.com",
                scope="acme/flowpilot",
                token="secret",
                task_ids=["2.2", "CR-018-W2", "2"],
                lookback_days=30,
            )
        self.assertEqual(connection["scope"], "acme/flowpilot")
        self.assertEqual(result["linked"], 2)
        self.assertEqual(result["evidence"][0]["taskIds"], ["2.2"])
        self.assertEqual(result["evidence"][1]["taskIds"], ["CR-018-W2"])
        self.assertEqual(result["evidence"][1]["state"], "merged")

    def test_github_evidence_enters_inspection_loop(self) -> None:
        from backend.app.database import (
            initialize_database,
            replace_connector_evidence,
            run_project_inspection,
            workspace_snapshot,
        )

        initialize_database()
        stored = replace_connector_evidence(
            project_id="nebula-customer-platform",
            connector="git",
            evidence=[
                {
                    "externalId": "pull_request:88",
                    "evidenceType": "pull_request",
                    "taskIds": ["2.2"],
                    "title": "#88 完成支付联调 2.2",
                    "url": "https://github.com/acme/repo/pull/88",
                    "state": "merged",
                    "author": "dev-user",
                    "occurredAt": "2026-09-20T12:00:00Z",
                    "payload": {"number": 88},
                }
            ],
        )
        result = run_project_inspection(
            project_id="nebula-customer-platform",
            trigger_type="manual",
            actor_id="tester",
        )
        snapshot = workspace_snapshot()
        self.assertEqual(stored, 1)
        self.assertTrue(
            any(
                item["fingerprint"] == "git_progress_mismatch:2.2"
                for item in result["findings"]
            )
        )
        self.assertTrue(
            any(
                item["external_id"] == "pull_request:88"
                and item["task_id"] == "2.2"
                for item in snapshot["externalWorkEvidence"]
            )
        )


if __name__ == "__main__":
    unittest.main()
