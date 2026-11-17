from __future__ import annotations

import json
from pathlib import Path
import shutil
from uuid import uuid4
import zipfile

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field, ValidationError

from app.routers._operator_guard import require_operator_lock
from app.schemas.models import LoadProjectResponse, SaveProjectPayload
from app.services.pdf_export_service import PdfExportService
from app.services.project_service import MAX_ARCHIVE_BYTES
from app.state import contour_service, project_service

router = APIRouter(prefix="/api/project", tags=["project"])
pdf_export_service = PdfExportService()
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_SAMPLE_BYTES = 64 * 1024 * 1024
MAX_SAVE_UPLOAD_BYTES = MAX_ARCHIVE_BYTES
UPLOAD_CHUNK_BYTES = 1024 * 1024


class LoadProjectWithReservedSamples(LoadProjectResponse):
    reserved_sample_ids: list[str] = Field(default_factory=list)


async def _spool_upload(upload: UploadFile, path: Path, limit: int, remaining: list[int]) -> None:
    size = 0
    with path.open("wb") as target:
        while True:
            chunk = await upload.read(min(UPLOAD_CHUNK_BYTES, limit - size + 1, remaining[0] + 1))
            if not chunk:
                break
            size += len(chunk)
            remaining[0] -= len(chunk)
            if size > limit or remaining[0] < 0:
                raise HTTPException(status_code=413, detail="Upload exceeds size limit")
            target.write(chunk)


async def _spool_files(files: list[UploadFile] | None, spool: Path, remaining: list[int]) -> dict[str, Path]:
    result = {}
    for upload in files or []:
        if upload.filename:
            path = spool / uuid4().hex
            await _spool_upload(upload, path, MAX_SAMPLE_BYTES, remaining)
            result[upload.filename] = path
    return result


@router.get("/list")
def list_projects() -> dict[str, object]:
    return {"projects": project_service.list_projects()}


@router.post("/import")
async def import_project_archive(
    _token: str = Depends(require_operator_lock), archive: UploadFile = File(...)
) -> dict[str, object]:
    if not archive.filename or Path(archive.filename).suffix.lower() != ".hkai":
        raise HTTPException(status_code=400, detail="An .hkai archive is required")
    with project_service.upload_spool() as spool:
        temp_path = spool / "archive.hkai"
        await _spool_upload(archive, temp_path, MAX_ARCHIVE_BYTES, [MAX_ARCHIVE_BYTES])
        try:
            project_id = project_service.import_archive(temp_path)
        except (ValueError, zipfile.BadZipFile) as exc:
            raise HTTPException(status_code=400, detail="Invalid project archive") from exc
    return {"project_id": project_id}


def _normalize_payload(payload: dict) -> dict:
    # Backward compatibility for older project files that omitted page_number/files/style.
    payload.setdefault("schema_version", 1)
    payload.setdefault("project_name", "")
    payload.setdefault("source_pdf_hash", "")
    payload.setdefault("source_drive_file_id", "")
    selected_page = int(payload.get("selected_page", 1))
    for sample in payload.get("samples", []):
        sample.setdefault("page_number", selected_page)
        sample.setdefault("files", {})
        sample["files"].setdefault("capture", "")
        sample["files"].setdefault("mask", "")
        sample["files"].setdefault("contour_bw", "")
        transform = sample.setdefault("transform", {})
        transform.setdefault("color", "#ff5500")
        style = sample.setdefault("style", {})
        style.setdefault("color", transform["color"])
        style.setdefault("line_type", "solid")
        style.setdefault("width_mm", 0.35)
    return payload


