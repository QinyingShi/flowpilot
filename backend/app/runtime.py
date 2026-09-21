from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse


def production_configuration_errors() -> list[str]:
    if os.getenv("PROJECT_ENV", "development") != "production":
        return []

    errors: list[str] = []
    secret = os.getenv("PROJECT_API_PROXY_SECRET", "")
    if len(secret) < 32 or secret.startswith("replace-with-"):
        errors.append("PROJECT_API_PROXY_SECRET must contain at least 32 characters")

    admin_email = os.getenv("PROJECT_BOOTSTRAP_ADMIN_EMAIL", "")
    if (
        not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", admin_email)
        or admin_email.lower() == "admin@example.com"
    ):
        errors.append("PROJECT_BOOTSTRAP_ADMIN_EMAIL must be a valid email address")

    if os.getenv("PROJECT_MEMBERSHIP_MODE", "invite_only") != "invite_only":
        errors.append("PROJECT_MEMBERSHIP_MODE must be invite_only in production")

    for variable in ("PROJECT_DB_PATH", "PROJECT_UPLOAD_PATH"):
        value = os.getenv(variable, "")
        if not value or not Path(value).is_absolute():
            errors.append(f"{variable} must be an absolute persistent path")

    origins = [
        item.strip()
        for item in os.getenv("PROJECT_CORS_ORIGINS", "").split(",")
        if item.strip()
    ]
    if not origins:
        errors.append("PROJECT_CORS_ORIGINS must contain the deployed HTTPS site origin")
    for origin in origins:
        parsed = urlparse(origin)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.path not in {"", "/"}
            or parsed.hostname in {"your-flowpilot-site.example", "example.com"}
        ):
            errors.append(f"PROJECT_CORS_ORIGINS contains an invalid origin: {origin}")

    return errors


def validate_runtime_configuration() -> None:
    errors = production_configuration_errors()
    if errors:
        raise RuntimeError("Invalid production configuration: " + "; ".join(errors))
