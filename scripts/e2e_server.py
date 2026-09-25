"""Start an isolated FlowPilot stack for Playwright acceptance tests."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = ROOT / "backend" / ".venv" / "bin" / "python"
FRONTEND_DIRECTORIES = (
    ".openai",
    "app",
    "components",
    "db",
    "drizzle",
    "hooks",
    "lib",
    "public",
)
FRONTEND_FILES = (
    "components.json",
    "next.config.ts",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
)


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=8)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def main() -> int:
    python = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
    with tempfile.TemporaryDirectory(prefix="flowpilot-e2e-") as temp_dir:
        temp = Path(temp_dir)
        frontend_root = temp / "frontend"
        frontend_root.mkdir()
        for name in (*FRONTEND_DIRECTORIES, *FRONTEND_FILES, "node_modules"):
            (frontend_root / name).symlink_to(
                ROOT / name,
                target_is_directory=(ROOT / name).is_dir(),
            )
        environment = os.environ.copy()
        environment.update(
            {
                "PROJECT_ENV": "development",
                "PROJECT_DB_PATH": str(temp / "workspace.db"),
                "PROJECT_UPLOAD_PATH": str(temp / "uploads"),
                "PROJECT_SEED_DEMO_DATA": "true",
                "PROJECT_API_BASE_URL": "http://127.0.0.1:8011",
                "NEXT_PUBLIC_SITE_URL": "http://127.0.0.1:3011",
                "PROJECT_CORS_ORIGINS": "http://127.0.0.1:3011",
                "PROJECT_EMBED_INSPECTION_WORKER": "false",
            }
        )
        processes = [
            subprocess.Popen(
                [
                    python,
                    "-m",
                    "uvicorn",
                    "backend.app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8011",
                ],
                cwd=ROOT,
                env=environment,
                start_new_session=True,
            ),
            subprocess.Popen(
                [
                    "npm",
                    "run",
                    "dev:web",
                    "--",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    "3011",
                ],
                cwd=frontend_root,
                env=environment,
                start_new_session=True,
            ),
        ]

        def stop(*_: object) -> None:
            for process in reversed(processes):
                stop_process(process)

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        try:
            while all(process.poll() is None for process in processes):
                time.sleep(0.25)
        finally:
            stop()
        return next(
            (process.returncode or 0 for process in processes if process.returncode),
            0,
        )


if __name__ == "__main__":
    raise SystemExit(main())
