from __future__ import annotations

import argparse
import signal
import time

from .database import (
    initialize_database,
    projects_due_for_inspection,
    run_project_inspection,
)
from .runtime import validate_runtime_configuration


def run_due_projects() -> int:
    completed = 0
    for project_id in projects_due_for_inspection():
        result = run_project_inspection(
            project_id=project_id,
            trigger_type="scheduled",
            actor_id="ai-inspection-worker",
        )
        if result["status"] == "completed":
            completed += 1
            print(
                f"inspection completed project={project_id} findings={result['total']}",
                flush=True,
            )
    return completed


def main() -> int:
    parser = argparse.ArgumentParser(description="FlowPilot AI inspection worker")
    parser.add_argument("--once", action="store_true", help="run due inspections once")
    parser.add_argument("--poll-seconds", type=int, default=30)
    args = parser.parse_args()
    validate_runtime_configuration()
    initialize_database()
    if args.once:
        run_due_projects()
        return 0

    running = True

    def stop(_: int, __: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while running:
        run_due_projects()
        time.sleep(max(5, args.poll_seconds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
