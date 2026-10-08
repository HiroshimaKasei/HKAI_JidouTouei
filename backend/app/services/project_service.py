from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any

from app.config import PROJECTS_DIR


class ProjectService:
    def __init__(self) -> None:
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", project_id):
            raise ValueError("Invalid project_id")
        path = (PROJECTS_DIR / project_id).resolve()
        root = PROJECTS_DIR.resolve()
        if root not in path.parents and path != root:
            raise ValueError("Invalid project path")
        return path

    @staticmethod
    def sample_dir(project_dir: Path, sample_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", sample_id):
            raise ValueError("Invalid sample_id")
        path = (project_dir / "samples" / sample_id).resolve()
        if project_dir.resolve() not in path.parents:
            raise ValueError("Invalid sample path")
        return path

    def save_json(self, project_id: str, payload: dict[str, Any]) -> Path:
        pdir = self.project_dir(project_id)
        pdir.mkdir(parents=True, exist_ok=True)
        out = pdir / "project.json"
        data = json.dumps(payload, indent=2)
        with tempfile.NamedTemporaryFile("w", delete=False, dir=str(pdir), encoding="utf-8") as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        os.replace(tmp_path, out)
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
