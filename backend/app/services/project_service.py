from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import hashlib
import zipfile

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

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def create_archive(self, project_id: str) -> Path:
        """Create the editable, ZIP-compatible project artifact without extraction."""
        pdir = self.project_dir(project_id)
        archive = pdir / f"{project_id}.hkai"
        members = [path for path in pdir.rglob("*") if path.is_file() and path != archive]
        manifest = {
            "schema_version": 2,
            "project_id": project_id,
            "files": {path.relative_to(pdir).as_posix(): self._sha256(path) for path in members},
        }
        with tempfile.NamedTemporaryFile(delete=False, dir=str(pdir), suffix=".hkai") as tmp:
            temp_path = Path(tmp.name)
        try:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as output:
                for path in members:
                    output.write(path, path.relative_to(pdir).as_posix())
                output.writestr("manifest.json", json.dumps(manifest, indent=2))
            os.replace(temp_path, archive)
        finally:
            temp_path.unlink(missing_ok=True)
        return archive

    def import_archive(self, archive_path: Path) -> str:
        """Validate and atomically install a ZIP-compatible editable project archive."""
        max_members = 2000
        max_uncompressed_bytes = 1024 * 1024 * 1024
        with zipfile.ZipFile(archive_path) as source:
            members = source.infolist()
            if len(members) > max_members or sum(member.file_size for member in members) > max_uncompressed_bytes:
                raise ValueError("Archive exceeds import limits")
            names = [member.filename for member in members]
            if any(name.startswith("/") or ".." in Path(name).parts or "\\" in name for name in names):
                raise ValueError("Archive contains unsafe paths")
            if "project.json" not in names or "manifest.json" not in names:
                raise ValueError("Archive is missing required metadata")
            manifest = json.loads(source.read("manifest.json"))
            project_id = str(manifest.get("project_id", ""))
            self.project_dir(project_id)
            expected = manifest.get("files", {})
            if not isinstance(expected, dict):
                raise ValueError("Archive manifest is invalid")
            for name, digest in expected.items():
                if name not in names or hashlib.sha256(source.read(name)).hexdigest() != digest:
                    raise ValueError("Archive checksum validation failed")
            with tempfile.TemporaryDirectory(dir=str(PROJECTS_DIR)) as temp_dir:
                staging = Path(temp_dir) / project_id
                staging.mkdir()
                for member in members:
                    if member.is_dir() or member.filename == "manifest.json":
                        continue
                    target = staging / member.filename
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read(member.filename))
                payload = self.load_json_from(staging)
                if payload.get("project_id") != project_id:
                    raise ValueError("Archive project ID mismatch")
                destination = self.project_dir(project_id)
                if destination.exists():
                    raise ValueError("A project with this ID already exists")
                os.replace(staging, destination)
        return project_id

    @staticmethod
    def load_json_from(project_dir: Path) -> dict[str, Any]:
        return json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
