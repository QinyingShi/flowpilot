from __future__ import annotations

import os
import shutil
import sqlite3
import tarfile
from datetime import datetime
from pathlib import Path

try:
    from .dev import ROOT, load_environment
except ImportError:  # direct execution: python3 scripts/backup.py
    from dev import ROOT, load_environment


def resolve_from_root(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def backup_workspace() -> Path | None:
    load_environment()
    database_path = resolve_from_root(
        os.getenv("PROJECT_DB_PATH", "backend/data/project_command_center.db")
    )
    if not database_path.exists():
        return None

    backup_root = resolve_from_root(
        os.getenv("FLOWPILOT_BACKUP_DIR", "backups")
    )
    backup_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S-%f")
    final_directory = backup_root / f"flowpilot-{timestamp}"
    temporary_directory = backup_root / f".flowpilot-{timestamp}.tmp"
    temporary_directory.mkdir()

    try:
        with sqlite3.connect(database_path) as source:
            with sqlite3.connect(temporary_directory / "flowpilot.db") as target:
                source.backup(target)

        upload_path = resolve_from_root(
            os.getenv("PROJECT_UPLOAD_PATH", "backend/data/uploads")
        )
        if upload_path.is_dir():
            with tarfile.open(
                temporary_directory / "uploads.tar.gz", "w:gz"
            ) as archive:
                archive.add(upload_path, arcname="uploads")

        temporary_directory.rename(final_directory)
    except Exception:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        raise

    return final_directory


def main() -> int:
    destination = backup_workspace()
    if destination is None:
        print("No FlowPilot database exists yet; backup skipped.")
        return 0
    print(f"FlowPilot backup created: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
