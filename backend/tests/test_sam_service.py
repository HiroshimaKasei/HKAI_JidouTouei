from __future__ import annotations

import os

import numpy as np
import pytest
import torch

from app.services.sam_service import SamService


class _FakePredictor:
    def __init__(self) -> None:
        self.features = torch.zeros((1, 3, 2, 2), dtype=torch.float32)
        self.input_size = (8, 8)
        self.original_size = (8, 8)
        self.is_image_set = False
        self.set_image_calls = 0
        self.predict_calls = 0

    def set_image(self, _image) -> None:
        self.set_image_calls += 1
        self.features = torch.ones((1, 3, 2, 2), dtype=torch.float32)
        self.input_size = (8, 8)
        self.original_size = (8, 8)
        self.is_image_set = True

    def predict(self, point_coords, point_labels, multimask_output=True):
        self.predict_calls += 1
        assert multimask_output
        assert len(point_coords) == len(point_labels)

        m1 = np.zeros((8, 8), dtype=np.uint8)
        m2 = np.zeros((8, 8), dtype=np.uint8)
        m3 = np.zeros((8, 8), dtype=np.uint8)
        m1[1:6, 1:6] = 1
        m2[2:7, 2:7] = 1
        m3[3:7, 1:4] = 1
        masks = np.stack([m1, m2, m3]).astype(bool)
        scores = np.array([0.55, 0.82, 0.33], dtype=np.float32)
        logits = np.zeros((3, 8, 8), dtype=np.float32)
        return masks, scores, logits


def test_cpu_auto_fallback_when_cuda_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAM_DEVICE", "auto")
    monkeypatch.setattr("torch.cuda.is_available", lambda: False)

    svc = SamService()
    status = svc.gpu_status()

    assert status["ok"] is True
    assert status["active_device"] == "cpu"
    assert status["error"] == ""


def test_cuda_mode_reports_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAM_DEVICE", "cuda")
    monkeypatch.setattr("torch.cuda.is_available", lambda: False)

    svc = SamService()
    status = svc.gpu_status()

    assert status["ok"] is False
    assert status["active_device"] == "cuda"
    assert "CUDA is not available" in status["error"]


def test_cached_embedding_and_prompt_refinement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAM_DEVICE", "cpu")
    svc = SamService()
    fake_predictor = _FakePredictor()

    def _fake_load_model() -> None:
        svc._predictor = fake_predictor
        svc._model_loaded = True
        svc._runtime_state = "ready"

    monkeypatch.setattr(svc, "_load_model", _fake_load_model)

    image = np.zeros((8, 8, 3), dtype=np.uint8)
    image[2:6, 2:6] = 255
    capture_id = "cap-1"
    svc.register_capture(capture_id, image)

    svc.prepare_embedding(capture_id)
    svc.prepare_embedding(capture_id)
    assert fake_predictor.set_image_calls == 1

    out1 = svc.predict(capture_id, [(3.0, 3.0)], [1], request_id=1)
    out2 = svc.predict(capture_id, [(3.0, 3.0), (0.0, 0.0)], [1, 0], request_id=2)

    assert fake_predictor.predict_calls == 2
    assert len(out1["masks"]) == 3
    assert len(out2["scores"]) == 3

    selected = svc.get_candidate_mask(capture_id, request_id=2, candidate_index=int(out2["best_index"]))
    assert selected.shape == (8, 8)
    assert int(selected.sum()) > 0


@pytest.fixture(autouse=True)
def _restore_sam_device_env() -> None:
    old = os.environ.get("SAM_DEVICE")
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("SAM_DEVICE", None)
        else:
            os.environ["SAM_DEVICE"] = old