@router.post("/save")
async def save_project(
    _token: str = Depends(require_operator_lock),
    project_id: str = Form(...),
    payload_json: str = Form(...),
    source_pdf: UploadFile | None = File(None),
    sample_capture: list[UploadFile] | None = File(None),
    sample_mask: list[UploadFile] | None = File(None),
    sample_contour_bw: list[UploadFile] | None = File(None),
) -> dict[str, object]:
    try:
        payload_raw = json.loads(payload_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid payload_json") from exc

    payload_raw = _normalize_payload(payload_raw)
    try:
        payload = SaveProjectPayload(**payload_raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    try:
        pdir = project_service.project_dir(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with project_service.upload_spool() as spool:
        return await _save_validated_project(
            project_id, pdir, payload_raw, payload, spool, source_pdf,
            sample_capture, sample_mask, sample_contour_bw,
        )


async def _save_validated_project(
    project_id: str, pdir: Path, payload_raw: dict, payload: SaveProjectPayload, spool: Path,
    source_pdf: UploadFile | None, sample_capture: list[UploadFile] | None,
    sample_mask: list[UploadFile] | None, sample_contour_bw: list[UploadFile] | None,
) -> dict[str, object]:
    remaining = [MAX_SAVE_UPLOAD_BYTES]
    captures_by_name = await _spool_files(sample_capture, spool, remaining)
    masks_by_name = await _spool_files(sample_mask, spool, remaining)
    contours_by_name = await _spool_files(sample_contour_bw, spool, remaining)
    source_path = None
    if source_pdf is not None:
        source_path = spool / "source.pdf"
        await _spool_upload(source_pdf, source_path, MAX_SOURCE_BYTES, remaining)
    out_payload = payload.model_dump(mode="json")
    sample_ids = [sample["sample_id"] for sample in out_payload["samples"]]
    if len({sample_id.rstrip(".").casefold() for sample_id in sample_ids}) != len(sample_ids):
        raise HTTPException(status_code=400, detail="Duplicate sample_id")
    try:
        for sample_id in sample_ids:
            project_service.sample_dir(pdir, sample_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with project_service.staged_project(project_id) as (staging, transaction):
        project_service.reconcile_samples(staging, out_payload["samples"])
        if source_path is not None:
            shutil.copyfile(source_path, staging / "source.pdf")

        for sample, raw_sample in zip(out_payload["samples"], payload_raw.get("samples", [])):
            sample_id = sample["sample_id"]
            sdir = project_service.sample_dir(staging, sample_id)
            sdir.mkdir(parents=True, exist_ok=True)
            files = sample["files"]

            for key, file_map, default_name in [
                ("capture", captures_by_name, "capture.png"),
                ("mask", masks_by_name, "mask.png"),
                ("contour_bw", contours_by_name, "contour_bw.png"),
            ]:
                name = files.get(key, "")
                if name and name in file_map:
                    files[key] = Path(name).name
                    project_service.write_sample_asset(staging, sample_id, files[key], file_map[name])
                elif name:
                    files[key] = Path(name).name
                else:
                    files[key] = default_name if (sdir / default_name).exists() else ""

            for old_key, new_key, default_name in [
                ("capture_png_hex", "capture", "capture.png"),
                ("mask_png_hex", "mask", "mask.png"),
                ("contour_bw_png_hex", "contour_bw", "contour_bw.png"),
            ]:
                hex_data = raw_sample.get(old_key)
                if hex_data and not files.get(new_key):
                    if isinstance(hex_data, str) and len(hex_data) > MAX_SAMPLE_BYTES * 2:
                        raise HTTPException(status_code=413, detail="Upload exceeds size limit")
                    try:
                        content = bytes.fromhex(hex_data)
                    except (ValueError, TypeError) as exc:
                        raise HTTPException(status_code=400, detail=f"Invalid hex for {old_key}") from exc
                    remaining[0] -= len(content)
                    if remaining[0] < 0:
                        raise HTTPException(status_code=413, detail="Upload exceeds size limit")
                    project_service.write_sample_asset(staging, sample_id, default_name, content)
                    files[new_key] = default_name

            mask_name = files.get("mask", "")
            if mask_name:
                mask_path = sdir / mask_name
                if mask_path.exists():
                    if mask_path.stat().st_size > MAX_SAMPLE_BYTES:
                        raise HTTPException(status_code=413, detail="Upload exceeds size limit")
                    raw = np.frombuffer(mask_path.read_bytes(), dtype=np.uint8)
                    mask = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
                    if mask is not None:
                        export = contour_service.export((mask > 0).astype(np.uint8), sdir, "contour")
                        (sdir / "contour.dxf").write_bytes(export.dxf_path.read_bytes())
        (staging / "project.json").write_text(json.dumps(out_payload, indent=2), encoding="utf-8")
        source_pdf_path = staging / "source.pdf"
        result_pdf_path = staging / "result.pdf"
        result_pdf_path.unlink(missing_ok=True)
        export_error = ""
        result_status = "missing"
        if source_pdf_path.exists():
            try:
                pdf_export_service.export(source_pdf_path, result_pdf_path, out_payload)
                if not result_pdf_path.is_file():
                    raise OSError("PDF exporter did not create an output")
                result_status = "ready"
            except Exception:
                result_pdf_path.unlink(missing_ok=True)
                export_error = "Unable to generate vector PDF from the source document"
                result_status = "failed"
        archive_path = project_service.create_archive(project_id, project_dir=staging)
        project_service.commit_staged_project(project_id, staging, transaction, preserve_backup=bool(export_error))
    return {
        "ok": True,
        "result_pdf_url": f"/api/project/{project_id}/result.pdf" if result_status == "ready" else "",
        "archive_url": f"/api/project/{project_id}/{archive_path.name}",
        "export_error": export_error,
        "artifacts": {
            "project": {"status": "saved", "error": ""},
            "result_pdf": {"status": result_status, "error": export_error},
            "archive": {"status": "ready", "error": ""},
        },
    }


@router.get("/load/{project_id}", response_model=LoadProjectWithReservedSamples)
def load_project(project_id: str) -> LoadProjectWithReservedSamples:
    try:
        payload = project_service.load_json(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    payload = _normalize_payload(payload)
    reserved_ids = set(project_service.reserved_sample_ids(project_id))
    reserved_ids.update(sample["sample_id"] for sample in payload.get("samples", []))
    return LoadProjectWithReservedSamples(
        project_id=project_id,
        selected_page=payload.get("selected_page", 1),
        overlay_scale=payload.get("overlay_scale", 1.0),
        source_pdf_url=f"/api/project/{project_id}/source.pdf",
        samples=payload.get("samples", []),
        reserved_sample_ids=sorted(reserved_ids),
    )


@router.get("/{project_id}/source.pdf")
def source_pdf(project_id: str) -> FileResponse:
    p = project_service.project_dir(project_id) / "source.pdf"
    if not p.exists():
        raise HTTPException(status_code=404, detail="source.pdf not found")
    return FileResponse(path=p, media_type="application/pdf", filename="source.pdf")


@router.get("/{project_id}/result.pdf")
def result_pdf(project_id: str) -> FileResponse:
    p = project_service.project_dir(project_id) / "result.pdf"
    if not p.exists():
        raise HTTPException(status_code=404, detail="result.pdf not found")
    return FileResponse(path=p, media_type="application/pdf", filename="result.pdf")


@router.get("/{project_id}/{archive_name}.hkai")
def project_archive(project_id: str, archive_name: str) -> FileResponse:
    if archive_name != project_id:
        raise HTTPException(status_code=404, detail="archive not found")
    path = project_service.project_dir(project_id) / f"{project_id}.hkai"
    if not path.exists():
        raise HTTPException(status_code=404, detail="archive not found")
    return FileResponse(path=path, media_type="application/zip", filename=path.name)


@router.get("/{project_id}/samples/{sample_id}/{name}")
def sample_file(project_id: str, sample_id: str, name: str) -> FileResponse:
    if name not in {"capture.png", "mask.png", "contour_bw.png", "contour.dxf"} and not name.endswith(".png"):
        raise HTTPException(status_code=400, detail="Unsupported file")
    pdir = project_service.project_dir(project_id)
    try:
        sdir = project_service.sample_dir(pdir, sample_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    path = sdir / Path(name).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media_map = {
        ".png": "image/png",
        ".dxf": "application/dxf",
    }
    return FileResponse(path=path, media_type=media_map.get(path.suffix.lower(), "application/octet-stream"), filename=path.name)
