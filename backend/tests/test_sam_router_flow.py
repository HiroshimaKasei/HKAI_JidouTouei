from __future__ import annotations

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
import app.routers.sam as sam_router


class _FakeSamService:
    def __init__(self) -> None:
        self.last_predict_points: list[tuple[float, float]] = []
        self.last_predict_labels: list[int] = []

    def register_capture(self, _capture_id: str, _image: np.ndarray) -> None:
        return None

    def prepare_embedding(self, _capture_id: str) -> None:
        return None

    def predict(self, capture_id: str, points: list[tuple[float, float]], labels: list[int], request_id: int) -> dict[str, object]:
        assert capture_id
        self.last_predict_points = points
        self.last_predict_labels = labels
        mask = np.zeros((32, 32, 4), dtype=np.uint8)
        mask[4:24, 6:28, 0:3] = (58, 160, 255)
        mask[4:24, 6:28, 3] = 140
        ok, encoded = cv2.imencode(".png", mask)
        assert ok
        return {
            "request_id": request_id,
            "scores": [0.9, 0.7, 0.2],
            "best_index": 0,
            "masks": [encoded.tobytes().hex()] * 3,
            "prediction_ms": 25.0,
        }

    def get_candidate_mask(self, _capture_id: str, _request_id: int, _candidate_index: int) -> np.ndarray:
        mask = np.zeros((32, 32), dtype=np.uint8)
        cv2.rectangle(mask, (4, 4), (28, 24), 1, -1)
        cv2.rectangle(mask, (10, 10), (16, 16), 0, -1)
        return mask

    def gpu_status(self) -> dict[str, object]:
        return {
            "ok": True,
            "active_device": "cpu",
            "configured_device": "cpu",
            "state": "ready",
            "model_loaded": True,
            "error": "",
            "cached_captures": 1,
        }


def _png_bytes() -> bytes:
    image = np.zeros((32, 32, 3), dtype=np.uint8)
    image[4:28, 6:30] = (255, 255, 255)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_register_prepare_predict_accept_flow(monkeypatch) -> None:
    fake = _FakeSamService()
    monkeypatch.setattr(sam_router, "sam_service", fake)

    client = TestClient(app)

    reg = client.post(
        "/api/sam/register-image",
        files={"file": ("capture.png", _png_bytes(), "image/png")},
    )
    assert reg.status_code == 200
    body = reg.json()
    capture_id = body["capture_id"]
    assert body["width"] == 32
    assert body["height"] == 32

    prep = client.post("/api/sam/prepare", json={"capture_id": capture_id})
    assert prep.status_code == 200
    assert prep.json()["ok"] is True

    pred = client.post(
        "/api/sam/predict",
        json={
            "capture_id": capture_id,
            "request_id": 11,
            "points": [
                {"x": 12.5, "y": 14.5, "label": 1},
                {"x": 1.0, "y": 1.0, "label": 0},
            ],
        },
    )
    assert pred.status_code == 200
    pred_body = pred.json()
    assert pred_body["best_index"] == 0
    assert len(pred_body["masks"]) == 3
    assert fake.last_predict_labels == [1, 0]
    assert fake.last_predict_points[0] == (12.5, 14.5)

    accepted = client.post(
        "/api/sam/accept",
        json={"capture_id": capture_id, "request_id": 11, "candidate_index": 0},
    )
    assert accepted.status_code == 200
    accepted_body = accepted.json()
    assert accepted_body["mask_png_hex"]
    assert accepted_body["contour_bw_png_hex"]
    assert accepted_body["contour_alpha_png_hex"]
    assert len(accepted_body["outer_contours"]) >= 1
