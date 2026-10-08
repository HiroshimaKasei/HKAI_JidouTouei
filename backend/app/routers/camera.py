from __future__ import annotations

from pathlib import Path
import tempfile

import cv2
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from app.state import camera_service, sam_service

router = APIRouter(prefix="/api/camera", tags=["camera"])


@router.get("/status")
def status() -> dict[str, object]:
    return camera_service.status()


@router.get("/frame")
def frame() -> Response:
    img = camera_service.get_live_frame()
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@router.post("/test-image")
async def upload_test_image(file: UploadFile = File(...)) -> dict[str, object]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}:
        raise HTTPException(status_code=400, detail="Unsupported image format")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    try:
        camera_service.set_test_image(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    return camera_service.status()


@router.post("/capture")
def capture() -> JSONResponse:
    cap = camera_service.capture()
    sam_service.register_capture(cap.capture_id, cap.image)
    h, w = cap.image.shape[:2]
    ok, buf = cv2.imencode(".png", cap.image)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode capture image")
    return JSONResponse(
        {
            "capture_id": cap.capture_id,
            "width": w,
            "height": h,
            "mode": cap.mode,
            "capture_png_hex": buf.tobytes().hex(),
        }
    )
