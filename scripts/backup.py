from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .dev import ROOT, load_environment
except ImportError:  # direct execution: python3 scripts/backup.py
    from dev import ROOT, load_environment


def resolve_from_root(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


CORE_TABLES = {
    "projects",
    "project_records",
    "workspace_members",
    "automation_rules",
    "inspection_findings",
}
MANIFEST_NAME = "manifest.json"


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_database(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError("backup_database_missing")
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
        integrity_rows = database.execute("PRAGMA integrity_check").fetchall()
        integrity = [str(row[0]) for row in integrity_rows]
        if integrity != ["ok"]:
            raise ValueError("backup_database_integrity_failed")
        tables = {
            str(row[0])
            for row in database.execute(
                "SELECT name FROM sqlite_schema WHERE type = 'table'"
            ).fetchall()
        }
        missing_tables = sorted(CORE_TABLES - tables)
        if missing_tables:
            raise ValueError(
                f"backup_database_tables_missing:{','.join(missing_tables)}"
            )
        project_count = int(
            database.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        )
        record_count = int(
            database.execute("SELECT COUNT(*) FROM project_records").fetchone()[0]
        )
    return {
        "integrity": "ok",
        "projects": project_count,
        "records": record_count,
    }


def inspect_upload_archive(path: Path) -> dict[str, int]:
    if not path.exists():
        return {"files": 0, "bytes": 0}
    file_count = 0
    total_bytes = 0
    with tarfile.open(path, "r:gz") as archive:
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
            if member.isfile():
                file_count += 1
                total_bytes += int(member.size)
    return {"files": file_count, "bytes": total_bytes}


def verify_backup(backup_directory: str | Path) -> dict[str, Any]:
    directory = Path(backup_directory).expanduser().resolve()
    if not directory.is_dir():
        raise ValueError("backup_directory_not_found")
    database_path = directory / "flowpilot.db"
    uploads_path = directory / "uploads.tar.gz"
    database_summary = inspect_database(database_path)
    uploads_summary = inspect_upload_archive(uploads_path)
    manifest_path = directory / MANIFEST_NAME
    manifest: dict[str, Any] | None = None
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("backup_manifest_invalid") from error
        if not isinstance(manifest, dict) or manifest.get("formatVersion") != 1:
            raise ValueError("backup_manifest_invalid")
        manifest_files = manifest.get("files")
        if not isinstance(manifest_files, dict):
            raise ValueError("backup_manifest_invalid")
        for filename in ("flowpilot.db", "uploads.tar.gz"):
            expected = manifest_files.get(filename)
            candidate = directory / filename
            if not isinstance(expected, dict) or not candidate.is_file():
                raise ValueError(f"backup_file_missing:{filename}")
            if int(expected.get("bytes", -1)) != candidate.stat().st_size:
                raise ValueError(f"backup_file_size_mismatch:{filename}")
            if str(expected.get("sha256", "")) != file_digest(candidate):
                raise ValueError(f"backup_file_checksum_mismatch:{filename}")
    return {
        "directory": str(directory),
        "manifestPresent": manifest is not None,
        "createdAt": manifest.get("createdAt") if manifest else None,
        "database": database_summary,
        "uploads": uploads_summary,
    }


def write_manifest(directory: Path) -> None:
    database_path = directory / "flowpilot.db"
    uploads_path = directory / "uploads.tar.gz"
    manifest = {
        "formatVersion": 1,
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "database": inspect_database(database_path),
        "uploads": inspect_upload_archive(uploads_path),
        "files": {
            path.name: {
                "bytes": path.stat().st_size,
                "sha256": file_digest(path),
            }
            for path in (database_path, uploads_path)
        },
    }
    (directory / MANIFEST_NAME).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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
        with tarfile.open(
            temporary_directory / "uploads.tar.gz", "w:gz"
        ) as archive:
            if upload_path.is_dir():
                archive.add(upload_path, arcname="uploads")
            else:
                empty_directory = tarfile.TarInfo("uploads")
                empty_directory.type = tarfile.DIRTYPE
                empty_directory.mode = 0o750
                archive.addfile(empty_directory)

        write_manifest(temporary_directory)
        verify_backup(temporary_directory)

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
