from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import PROJECTS_DIR


class ProjectService:
    def __init__(self) -> None:
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        return PROJECTS_DIR / project_id

    def save_json(self, project_id: str, payload: dict[str, Any]) -> Path:
        pdir = self.project_dir(project_id)
        pdir.mkdir(parents=True, exist_ok=True)
        out = pdir / "project.json"
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return out

    def load_json(self, project_id: str) -> dict[str, Any]:
        pdir = self.project_dir(project_id)
        src = pdir / "project.json"
        if not src.exists():
            raise FileNotFoundError("project.json not found")
        return json.loads(src.read_text(encoding="utf-8"))

    def save_pdf_bytes(self, project_id: str, content: bytes) -> Path:
        pdir = self.project_dir(project_id)
        pdir.mkdir(parents=True, exist_ok=True)
        out = pdir / "source.pdf"
        out.write_bytes(content)
        return out

    def list_projects(self) -> list[str]:
        if not PROJECTS_DIR.exists():
            return []
        return sorted([p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()])
