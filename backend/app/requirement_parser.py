from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import re
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zoneinfo import ZoneInfo


ALLOWED_EXTENSIONS = {
    ".docx",
    ".doc",
    ".rtf",
    ".odt",
    ".pdf",
    ".md",
    ".txt",
    ".csv",
    ".tsv",
    ".xlsx",
    ".xls",
    ".pptx",
    ".ppt",
    ".xmind",
    ".rp",
    ".rplib",
    ".zip",
}
MAX_FILE_SIZE = 50 * 1024 * 1024
SHANGHAI_TIMEZONE = ZoneInfo("Asia/Shanghai")
CHINA_HOLIDAYS_2026 = {
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-02-15",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-02-19",
    "2026-02-20",
    "2026-02-21",
    "2026-02-22",
    "2026-02-23",
    "2026-04-04",
    "2026-04-05",
    "2026-04-06",
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
    "2026-05-05",
    "2026-06-19",
    "2026-06-20",
    "2026-06-21",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
}
CHINA_MAKEUP_WORKDAYS_2026 = {
    "2026-01-04",
    "2026-02-14",
    "2026-02-28",
    "2026-05-09",
    "2026-09-20",
    "2026-10-10",
}


def decode_document(file_name: str, content_base64: str) -> tuple[bytes, str]:
    suffix = Path(file_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("unsupported_requirement_file")
    try:
        content = base64.b64decode(content_base64, validate=True)
    except ValueError as error:
        raise ValueError("invalid_requirement_file") from error
    if not content or len(content) > MAX_FILE_SIZE:
        raise ValueError("invalid_requirement_file_size")
    return content, suffix


def safe_file_name(file_name: str) -> str:
    name = Path(file_name).name
    return re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", name)[:180]


def document_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _xml_text(content: bytes) -> str:
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return ""
    values = [text.strip() for text in root.itertext() if text.strip()]
    return "\n".join(values)


def _zip_text(content: bytes, suffix: str) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = archive.namelist()[:2000]
        preferred = []
        if suffix == ".docx":
            preferred = [name for name in names if name == "word/document.xml"]
        elif suffix == ".pptx":
            preferred = [name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
        elif suffix == ".xlsx":
            preferred = [name for name in names if name == "xl/sharedStrings.xml"]
        elif suffix == ".xmind":
            preferred = [name for name in names if name in {"content.json", "content.xml"}]
        else:
            preferred = [
                name
                for name in names
                if Path(name).suffix.lower() in {".xml", ".json", ".txt", ".md", ".html", ".htm"}
            ][:100]
        for name in preferred:
            raw = archive.read(name)
            if name.endswith(".json"):
                try:
                    value = json.loads(raw.decode("utf-8", errors="ignore"))
                    chunks.append(json.dumps(value, ensure_ascii=False))
                except json.JSONDecodeError:
                    continue
            elif name.endswith((".xml", ".html", ".htm")):
                chunks.append(_xml_text(raw))
            else:
                chunks.append(raw.decode("utf-8", errors="ignore"))
    return "\n".join(chunk for chunk in chunks if chunk)


def _pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]

        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages[:200])
    except Exception:
        # Requirement files are untrusted input. A malformed or encrypted PDF
        # should fall back to metadata-based analysis instead of failing the
        # entire upload request.
        return ""


def extract_text(file_name: str, suffix: str, content: bytes) -> str:
    if suffix in {".txt", ".md", ".csv", ".tsv"}:
        text = content.decode("utf-8", errors="ignore")
    elif suffix == ".rtf":
        text = content.decode("utf-8", errors="ignore")
        text = re.sub(r"\\'[0-9a-fA-F]{2}", " ", text)
        text = re.sub(r"\\[a-zA-Z]+-?\d* ?", " ", text)
        text = text.replace("{", " ").replace("}", " ")
    elif suffix == ".pdf":
        text = _pdf_text(content)
    elif zipfile.is_zipfile(io.BytesIO(content)):
        text = _zip_text(content, suffix)
    else:
        text = ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:300_000]


def is_workday(value: date) -> bool:
    iso = value.isoformat()
    if iso in CHINA_MAKEUP_WORKDAYS_2026:
        return True
    return value.weekday() < 5 and iso not in CHINA_HOLIDAYS_2026


def next_workday(value: date) -> date:
    current = value
    while not is_workday(current):
        current += timedelta(days=1)
    return current


def add_workdays(value: date, workdays: int) -> date:
    current = next_workday(value)
    remaining = max(0, workdays - 1)
    while remaining:
        current += timedelta(days=1)
        if is_workday(current):
            remaining -= 1
    return current


def shanghai_today() -> date:
    return datetime.now(SHANGHAI_TIMEZONE).date()


