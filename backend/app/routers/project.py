from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.routers._operator_guard import require_operator_lock
from app.schemas.models import LoadProjectResponse, SaveProjectPayload
from app.services.pdf_export_service import PdfExportService
from app.state import contour_service, project_service

router = APIRouter(prefix="/api/project", tags=["project"])
pdf_export_service = PdfExportService()


@router.get("/list")
def list_projects() -> dict[str, object]:
    return {"projects": project_service.list_projects()}


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
    import json

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

    captures_by_name = {f.filename: f for f in (sample_capture or []) if f.filename}
    masks_by_name = {f.filename: f for f in (sample_mask or []) if f.filename}
    contours_by_name = {f.filename: f for f in (sample_contour_bw or []) if f.filename}

    if source_pdf is not None:
        project_service.save_pdf_bytes(project_id, await source_pdf.read())

    out_payload = payload.model_dump(mode="json")

    for sample in out_payload.get("samples", []):
        try:
            sdir = project_service.sample_dir(pdir, sample["sample_id"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        sdir.mkdir(parents=True, exist_ok=True)

        files = sample.get("files", {})

        # Preferred path: uploaded binary files.
        for key, name, file_map, default_name in [
            ("capture", files.get("capture", ""), captures_by_name, "capture.png"),
            ("mask", files.get("mask", ""), masks_by_name, "mask.png"),
            ("contour_bw", files.get("contour_bw", ""), contours_by_name, "contour_bw.png"),
        ]:
            if name and name in file_map:
                target_name = Path(name).name
                (sdir / target_name).write_bytes(await file_map[name].read())
                files[key] = target_name
            elif not name:
                files[key] = default_name if (sdir / default_name).exists() else ""

        # Legacy compatibility path: inlined hex image payloads.
        for old_key, new_key, default_name in [
            ("capture_png_hex", "capture", "capture.png"),
            ("mask_png_hex", "mask", "mask.png"),
            ("contour_bw_png_hex", "contour_bw", "contour_bw.png"),
        ]:
            hex_data = sample.get(old_key)
            if hex_data and not files.get(new_key):
                try:
                    (sdir / default_name).write_bytes(bytes.fromhex(hex_data))
                    files[new_key] = default_name
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"Invalid hex for {old_key}") from exc
            sample.pop(old_key, None)

        mask_name = files.get("mask", "")
        if mask_name:
            mask_path = sdir / Path(mask_name).name
            if mask_path.exists():
                raw = np.frombuffer(mask_path.read_bytes(), dtype=np.uint8)
                mask = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
                if mask is not None:
                    export = contour_service.export((mask > 0).astype(np.uint8), sdir, "contour")
                    (sdir / "contour.dxf").write_bytes(export.dxf_path.read_bytes())

    project_service.save_json(project_id, out_payload)
    source_pdf_path = pdir / "source.pdf"
    result_pdf_path = pdir / "result.pdf"
    export_error = ""
    if source_pdf_path.exists():
        try:
            pdf_export_service.export(source_pdf_path, result_pdf_path, out_payload)
        except Exception:
            # Local editable state remains authoritative even if an old or corrupt PDF cannot render.
            result_pdf_path.unlink(missing_ok=True)
            export_error = "Unable to generate vector PDF from the source document"
    archive_path = project_service.create_archive(project_id)
    return {
        "ok": True,
        "result_pdf_url": f"/api/project/{project_id}/result.pdf" if not export_error else "",
        "archive_url": f"/api/project/{project_id}/{archive_path.name}",
        "export_error": export_error,
    }


@router.get("/load/{project_id}", response_model=LoadProjectResponse)
def load_project(project_id: str) -> LoadProjectResponse:
    try:
        payload = project_service.load_json(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    payload = _normalize_payload(payload)
    return LoadProjectResponse(
        project_id=project_id,
        selected_page=payload.get("selected_page", 1),
        overlay_scale=payload.get("overlay_scale", 1.0),
        source_pdf_url=f"/api/project/{project_id}/source.pdf",
        samples=payload.get("samples", []),
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
