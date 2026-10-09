from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import secrets
import threading
import time
from typing import Any


@dataclass
class OperatorSession:
    token: str
    client_ip: str
    operator_name: str
    acquired_at: float
    last_seen_at: float


class OperatorSessionService:
    def __init__(self, ttl_seconds: int = 300) -> None:
        self._ttl_seconds = max(30, int(ttl_seconds))
        self._active: OperatorSession | None = None
        self._lock = threading.RLock()

    def _now(self) -> float:
        return time.time()

    @staticmethod
    def _iso(ts: float) -> str:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

    def _is_expired(self, session: OperatorSession, now_ts: float) -> bool:
        return now_ts - session.last_seen_at > self._ttl_seconds

    def _expire_if_needed(self, now_ts: float | None = None) -> None:
        if self._active is None:
            return
        ts = now_ts if now_ts is not None else self._now()
        if self._is_expired(self._active, ts):
            self._active = None

    def claim(self, client_ip: str, operator_name: str = "operator") -> dict[str, Any]:
        with self._lock:
            now_ts = self._now()
            self._expire_if_needed(now_ts)

            if self._active is None:
                token = secrets.token_urlsafe(32)
                self._active = OperatorSession(
                    token=token,
                    client_ip=client_ip,
                    operator_name=operator_name.strip() or "operator",
                    acquired_at=now_ts,
                    last_seen_at=now_ts,
                )
                return {
                    "granted": True,
                    "token": token,
                    "active": self.status(),
                }

            if self._active.client_ip == client_ip:
                self._active.last_seen_at = now_ts
                return {
                    "granted": True,
                    "token": self._active.token,
                    "active": self.status(),
                }

            return {
                "granted": False,
                "token": "",
                "active": self.status(),
            }

    def heartbeat(self, token: str) -> bool:
        with self._lock:
            now_ts = self._now()
            self._expire_if_needed(now_ts)
            if self._active is None or self._active.token != token:
                return False
            self._active.last_seen_at = now_ts
            return True

    def release(self, token: str) -> bool:
        with self._lock:
            self._expire_if_needed()
            if self._active is None or self._active.token != token:
                return False
            self._active = None
            return True

    def has_active_session(self) -> bool:
        with self._lock:
            self._expire_if_needed()
            return self._active is not None

    def assert_active(self, token: str) -> bool:
        with self._lock:
            now_ts = self._now()
            self._expire_if_needed(now_ts)
            if self._active is None:
                return False
            if self._active.token != token:
                return False
            self._active.last_seen_at = now_ts
            return True

    def status(self) -> dict[str, Any]:
        with self._lock:
            now_ts = self._now()
            self._expire_if_needed(now_ts)
            if self._active is None:
                return {
                    "locked": False,
                    "operator_name": "",
                    "client_ip": "",
                    "acquired_at": "",
                    "last_seen_at": "",
                    "ttl_seconds": self._ttl_seconds,
                    "expires_in_seconds": 0,
                }

            expires_in = max(0, int(self._ttl_seconds - (now_ts - self._active.last_seen_at)))
            return {
                "locked": True,
                "operator_name": self._active.operator_name,
                "client_ip": self._active.client_ip,
                "acquired_at": self._iso(self._active.acquired_at),
                "last_seen_at": self._iso(self._active.last_seen_at),
                "ttl_seconds": self._ttl_seconds,
                "expires_in_seconds": expires_in,
            }
