from __future__ import annotations

import json
import os
import re
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.client import IncompleteRead
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


class GitHubConnectorError(RuntimeError):
    pass


@dataclass(frozen=True)
class GitHubRepository:
    scope: str
    api_base_url: str


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


def _repository(scope: str, base_url: str) -> GitHubRepository:
    normalized_scope = scope.strip().strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", normalized_scope):
        raise GitHubConnectorError("Git 仓库必须使用 owner/repository 格式")
    parsed = urlparse(base_url.strip() or "https://github.com")
    if parsed.scheme != "https" or not parsed.hostname:
        raise GitHubConnectorError("Git 服务地址必须是 HTTPS 地址")
    hostname = parsed.hostname.lower()
    allowed = {"github.com", "api.github.com"}
    allowed.update(
        host.strip().lower()
        for host in os.getenv("GITHUB_ALLOWED_HOSTS", "").split(",")
        if host.strip()
    )
    if hostname not in allowed:
        raise GitHubConnectorError("Git 服务域名未加入 GITHUB_ALLOWED_HOSTS")
    if hostname in {"github.com", "api.github.com"}:
        api_base_url = "https://api.github.com"
    else:
        api_base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/api/v3"
    return GitHubRepository(normalized_scope, api_base_url)


def _request_json(
    repository: GitHubRepository,
    path: str,
    token: str,
    query: dict[str, str] | None = None,
) -> Any:
    url = f"{repository.api_base_url}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "FlowPilot-GitHub-Connector/0.3",
        "X-GitHub-Api-Version": os.getenv("GITHUB_API_VERSION", "2026-03-10"),
    }
    if token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"
    request = Request(url, headers=headers)
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20, context=_tls_context()) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            message = f"GitHub API 返回 HTTP {error.code}"
            try:
                payload = json.loads(error.read().decode("utf-8"))
                if isinstance(payload.get("message"), str):
                    message = f"{message}：{payload['message'][:180]}"
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                pass
            if error.code == 403 and not token.strip():
                message = f"{message}；公共免 Token 额度可能已用尽，可配置只读 GIT_ACCESS_TOKEN 后重试"
            raise GitHubConnectorError(message) from error
        except (URLError, TimeoutError, IncompleteRead, ConnectionError) as error:
            if attempt == 2:
                raise GitHubConnectorError(
                    "无法连接 GitHub API，请检查网络与服务地址"
                ) from error
            time.sleep(0.2 * (attempt + 1))
        except json.JSONDecodeError as error:
            raise GitHubConnectorError("GitHub API 返回了无法解析的数据") from error
    raise GitHubConnectorError("无法连接 GitHub API，请检查网络与服务地址")


def test_github_connection(
    *, base_url: str, scope: str, token: str
) -> dict[str, Any]:
    repository = _repository(scope, base_url)
    encoded_scope = "/".join(quote(part, safe="") for part in repository.scope.split("/"))
    payload = _request_json(repository, f"/repos/{encoded_scope}", token)
    if not isinstance(payload, dict) or not payload.get("full_name"):
        raise GitHubConnectorError("GitHub 仓库响应缺少必要字段")
    return {
        "scope": str(payload["full_name"]),
        "defaultBranch": str(payload.get("default_branch", "main")),
        "private": bool(payload.get("private")),
        "url": str(payload.get("html_url", "")),
    }


def _task_references(text: str, task_ids: list[str]) -> list[str]:
    lowered = text.casefold()
    matches: list[str] = []
    for task_id in task_ids:
        normalized = task_id.strip()
        if not normalized:
            continue
        pattern = rf"(?<![A-Za-z0-9_.-]){re.escape(normalized.casefold())}(?![A-Za-z0-9_.-])"
        if re.search(pattern, lowered):
            matches.append(normalized)
    return matches


def sync_github_evidence(
    *,
    base_url: str,
    scope: str,
    token: str,
    task_ids: list[str],
    lookback_days: int = 30,
) -> dict[str, Any]:
    repository = _repository(scope, base_url)
    encoded_scope = "/".join(quote(part, safe="") for part in repository.scope.split("/"))
    lookback = max(1, min(int(lookback_days), 90))
    since = (datetime.now(timezone.utc) - timedelta(days=lookback)).replace(
        microsecond=0
    )
    commits = _request_json(
        repository,
        f"/repos/{encoded_scope}/commits",
        token,
        {"per_page": "100", "since": since.isoformat().replace("+00:00", "Z")},
    )
    pulls = _request_json(
        repository,
        f"/repos/{encoded_scope}/pulls",
        token,
        {
            "state": "all",
            "sort": "updated",
            "direction": "desc",
            "per_page": "100",
        },
    )
    if not isinstance(commits, list) or not isinstance(pulls, list):
        raise GitHubConnectorError("GitHub 同步响应格式异常")

    evidence: list[dict[str, Any]] = []
    for item in commits:
        commit = item.get("commit") if isinstance(item, dict) else None
        message = str(commit.get("message", "")) if isinstance(commit, dict) else ""
        author_block = commit.get("author") if isinstance(commit, dict) else None
        occurred_at = (
            str(author_block.get("date", ""))
            if isinstance(author_block, dict)
            else ""
        )
        author = item.get("author") if isinstance(item, dict) else None
        evidence.append(
            {
                "externalId": f"commit:{item.get('sha', '')}",
                "evidenceType": "commit",
                "taskIds": _task_references(message, task_ids),
                "title": message.splitlines()[0][:240] or "未命名提交",
                "url": str(item.get("html_url", "")),
                "state": "committed",
                "author": str(author.get("login", ""))
                if isinstance(author, dict)
                else str(author_block.get("name", ""))
                if isinstance(author_block, dict)
                else "",
                "occurredAt": occurred_at,
                "payload": {"sha": str(item.get("sha", ""))[:12]},
            }
        )

    for item in pulls:
        if not isinstance(item, dict):
            continue
        updated_at = str(item.get("updated_at") or "")
        try:
            if updated_at and datetime.fromisoformat(
                updated_at.replace("Z", "+00:00")
            ) < since:
                continue
        except ValueError:
            pass
        title = str(item.get("title", ""))
        body = str(item.get("body") or "")
        merged_at = item.get("merged_at")
        state = "merged" if merged_at else "draft" if item.get("draft") else str(item.get("state", ""))
        user = item.get("user")
        evidence.append(
            {
                "externalId": f"pull_request:{item.get('number', '')}",
                "evidenceType": "pull_request",
                "taskIds": _task_references(f"{title}\n{body}", task_ids),
                "title": f"#{item.get('number', '')} {title}"[:240],
                "url": str(item.get("html_url", "")),
                "state": state,
                "author": str(user.get("login", "")) if isinstance(user, dict) else "",
                "occurredAt": str(merged_at or updated_at),
                "payload": {
                    "number": item.get("number"),
                    "base": str((item.get("base") or {}).get("ref", "")),
                    "head": str((item.get("head") or {}).get("ref", "")),
                },
            }
        )

    linked = sum(1 for item in evidence if item["taskIds"])
    return {
        "repository": repository.scope,
        "evidence": evidence,
        "commits": len(commits),
        "pullRequests": len(pulls),
        "linked": linked,
        "unlinked": len(evidence) - linked,
        "lookbackDays": lookback,
    }
