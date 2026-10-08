from __future__ import annotations

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import uuid
import tempfile
from pathlib import Path

from app.schemas.models import AcceptMaskRequest, PrepareEmbeddingRequest, PredictRequest, RegisterCaptureImageRequest
from app.state import contour_service, sam_service

router = APIRouter(prefix="/api/sam", tags=["sam"])


@router.post("/register-image")
def register_image(req: RegisterCaptureImageRequest) -> dict[str, object]:
    try:
        raw = bytes.fromhex(req.image_png_hex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid image_png_hex") from exc

    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unable to decode PNG")

    capture_id = uuid.uuid4().hex
    sam_service.register_capture(capture_id, image)
    h, w = image.shape[:2]
    return {"capture_id": capture_id, "width": w, "height": h}


@router.post("/prepare")
def prepare(req: PrepareEmbeddingRequest) -> dict[str, object]:
    try:
        sam_service.prepare_embedding(req.capture_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/predict")
def predict(req: PredictRequest) -> dict[str, object]:
    pos_count = sum(1 for p in req.points if p.label == 1)
    if pos_count == 0:
        return {"request_id": req.request_id, "scores": [], "best_index": -1, "masks": []}

    try:
        out = sam_service.predict(
            capture_id=req.capture_id,
            points=[(p.x, p.y) for p in req.points],
            labels=[p.label for p in req.points],
            request_id=req.request_id,
        )
    except (KeyError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return out


@router.post("/accept")
def accept(req: AcceptMaskRequest) -> JSONResponse:
    try:
        mask = sam_service.get_candidate_mask(req.capture_id, req.request_id, req.candidate_index)
    except (KeyError, ValueError, IndexError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ok, buf = cv2.imencode(".png", mask * 255)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode mask")

    with tempfile.TemporaryDirectory() as tmp_dir:
        export = contour_service.export(mask.astype(np.uint8), Path(tmp_dir), "accepted")
        contour_bw = cv2.imread(str(export.contour_bw_path), cv2.IMREAD_COLOR)
        contour_alpha = cv2.imread(str(export.contour_transparent_path), cv2.IMREAD_UNCHANGED)

        ok_bw, bw_buf = cv2.imencode(".png", contour_bw)
        ok_alpha, alpha_buf = cv2.imencode(".png", contour_alpha)
    if not ok_bw or not ok_alpha:
        raise HTTPException(status_code=500, detail="Failed to encode contour previews")

    return JSONResponse(
        {
            "mask_png_hex": buf.tobytes().hex(),
            "contour_bw_png_hex": bw_buf.tobytes().hex(),
            "contour_alpha_png_hex": alpha_buf.tobytes().hex(),
            "outer_contours": export.outer_contours,
            "hole_contours": export.hole_contours,
        }
    )
