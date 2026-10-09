from __future__ import annotations

from fastapi import Header, HTTPException

from app.state import operator_session_service


def require_operator_lock(x_operator_token: str | None = Header(None)) -> str:
    token = (x_operator_token or "").strip()
    if not token:
        raise HTTPException(status_code=423, detail="Active operator token required")
    if not operator_session_service.assert_active(token):
        raise HTTPException(status_code=423, detail="Another operator session is active")
    return token
