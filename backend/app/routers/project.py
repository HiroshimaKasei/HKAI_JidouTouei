from __future__ import annotations

from pathlib import Path
import shutil

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.schemas.models import LoadProjectResponse
from app.state import contour_service, project_service

router = APIRouter(prefix="/api/project", tags=["project"])


@router.get("/list")
def list_projects() -> dict[str, object]:
    return {"projects": project_service.list_projects()}


@router.post("/save")
async def save_project(
    project_id: str = Form(...),
    payload_json: str = Form(...),
    source_pdf: UploadFile | None = File(None),
) -> dict[str, object]:
    import json

    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid payload_json") from exc

    pdir = project_service.project_dir(project_id)
    samples_dir = pdir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    if source_pdf is not None:
        project_service.save_pdf_bytes(project_id, await source_pdf.read())

    for sample in payload.get("samples", []):
        sid = sample["sample_id"]
        sdir = samples_dir / sid
        sdir.mkdir(parents=True, exist_ok=True)

        for key, file_name in [
            ("capture_png_hex", "capture.png"),
            ("mask_png_hex", "mask.png"),
            ("contour_bw_png_hex", "contour_bw.png"),
        ]:
            if key in sample and sample[key]:
                (sdir / file_name).write_bytes(bytes.fromhex(sample[key]))

        if "mask_png_hex" in sample and sample["mask_png_hex"]:
            raw = np.frombuffer(bytes.fromhex(sample["mask_png_hex"]), dtype=np.uint8)
            mask = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
            if mask is not None:
                export = contour_service.export((mask > 0).astype(np.uint8), sdir, "contour")
                shutil.copy2(export.dxf_path, sdir / "contour.dxf")

    project_service.save_json(project_id, payload)
    return {"ok": True}


@router.get("/load/{project_id}", response_model=LoadProjectResponse)
def load_project(project_id: str) -> LoadProjectResponse:
    payload = project_service.load_json(project_id)
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


@router.get("/{project_id}/samples/{sample_id}/{name}")
def sample_file(project_id: str, sample_id: str, name: str) -> FileResponse:
    if name not in {"capture.png", "mask.png", "contour_bw.png", "contour.dxf"}:
        raise HTTPException(status_code=400, detail="Unsupported file")
    path = project_service.project_dir(project_id) / "samples" / sample_id / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media_map = {
        "capture.png": "image/png",
        "mask.png": "image/png",
        "contour_bw.png": "image/png",
        "contour.dxf": "application/dxf",
    }
    return FileResponse(path=path, media_type=media_map[name], filename=name)
