from __future__ import annotations

import ipaddress

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import FRONTEND_DIST_DIR, TRUSTED_LAN_CIDRS
from app.routers import camera, health, project, sam, session
from app.state import camera_service

app = FastAPI(title="HKAI_JidouTouei API", version="0.1.0")

_trusted_networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
for _cidr in TRUSTED_LAN_CIDRS:
    try:
        _trusted_networks.append(ipaddress.ip_network(_cidr, strict=False))
    except ValueError:
        continue


def _client_allowed(client_ip: str) -> bool:
    if client_ip == "testclient":
        return True
    try:
        ip = ipaddress.ip_address(client_ip)
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
    except ValueError:
        return False
    return any(ip in net for net in _trusted_networks)


@app.middleware("http")
async def enforce_trusted_lan(request: Request, call_next):
    client_ip = request.client.host if request.client else ""
    if not _client_allowed(client_ip):
        return JSONResponse(status_code=403, content={"detail": "Access denied: outside trusted LAN"})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Operator-Token"],
)

app.include_router(health.router)
app.include_router(session.router)
app.include_router(camera.router)
app.include_router(sam.router)
app.include_router(project.router)


if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")


def _serve_spa_path(path: str) -> FileResponse:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    index_file = FRONTEND_DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")

    if path:
        target = (FRONTEND_DIST_DIR / path).resolve()
        root = FRONTEND_DIST_DIR.resolve()
        if target.exists() and target.is_file() and root in target.parents:
            return FileResponse(path=target)

    return FileResponse(path=index_file)


@app.get("/")
def root() -> FileResponse:
    return _serve_spa_path("")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str) -> FileResponse:
    return _serve_spa_path(full_path)


@app.on_event("shutdown")
def on_shutdown() -> None:
    camera_service.shutdown()
