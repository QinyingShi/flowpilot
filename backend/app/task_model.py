from __future__ import annotations

import re
from datetime import date
from typing import Any


TASK_FIELD_COUNT = 13
TASK_VERSIONS = {"v0.9", "v1.0", "v1.1"}
TASK_STATUSES = {"未开始", "进行中", "有阻塞", "已完成"}
TASK_PRIORITIES = {"低", "中", "高"}
PROGRESS_PATTERN = re.compile(r"^(0|[1-9]\d?|100)%$")
EFFORT_PATTERN = re.compile(r"^\d+(?:\.\d+)?h$")
MONTH_DAY_PATTERN = re.compile(r"^(\d{2})/(\d{2})$")


def _valid_month_day(value: str) -> bool:
    matched = MONTH_DAY_PATTERN.fullmatch(value)
    if not matched:
        return False
    try:
        date(2026, int(matched.group(1)), int(matched.group(2)))
    except ValueError:
        return False
    return True


def valid_task_record(task: Any) -> bool:
    if (
        not isinstance(task, list)
        or len(task) != TASK_FIELD_COUNT
        or not all(isinstance(field, str) for field in task)
    ):
        return False
    return (
        all(task[index].strip() for index in (0, 1, 2, 4))
        and task[3] in TASK_VERSIONS
        and task[5] in TASK_STATUSES
        and task[6] in TASK_PRIORITIES
        and _valid_month_day(task[7])
        and _valid_month_day(task[8])
        and bool(PROGRESS_PATTERN.fullmatch(task[9]))
        and bool(EFFORT_PATTERN.fullmatch(task[10]))
        and task[12] in TASK_PRIORITIES
    )


def valid_task_hierarchy(
    hierarchy: list[dict[str, Any]], task_ids: set[str]
) -> bool:
    hierarchy_ids: set[str] = set()
    for record in hierarchy:
        task_id = record.get("taskId")
        root_id = record.get("rootTaskId")
        parent_id = record.get("parentTaskId")
        level = record.get("level")
        work_type = record.get("workType")
        if (
            task_id not in task_ids
            or task_id in hierarchy_ids
            or not isinstance(root_id, str)
            or not root_id
            or type(level) is not int
            or not 0 <= level <= 8
            or not isinstance(work_type, str)
            or not work_type.strip()
        ):
            return False
        if level == 0 and (parent_id is not None or root_id != task_id):
            return False
        if level > 0 and (
            not isinstance(parent_id, str)
            or not parent_id
            or parent_id == task_id
        ):
            return False
        hierarchy_ids.add(task_id)
    return True
