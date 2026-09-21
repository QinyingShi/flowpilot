from __future__ import annotations

import os

import uvicorn

from .runtime import validate_runtime_configuration


def main() -> None:
    validate_runtime_configuration()
    port = int(os.getenv("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise RuntimeError("PORT must be between 1 and 65535")
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=port,
        workers=1,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
        access_log=os.getenv("PROJECT_ACCESS_LOG", "true").lower() == "true",
    )


if __name__ == "__main__":
    main()
