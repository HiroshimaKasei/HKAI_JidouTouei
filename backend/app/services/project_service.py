from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import hashlib
import shutil
from contextlib import contextmanager
from collections.abc import Iterator
from uuid import uuid4
import zipfile

from app.config import PROJECTS_DIR

MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024


class ProjectService:
    def __init__(self) -> None:
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        self._recover_interrupted_saves()

    def project_dir(self, project_id: str) -> Path:
        if (not re.fullmatch(r"[A-Za-z0-9._-]+", project_id)
                or project_id in {".", ".."} or project_id.casefold() == ".tx"):
            raise ValueError("Invalid project_id")
        path = (PROJECTS_DIR / project_id).resolve()
        root = PROJECTS_DIR.resolve()
        if root not in path.parents and path != root:
            raise ValueError("Invalid project path")
        return path

    @staticmethod
    def sample_dir(project_dir: Path, sample_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", sample_id) or sample_id in {".", ".."}:
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
        return sorted([p.name for p in PROJECTS_DIR.iterdir() if p.is_dir() and p.name.casefold() != ".tx"])

    def _recover_interrupted_saves(self) -> None:
        transactions = PROJECTS_DIR / ".tx"
        if not transactions.exists():
            return
        candidates = [path for path in transactions.iterdir() if (path / "id").is_file()]
        for transaction in sorted(candidates, key=lambda path: (path / "id").stat().st_mtime_ns, reverse=True):
            marker = transaction / "id"
            backup = transaction / "b"
            if not marker.is_file() or not backup.is_dir():
                continue
            try:
                destination = self.project_dir(marker.read_text(encoding="utf-8"))
                if not destination.exists():
                    os.replace(backup, destination)
            except (OSError, ValueError):
                # Leave the backup untouched for manual recovery.
                continue

    @contextmanager
    def upload_spool(self) -> Iterator[Path]:
        root = PROJECTS_DIR / ".tx"
        root.mkdir(exist_ok=True)
        spool = root / uuid4().hex
        spool.mkdir()
        try:
            yield spool
        finally:
            shutil.rmtree(spool, ignore_errors=True)

    @contextmanager
    def staged_project(self, project_id: str) -> Iterator[tuple[Path, Path]]:
        destination = self.project_dir(project_id)
        transactions = PROJECTS_DIR / ".tx"
        transactions.mkdir(exist_ok=True)
        transaction = transactions / uuid4().hex
        transaction.mkdir()
        staging = transaction / "s"
        backup = transaction / "b"
        try:
            (transaction / "id").write_text(project_id, encoding="utf-8")
            if destination.exists():
                shutil.copytree(destination, staging)
            else:
                staging.mkdir()
            yield staging, transaction
        finally:
            # A backup may be the only valid copy after a failed rollback.
            if not backup.exists():
                shutil.rmtree(transaction, ignore_errors=True)

    def commit_staged_project(self, project_id: str, staging: Path, transaction: Path,
                              preserve_backup: bool = False) -> None:
        destination = self.project_dir(project_id)
        backup = transaction / "b"
        if destination.exists():
            os.replace(destination, backup)
        try:
            os.replace(staging, destination)
        except BaseException:
            if backup.exists():
                os.replace(backup, destination)
            raise
        if backup.exists() and not preserve_backup:
            shutil.rmtree(backup, ignore_errors=True)

    @staticmethod
    def _sample_version_key(sample: dict[str, Any]) -> str:
        identity = {
            "capture_id": sample.get("capture_id", ""),
            "width": sample.get("width"),
            "height": sample.get("height"),
            "prompts": sample.get("prompts", []),
            "contour_points": sample.get("contour_points", []),
            "hole_points": sample.get("hole_points", []),
        }
        return hashlib.sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()

    def reconcile_samples(self, project_dir: Path, samples: list[dict[str, Any]]) -> None:
        sample_ids = {sample["sample_id"] for sample in samples}
        active = project_dir / "samples"
        retained = project_dir / ".r"
        previous = {}
        if (project_dir / "project.json").exists():
            previous = {sample["sample_id"]: sample for sample in self.load_json_from(project_dir).get("samples", [])}
        for sample_id in sample_ids:
            self.sample_dir(project_dir, sample_id)
        desired = {sample["sample_id"]: sample for sample in samples}
        versions = project_dir / ".v"
        for sample_id, sample in previous.items():
            sdir = self.sample_dir(project_dir, sample_id)
            if (sdir.is_dir() and (sample_id not in desired
                    or self._sample_version_key(desired[sample_id]) != self._sample_version_key(sample))):
                version = versions / sample_id / self._sample_version_key(sample)
                shutil.copytree(sdir, version, dirs_exist_ok=True)
        if active.exists():
            for path in active.iterdir():
                if path.is_dir() and path.name not in sample_ids:
                    retained.mkdir(exist_ok=True)
                    target = retained / path.name
                    if target.exists():
                        raise ValueError("Conflicting retained sample")
                    os.replace(path, target)
        for sample_id in sample_ids:
            saved = retained / sample_id
            target = self.sample_dir(project_dir, sample_id)
            if saved.is_dir() and not target.exists():
                active.mkdir(exist_ok=True)
                os.replace(saved, target)
            old_sample = previous.get(sample_id)
            version_key = self._sample_version_key(desired[sample_id])
            version = versions / sample_id / version_key
            if (old_sample is None or self._sample_version_key(old_sample) != version_key) and version.is_dir():
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(version, target)

    def write_sample_asset(self, project_dir: Path, sample_id: str, name: str, content: bytes | Path) -> None:
        target = self.sample_dir(project_dir, sample_id) / Path(name).name
        digest = self._sha256(content) if isinstance(content, Path) else hashlib.sha256(content).hexdigest()
        if target.is_file() and self._sha256(target) != digest:
            digest = self._sha256(target)
            history = project_dir / ".h" / sample_id / digest
            history.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, history / target.name)
        if isinstance(content, Path):
            shutil.copyfile(content, target)
        else:
            target.write_bytes(content)

    def reserved_sample_ids(self, project_id: str) -> list[str]:
        pdir = self.project_dir(project_id)
        ids = set()
        for folder in ("samples", ".r", ".v", ".h"):
            directory = pdir / folder
            if directory.is_dir():
                ids.update(path.name for path in directory.iterdir() if path.is_dir())
        return sorted(ids)

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def create_archive(self, project_id: str, project_dir: Path | None = None) -> Path:
        """Create the editable, ZIP-compatible project artifact without extraction."""
        pdir = project_dir if project_dir is not None else self.project_dir(project_id)
        archive = pdir / f"{project_id}.hkai"
        payload = self.load_json_from(pdir)
        members = [pdir / "project.json"]
        members.extend(path for path in (pdir / "source.pdf", pdir / "result.pdf") if path.is_file())
        for sample in payload.get("samples", []):
            sdir = self.sample_dir(pdir, sample["sample_id"])
            for name in [*sample.get("files", {}).values(), "contour.dxf"]:
                if name:
                    path = sdir / Path(name).name
                    if path.is_file() and path not in members:
                        members.append(path)
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
        max_uncompressed_bytes = MAX_ARCHIVE_BYTES
        with zipfile.ZipFile(archive_path) as source:
            members = source.infolist()
            if len(members) > max_members or sum(member.file_size for member in members) > max_uncompressed_bytes:
                raise ValueError("Archive exceeds import limits")
            names = [member.filename for member in members]
            if len({name.casefold() for name in names}) != len(names):
                raise ValueError("Archive contains duplicate paths")
            if any(name.startswith("/") or ".." in Path(name).parts or "\\" in name for name in names):
                raise ValueError("Archive contains unsafe paths")
            if "project.json" not in names or "manifest.json" not in names:
                raise ValueError("Archive is missing required metadata")
            if source.getinfo("manifest.json").file_size > 4 * 1024 * 1024:
                raise ValueError("Archive manifest exceeds import limits")
            if source.getinfo("project.json").file_size > 64 * 1024 * 1024:
                raise ValueError("Archive project metadata exceeds import limits")
            with source.open("manifest.json") as handle:
                manifest = json.load(handle)
            project_id = str(manifest.get("project_id", ""))
            self.project_dir(project_id)
            expected = manifest.get("files", {})
            if not isinstance(expected, dict):
                raise ValueError("Archive manifest is invalid")
            actual = {member.filename for member in members
                      if not member.is_dir() and member.filename != "manifest.json"}
            if set(expected) != actual:
                raise ValueError("Archive manifest file list does not match contents")
            for name, digest in expected.items():
                if name not in names:
                    raise ValueError("Archive checksum validation failed")
                checksum = hashlib.sha256()
                with source.open(name) as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        checksum.update(chunk)
                if checksum.hexdigest() != digest:
                    raise ValueError("Archive checksum validation failed")
            with tempfile.TemporaryDirectory(dir=str(PROJECTS_DIR)) as temp_dir:
                staging = Path(temp_dir) / project_id
                staging.mkdir()
                for member in members:
                    if member.is_dir() or member.filename == "manifest.json":
                        continue
                    target = staging / member.filename
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(member) as input_file, target.open("wb") as output_file:
                        shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
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
