from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENV_PYTHON = ROOT / "backend" / ".venv" / "bin" / "python"


def load_environment() -> None:
    """Load local dotenv files without overriding values from the shell."""
    inherited_keys = set(os.environ)
    for filename in (".env", ".env.local"):
        path = ROOT / filename
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key or not key.replace("_", "").isalnum():
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if key not in inherited_keys:
                os.environ[key] = value


def main() -> int:
    load_environment()
    if not VENV_PYTHON.exists():
        print(
            "Python backend is not installed. Run: npm run setup:api",
            file=sys.stderr,
        )
        return 1

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
                "--reload",
            ],
            cwd=ROOT,
        ),
        subprocess.Popen(["npm", "run", "dev:web"], cwd=ROOT),
        subprocess.Popen(
            [
                str(VENV_PYTHON),
                "-m",
                "backend.app.inspection_worker",
                "--poll-seconds",
                "30",
            ],
            cwd=ROOT,
        ),
    ]

    def stop(_: int | None = None, __: object | None = None) -> None:
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
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
