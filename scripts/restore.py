from __future__ import annotations

import argparse
import os
import shutil
import socket
import sqlite3
import tarfile
from pathlib import Path
from uuid import uuid4

try:
    from .backup import backup_workspace, resolve_from_root, verify_backup
    from .dev import load_environment
except ImportError:  # direct execution: python3 scripts/restore.py
    from backup import backup_workspace, resolve_from_root, verify_backup
    from dev import load_environment


def extract_uploads(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            member_path = Path(member.name)
            if (
                member_path.is_absolute()
                or ".." in member_path.parts
                or member.issym()
                or member.islnk()
                or member.isdev()
            ):
                raise ValueError("backup_upload_archive_unsafe")
            relative_parts = (
                member_path.parts[1:]
                if member_path.parts[:1] == ("uploads",)
                else member_path.parts
            )
            if not relative_parts:
                continue
            target = destination.joinpath(*relative_parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ValueError("backup_upload_archive_unsupported_entry")
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("backup_upload_archive_invalid")
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def local_api_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 8000), timeout=0.2):
            return True
    except OSError:
        return False


def restore_workspace(
    backup_directory: str | Path,
    *,
    confirm: bool = False,
) -> dict[str, object]:
    load_environment()
    if not confirm:
        raise ValueError("restore_confirmation_required")
    if local_api_running():
        raise RuntimeError("restore_requires_stopped_local_service")
    verification = verify_backup(backup_directory)
    backup_path = Path(verification["directory"])
    database_path = resolve_from_root(
        os.getenv("PROJECT_DB_PATH", "backend/data/project_command_center.db")
    )
    uploads_path = resolve_from_root(
        os.getenv("PROJECT_UPLOAD_PATH", "backend/data/uploads")
    )

    safety_backup = backup_workspace() if database_path.exists() else None
    token = uuid4().hex
    staged_uploads = uploads_path.parent / f".{uploads_path.name}.restore-{token}"
    previous_uploads = uploads_path.parent / f".{uploads_path.name}.previous-{token}"
    staged_database = database_path.parent / f".{database_path.name}.restore-{token}"
    archive_path = backup_path / "uploads.tar.gz"
    uploads_swapped = False
    try:
        if archive_path.exists():
            extract_uploads(archive_path, staged_uploads)
            uploads_path.parent.mkdir(parents=True, exist_ok=True)
            if uploads_path.exists():
                uploads_path.rename(previous_uploads)
            staged_uploads.rename(uploads_path)
            uploads_swapped = True

        database_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(backup_path / "flowpilot.db") as source:
            with sqlite3.connect(staged_database) as target:
                source.backup(target)
                integrity = target.execute("PRAGMA integrity_check").fetchall()
                if [str(row[0]) for row in integrity] != ["ok"]:
                    raise ValueError("restored_database_integrity_failed")
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{database_path}{suffix}")
            if sidecar.exists():
                sidecar.unlink()
        staged_database.replace(database_path)
        if previous_uploads.exists():
            shutil.rmtree(previous_uploads)
    except Exception:
        if staged_database.exists():
            staged_database.unlink()
        if staged_uploads.exists():
            shutil.rmtree(staged_uploads)
        if uploads_swapped and uploads_path.exists():
            shutil.rmtree(uploads_path)
        if previous_uploads.exists():
            previous_uploads.rename(uploads_path)
        raise

    return {
        "restoredFrom": str(backup_path),
        "safetyBackup": str(safety_backup) if safety_backup else None,
        "verification": verification,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify or restore a FlowPilot local backup"
    )
    parser.add_argument("backup", help="backup directory containing flowpilot.db")
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="validate checksums, SQLite integrity and upload archive without restoring",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="confirm replacing the current local database and uploads",
    )
    args = parser.parse_args()
    if args.verify_only:
        result = verify_backup(args.backup)
        print(
            "Backup verified: "
            f"{result['database']['projects']} projects, "
            f"{result['database']['records']} records, "
            f"{result['uploads']['files']} uploads"
        )
        return 0
    result = restore_workspace(args.backup, confirm=args.confirm)
    print(f"FlowPilot restored from: {result['restoredFrom']}")
    if result["safetyBackup"]:
        print(f"Pre-restore safety backup: {result['safetyBackup']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
