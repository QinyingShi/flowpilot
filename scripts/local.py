from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time

try:
    from .backup import backup_workspace
    from .dev import ROOT, VENV_PYTHON, load_environment
except ImportError:  # direct execution: python3 scripts/local.py
    from backup import backup_workspace
    from dev import ROOT, VENV_PYTHON, load_environment


def enabled(name: str) -> bool:
    return os.getenv(name, "false").lower() == "true"


def lan_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.connect(("8.8.8.8", 80))
            return connection.getsockname()[0]
    except OSError:
        return "<本机局域网 IP>"


def main() -> int:
    load_environment()
    if not VENV_PYTHON.exists():
        print(
            "Python backend is not installed. Run: npm run setup:api",
            file=sys.stderr,
        )
        return 1

    lan_access = enabled("FLOWPILOT_LAN_ACCESS")
    web_host = "0.0.0.0" if lan_access else "localhost"
    os.environ.setdefault("PROJECT_API_BASE_URL", "http://127.0.0.1:8000")
    os.environ.setdefault("PROJECT_EMBED_INSPECTION_WORKER", "true")
    os.environ.setdefault("PROJECT_INSPECTION_POLL_SECONDS", "30")

    try:
        destination = backup_workspace()
        if destination is not None:
            print(f"Startup backup created: {destination}")
    except Exception as error:  # a backup failure must not prevent local startup
        print(f"Startup backup failed: {error}", file=sys.stderr)

    processes = [
        subprocess.Popen(
            [
                str(VENV_PYTHON),
                "-m",
                "uvicorn",
                "backend.app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            cwd=ROOT,
            env=os.environ,
        ),
        subprocess.Popen(
            [
                "npm",
                "run",
                "dev:web",
                "--",
                "--hostname",
                web_host,
                "--port",
                "3001",
            ],
            cwd=ROOT,
            env=os.environ,
        ),
    ]

    print("FlowPilot local workspace: http://localhost:3001")
    if lan_access:
        print(f"LAN workspace: http://{lan_address()}:3001")
        print("LAN access is not suitable for exposure to the public internet.")

    def stop(_: int | None = None, __: object | None = None) -> None:
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    next_backup_at = time.monotonic() + 24 * 60 * 60

    try:
        while all(process.poll() is None for process in processes):
            if time.monotonic() >= next_backup_at:
                try:
                    destination = backup_workspace()
                    if destination is not None:
                        print(f"Daily backup created: {destination}")
                except Exception as error:  # keep the workspace running
                    print(f"Daily backup failed: {error}", file=sys.stderr)
                next_backup_at = time.monotonic() + 24 * 60 * 60
            time.sleep(0.5)
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    return next(
        (process.returncode or 0 for process in processes if process.returncode),
        0,
    )


if __name__ == "__main__":
    raise SystemExit(main())