def _topic(file_name: str, text: str) -> str:
    candidates = [
        line.strip("#*-• 0123456789.、")
        for line in text.splitlines()
        if 4 <= len(line.strip()) <= 50
    ]
    for line in candidates:
        if any(word in line for word in ("需求", "功能", "方案", "项目", "用户故事")):
            return re.sub(r"(需求说明|需求文档|产品需求|PRD)$", "", line).strip()[:28]
    stem = Path(file_name).stem
    return re.sub(r"[_\-]?[vV]?\d+(\.\d+)*$", "", stem).strip()[:28] or "新增需求"


def _owners(resources: list[dict[str, Any]]) -> dict[str, str]:
    active = [item for item in resources if item.get("memberStatus") not in {"离职待交接", "已离职"}]

    def pick(keywords: tuple[str, ...], fallback: str) -> str:
        for item in active:
            haystack = " ".join(
                [str(item.get("role", "")), *item.get("skills", []), *item.get("domains", [])]
            )
            if any(keyword in haystack for keyword in keywords):
                return str(item.get("name", fallback))
        return fallback

    return {
        "product": pick(("产品", "需求"), "林夏"),
        "backend": pick(("后端", "Java", "Go"), "陈默"),
        "frontend": pick(("前端", "React", "Vue"), "顾言"),
        "test": pick(("测试", "QA", "自动化"), "赵一"),
    }


def build_requirement_draft(
    *,
    file_name: str,
    text: str,
    version_id: str,
    delivery_mode: str,
    resources: list[dict[str, Any]],
) -> dict[str, Any]:
    if delivery_mode not in {"agile", "waterfall"}:
        raise ValueError("invalid_delivery_mode")
    topic = _topic(file_name, text)
    owners = _owners(resources)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    features = [line for line in lines if re.match(r"^(#{1,4}|\d+[.、]|[-*•])", line)]
    clarifications = [
        re.sub(r"^(#{1,4}|\d+[.、]|[-*•])\s*", "", line)[:120]
        for line in lines
        if any(marker in line.lower() for marker in ("待确认", "待定", "todo", "tbd", "?", "？"))
    ][:8]
    if not clarifications:
        clarifications = ["异常场景的重试上限与人工兜底规则需在开发前确认"]
    risk_keywords = [word for word in ("支付", "库存", "第三方", "权限", "并发", "迁移") if word in text]
    risks = [f"涉及{word}，需补充边界、失败补偿和验收证据" for word in risk_keywords[:4]]
    if not risks:
        risks = ["原文未明确非功能指标，需补充性能、安全与兼容性要求"]

    start = next_workday(shanghai_today() + timedelta(days=1))
    if delivery_mode == "agile":
        specs = [
            (f"{topic} · 需求澄清与验收口径", "需求澄清", owners["product"], 2, "—", "范围、业务规则、异常场景和验收标准完成确认"),
            (f"{topic} · 后端服务与接口", "后端开发", owners["backend"], 4, "1", "接口契约、单元测试和失败补偿逻辑通过评审"),
            (f"{topic} · 前端页面与交互", "前端开发", owners["frontend"], 4, "1", "主流程、空态、异常态及权限控制通过验收"),
            (f"{topic} · 前后端联合联调", "联合联调", f"{owners['backend']}、{owners['frontend']}、{owners['test']}", 3, "2、3", "主链路和异常链路联调通过，无阻断缺陷"),
            (f"{topic} · 功能测试与版本回归", "测试验收", owners["test"], 3, "4", "验收用例通过，P0/P1 缺陷清零并纳入版本回归"),
        ]
        windows = [(start, 2), (add_workdays(start, 3), 4), (add_workdays(start, 3), 4), (add_workdays(start, 7), 3), (add_workdays(start, 10), 3)]
    else:
        specs = [
            (f"{topic} · 需求分析与范围冻结", "需求分析", owners["product"], 2, "—", "需求规格、边界和验收口径完成签字确认"),
            (f"{topic} · 总体与详细设计", "方案设计", f"{owners['backend']}、{owners['frontend']}", 3, "1", "架构、接口、数据和交互设计通过评审"),
            (f"{topic} · 前后端开发实现", "开发实现", f"{owners['backend']}、{owners['frontend']}", 5, "2", "编码、代码评审、单元测试和自测完成"),
            (f"{topic} · 系统联合联调", "联合联调", f"{owners['backend']}、{owners['frontend']}、{owners['test']}", 3, "3", "接口契约、主链路和异常补偿链路全部通过"),
            (f"{topic} · 系统测试", "系统测试", owners["test"], 4, "4", "系统测试报告完成且 P0/P1 缺陷清零"),
            (f"{topic} · 业务验收", "业务验收", f"{owners['product']}、{owners['test']}", 2, "5", "业务验收结论归档并满足发布门禁"),
        ]
        windows = []
        cursor = start
        for spec in specs:
            windows.append((cursor, spec[3]))
            cursor = next_workday(add_workdays(cursor, spec[3]) + timedelta(days=1))

    tasks = []
    for index, (spec, window) in enumerate(zip(specs, windows), start=1):
        name, work_type, owner, days, dependency, acceptance = spec
        task_start, duration = window
        tasks.append(
            {
                "sequence": index,
                "name": name,
                "type": work_type,
                "stage": f"Sprint {1 if index <= 3 else 2}" if delivery_mode == "agile" else f"阶段 {index}",
                "owner": owner,
                "estimateHours": days * 8,
                "dependencySequences": [] if dependency == "—" else [int(value) for value in dependency.split("、")],
                "acceptance": acceptance,
                "start": task_start.strftime("%m/%d"),
                "end": add_workdays(task_start, duration).strftime("%m/%d"),
            }
        )
    excerpt = "\n".join(lines[:20])[:1800]
    return {
        "topic": topic,
        "versionId": version_id,
        "deliveryMode": delivery_mode,
        "featureCount": max(1, len(features)),
        "clarifications": clarifications,
        "risks": risks,
        "excerpt": excerpt,
        "parserMode": "local-structured-analysis",
        "tasks": tasks,
    }


