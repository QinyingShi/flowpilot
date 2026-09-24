from __future__ import annotations

import base64
import json
import os
import re
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.client import IncompleteRead
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


class JiraConnectorError(RuntimeError):
    pass


@dataclass(frozen=True)
class JiraSite:
    base_url: str


def _tls_context() -> ssl.SSLContext:
    candidates = [
        os.getenv("SSL_CERT_FILE", ""),
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return ssl.create_default_context(cafile=candidate)
    return ssl.create_default_context()


def _site(base_url: str) -> JiraSite:
    parsed = urlparse(base_url.strip())
    if parsed.scheme != "https" or not parsed.hostname:
        raise JiraConnectorError("Jira 服务地址必须是 HTTPS 地址")
    hostname = parsed.hostname.lower()
    allowed_hosts = {
        host.strip().lower()
        for host in os.getenv("JIRA_ALLOWED_HOSTS", "").split(",")
        if host.strip()
    }
    if not hostname.endswith(".atlassian.net") and hostname not in allowed_hosts:
        raise JiraConnectorError(
            "Jira 域名未获允许；Atlassian Cloud 可直接使用，自建域名请配置 JIRA_ALLOWED_HOSTS"
        )
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise JiraConnectorError("Jira 服务地址只填写站点根地址")
    return JiraSite(f"https://{parsed.netloc}")


def _request_json(
    site: JiraSite,
    path: str,
    *,
    email: str,
    token: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    if not email.strip() or not token.strip():
        raise JiraConnectorError("服务端缺少 JIRA_EMAIL 或 JIRA_API_TOKEN")
    credentials = base64.b64encode(
        f"{email.strip()}:{token.strip()}".encode("utf-8")
    ).decode("ascii")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{site.base_url}{path}",
        data=body,
        method="POST" if payload is not None else "GET",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Basic {credentials}",
            "User-Agent": "FlowPilot-Jira-Connector/0.1",
        },
    )
    for attempt in range(3):
        try:
            with urlopen(request, timeout=25, context=_tls_context()) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            message = f"Jira API 返回 HTTP {error.code}"
            try:
                error_payload = json.loads(error.read().decode("utf-8"))
                details = error_payload.get("errorMessages") or error_payload.get(
                    "errors"
                )
                if details:
                    message = f"{message}：{str(details)[:220]}"
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                pass
            raise JiraConnectorError(message) from error
        except (URLError, TimeoutError, IncompleteRead, ConnectionError) as error:
            if attempt == 2:
                raise JiraConnectorError("无法连接 Jira API，请检查网络与站点地址") from error
            time.sleep(0.2 * (attempt + 1))
        except json.JSONDecodeError as error:
            raise JiraConnectorError("Jira API 返回了无法解析的数据") from error
    raise JiraConnectorError("无法连接 Jira API，请检查网络与站点地址")


def test_jira_connection(
    *, base_url: str, project_key: str, email: str, token: str
) -> dict[str, Any]:
    site = _site(base_url)
    normalized_key = project_key.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,31}", normalized_key):
        raise JiraConnectorError("Jira 项目代码格式不正确")
    payload = _request_json(
        site,
        f"/rest/api/3/project/{quote(normalized_key, safe='')}",
        email=email,
        token=token,
    )
    if not isinstance(payload, dict) or not payload.get("key"):
        raise JiraConnectorError("Jira 项目响应缺少必要字段")
    return {
        "key": str(payload["key"]),
        "name": str(payload.get("name", payload["key"])),
        "url": f"{site.base_url}/browse/{quote(normalized_key, safe='')}",
    }


def _document_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(_document_text(item) for item in value)
    if isinstance(value, dict):
        parts = [str(value.get("text", ""))]
        parts.extend(_document_text(item) for item in value.get("content", []))
        return " ".join(part for part in parts if part)
    return ""


def _references(text: str, candidates: list[str]) -> list[str]:
    lowered = text.casefold()
    return [
        candidate
        for candidate in candidates
        if re.search(
            rf"(?<![A-Za-z0-9_.-]){re.escape(candidate.casefold())}(?![A-Za-z0-9_.-])",
            lowered,
        )
    ]


def _severity(fields: dict[str, Any]) -> str:
    labels = {str(label).upper() for label in fields.get("labels") or []}
    for severity in ("P0", "P1", "P2", "P3"):
        if severity in labels:
            return severity
    priority = str((fields.get("priority") or {}).get("name", "")).casefold()
    if priority in {"highest", "blocker"}:
        return "P0"
    if priority in {"high", "critical", "major"}:
        return "P1"
    if priority in {"medium", "normal"}:
        return "P2"
    return "P3"


def _status_category(fields: dict[str, Any]) -> str:
    category = str(
        ((fields.get("status") or {}).get("statusCategory") or {}).get("key", "")
    ).casefold()
    if category == "done":
        return "done"
    if category == "indeterminate":
        return "in_progress"
    return "todo"


def _reopen_count(issue: dict[str, Any]) -> int:
    closed_names = {"done", "resolved", "closed", "已完成", "已解决", "已关闭"}
    reopened = 0
    histories = ((issue.get("changelog") or {}).get("histories") or [])
    for history in histories:
        for item in history.get("items") or []:
            if str(item.get("field", "")).casefold() != "status":
                continue
            before = str(item.get("fromString", "")).casefold()
            after = str(item.get("toString", "")).casefold()
            if before in closed_names and after not in closed_names:
                reopened += 1
    return reopened


def _version_id(fields: dict[str, Any], version_ids: list[str], text: str) -> str | None:
    names = [str(item.get("name", "")) for item in fields.get("fixVersions") or []]
    haystack = " ".join([*names, text]).casefold()
    return next(
        (version_id for version_id in version_ids if version_id.casefold() in haystack),
        None,
    )


