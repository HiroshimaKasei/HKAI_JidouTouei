from __future__ import annotations

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel

from app.state import operator_session_service

router = APIRouter(prefix="/api/session", tags=["session"])


class ClaimRequest(BaseModel):
    operator_name: str = "operator"


@router.get("/status")
def session_status() -> dict[str, object]:
    return operator_session_service.status()


@router.post("/claim")
def claim_session(req: Request, payload: ClaimRequest) -> dict[str, object]:
    client_ip = req.client.host if req.client else "unknown"
    return operator_session_service.claim(client_ip=client_ip, operator_name=payload.operator_name)


@router.post("/heartbeat")
def heartbeat(x_operator_token: str | None = Header(None)) -> dict[str, object]:
    token = (x_operator_token or "").strip()
    return {
        "ok": operator_session_service.heartbeat(token),
        "active": operator_session_service.status(),
    }


@router.post("/release")
def release(x_operator_token: str | None = Header(None)) -> dict[str, object]:
    token = (x_operator_token or "").strip()
    return {
        "ok": operator_session_service.release(token),
        "active": operator_session_service.status(),
    }