def merge_ai_requirement_draft(
    *,
    fallback: dict[str, Any],
    analysis: dict[str, Any],
    resources: list[dict[str, Any]],
    model: str,
    response_id: str | None,
    elapsed_ms: int,
) -> dict[str, Any]:
    raw_tasks = analysis.get("tasks")
    if not isinstance(raw_tasks, list) or not 2 <= len(raw_tasks) <= 40:
        raise ValueError("invalid_ai_requirement_tasks")
    available_names = {
        str(item.get("name"))
        for item in resources
        if item.get("name") and item.get("memberStatus") not in {"离职待交接", "已离职"}
    }
    owners = _owners(resources)
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(raw_tasks, start=1):
        if not isinstance(item, dict):
            raise ValueError("invalid_ai_requirement_task")
        if item.get("sequence") != index:
            raise ValueError("invalid_ai_requirement_task_sequence")
        estimate = max(1, min(320, int(item.get("estimateHours", 8))))
        dependencies = sorted(
            {
                int(value)
                for value in item.get("dependencySequences", [])
                if isinstance(value, int) and 1 <= value < index
            }
        )
        requested_owners = [
            value.strip() for value in str(item.get("owner", "")).split("、") if value.strip()
        ]
        valid_owners = [value for value in requested_owners if value in available_names]
        if not valid_owners:
            work_type = str(item.get("type", ""))
            if any(key in work_type for key in ("测试", "验收", "质量")):
                valid_owners = [owners["test"]]
            elif any(key in work_type for key in ("前端", "交互", "页面")):
                valid_owners = [owners["frontend"]]
            elif any(key in work_type for key in ("后端", "接口", "数据")):
                valid_owners = [owners["backend"]]
            else:
                valid_owners = [owners["product"]]
        normalized.append(
            {
                "sequence": index,
                "name": str(item.get("name", "")).strip()[:120],
                "type": str(item.get("type", "执行任务")).strip()[:30],
                "stage": str(item.get("stage", f"阶段 {index}")).strip()[:30],
                "owner": "、".join(valid_owners),
                "estimateHours": estimate,
                "dependencySequences": dependencies,
                "acceptance": str(item.get("acceptance", "")).strip()[:500],
            }
        )
    if any(not item["name"] or not item["acceptance"] for item in normalized):
        raise ValueError("invalid_ai_requirement_task_content")

    project_start = next_workday(shanghai_today() + timedelta(days=1))
    end_by_sequence: dict[int, date] = {}
    for item in normalized:
        dependencies = item["dependencySequences"]
        if dependencies:
            latest_dependency = max(end_by_sequence[value] for value in dependencies)
            task_start = next_workday(latest_dependency + timedelta(days=1))
        else:
            task_start = project_start
        duration = max(1, math.ceil(item["estimateHours"] / 8))
        task_end = add_workdays(task_start, duration)
        item["start"] = task_start.strftime("%m/%d")
        item["end"] = task_end.strftime("%m/%d")
        end_by_sequence[item["sequence"]] = task_end

    confidence = float(analysis.get("confidence", 0))
    return {
        **fallback,
        "topic": str(analysis.get("topic") or fallback["topic"]).strip()[:60],
        "featureCount": max(1, min(200, int(analysis.get("featureCount", 1)))),
        "clarifications": [str(value)[:240] for value in analysis.get("clarifications", [])][:12],
        "risks": [str(value)[:240] for value in analysis.get("risks", [])][:12],
        "assumptions": [str(value)[:240] for value in analysis.get("assumptions", [])][:12],
        "confidence": max(0, min(1, confidence)),
        "parserMode": "openai-structured-output",
        "aiProvider": "openai",
        "aiModel": model,
        "aiResponseId": response_id,
        "aiElapsedMs": elapsed_ms,
        "tasks": normalized,
    }
