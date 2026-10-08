from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import camera, health, project, sam

app = FastAPI(title="HKAI_JidouTouei API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(camera.router)
app.include_router(sam.router)
app.include_router(project.router)


@app.get("/")
def root() -> dict[str, object]:
    return {"name": "HKAI_JidouTouei", "ok": True}
