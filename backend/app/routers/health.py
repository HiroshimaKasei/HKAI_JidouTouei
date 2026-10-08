from __future__ import annotations

from fastapi import APIRouter

from app.state import camera_service, sam_service

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/")
def health() -> dict[str, object]:
    sam_status = sam_service.gpu_status()
    return {
        "ok": True,
        "camera": camera_service.status(),
        "sam": sam_status,
        "gpu": sam_status,
    }