def sync_jira_quality(
    *,
    base_url: str,
    project_key: str,
    email: str,
    token: str,
    task_ids: list[str],
    version_ids: list[str],
    lookback_days: int = 90,
) -> dict[str, Any]:
    site = _site(base_url)
    normalized_key = project_key.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,31}", normalized_key):
        raise JiraConnectorError("Jira 项目代码格式不正确")
    lookback = max(1, min(int(lookback_days), 365))
    request_payload: dict[str, Any] = {
        "jql": (
            f'project = "{normalized_key}" AND issuetype = Bug '
            f"AND (resolution IS EMPTY OR updated >= -{lookback}d) "
            "ORDER BY updated DESC"
        ),
        "fields": [
            "summary",
            "description",
            "status",
            "priority",
            "labels",
            "assignee",
            "fixVersions",
            "created",
            "updated",
            "resolutiondate",
            "duedate",
        ],
        "expand": "changelog",
        "maxResults": 100,
    }
    issues_payload: list[Any] = []
    for _ in range(10):
        response = _request_json(
            site,
            "/rest/api/3/search/jql",
            email=email,
            token=token,
            payload=request_payload,
        )
        page = response.get("issues") if isinstance(response, dict) else None
        if not isinstance(page, list):
            raise JiraConnectorError("Jira 缺陷搜索响应格式异常")
        issues_payload.extend(page)
        next_page_token = (
            str(response.get("nextPageToken", "")).strip()
            if isinstance(response, dict)
            else ""
        )
        if not next_page_token:
            break
        request_payload = {**request_payload, "nextPageToken": next_page_token}
    else:
        raise JiraConnectorError("Jira 缺陷超过 1000 条，请缩小同步范围")
    issues: list[dict[str, Any]] = []
    for item in issues_payload:
        if not isinstance(item, dict):
            continue
        fields = item.get("fields") if isinstance(item.get("fields"), dict) else {}
        key = str(item.get("key", ""))
        summary = str(fields.get("summary", ""))
        description = _document_text(fields.get("description"))
        reference_text = f"{summary}\n{description}"
        task_matches = _references(reference_text, task_ids)
        names = [
            str(version.get("name", ""))
            for version in fields.get("fixVersions") or []
            if isinstance(version, dict)
        ]
        assignee = fields.get("assignee")
        issues.append(
            {
                "externalId": f"issue:{key}",
                "issueKey": key,
                "summary": summary,
                "severity": _severity(fields),
                "status": str((fields.get("status") or {}).get("name", "")),
                "statusCategory": _status_category(fields),
                "assignee": str(
                    (assignee or {}).get("displayName")
                    or (assignee or {}).get("accountId")
                    or ""
                ),
                "versionId": _version_id(
                    fields, version_ids, reference_text
                ),
                "taskId": task_matches[0] if task_matches else None,
                "reopenCount": _reopen_count(item),
                "dueDate": fields.get("duedate"),
                "createdAt": str(fields.get("created", "")),
                "updatedAt": str(fields.get("updated", "")),
                "resolvedAt": fields.get("resolutiondate"),
                "url": f"{site.base_url}/browse/{quote(key, safe='-')}",
                "payload": {
                    "fixVersions": [name for name in names if name],
                    "matchedTaskIds": task_matches,
                },
            }
        )
    return {
        "projectKey": normalized_key,
        "issues": issues,
        "total": len(issues),
        "open": sum(1 for item in issues if item["statusCategory"] != "done"),
        "p0": sum(
            1
            for item in issues
            if item["statusCategory"] != "done" and item["severity"] == "P0"
        ),
        "p1": sum(
            1
            for item in issues
            if item["statusCategory"] != "done" and item["severity"] == "P1"
        ),
        "lookbackDays": lookback,
    }


def demo_jira_quality_issues() -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    rows = [
        ("NEBULA-231", "支付回调重复触发导致订单状态反复", "P0", "处理中", "in_progress", "v1.0", "2.2", 1, "赵一"),
        ("NEBULA-228", "收银台优惠金额与订单金额不一致", "P1", "待修复", "todo", "v1.0", "2.4", 0, "陈默"),
        ("NEBULA-225", "弱网下支付结果页长时间停留", "P1", "回归中", "in_progress", "v1.0", "3.2", 1, "周琪"),
        ("NEBULA-219", "数据看板筛选条件切换后指标闪烁", "P2", "已解决", "done", "v1.0", "3.5", 0, "顾言"),
        ("NEBULA-214", "会员等级权益规则未即时刷新", "P1", "处理中", "in_progress", "v1.1", "CR-018-W2", 0, "韩策"),
        ("NEBULA-209", "营销触达名单重复生成", "P2", "待修复", "todo", "v1.1", "4.2", 1, "方宁"),
        ("NEBULA-198", "Alpha 订单导出字段缺失", "P2", "已关闭", "done", "v0.9", "1.1", 0, "王琼"),
        ("NEBULA-191", "旧版会员数据迁移后标签丢失", "P3", "已关闭", "done", "v0.9", None, 0, "韩森"),
    ]
    return [
        {
            "externalId": f"issue:{key}",
            "issueKey": key,
            "summary": summary,
            "severity": severity,
            "status": status,
            "statusCategory": status_category,
            "assignee": assignee,
            "versionId": version_id,
            "taskId": task_id,
            "reopenCount": reopen_count,
            "dueDate": None,
            "createdAt": now,
            "updatedAt": now,
            "resolvedAt": now if status_category == "done" else None,
            "url": "",
            "payload": {"sandbox": True},
        }
        for (
            key,
            summary,
            severity,
            status,
            status_category,
            version_id,
            task_id,
            reopen_count,
            assignee,
        ) in rows
    ]
