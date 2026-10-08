from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from collections import OrderedDict
import os
import threading
import time

import cv2
import numpy as np
import torch


@dataclass
class PredictionBundle:
    request_id: int
    masks: np.ndarray
    scores: np.ndarray


@dataclass
class CaptureEmbedding:
    features: torch.Tensor
    input_size: tuple[int, int]
    original_size: tuple[int, int]


@dataclass
class CaptureSamState:
    image_bgr: np.ndarray
    embedding: CaptureEmbedding | None = None
    latest_prediction: PredictionBundle | None = None
    latest_request_id: int = -1


class SamService:
    def __init__(self) -> None:
        self._states: OrderedDict[str, CaptureSamState] = OrderedDict()
        self._max_cached_captures = 16
        self._model_loaded = False
        self._predictor = None
        self._requested_device = os.getenv("SAM_DEVICE", "auto").strip().lower()
        if self._requested_device not in {"auto", "cpu", "cuda"}:
            self._requested_device = "auto"
        self._device = "cpu"
        self._lock = threading.RLock()
        self._available = True
        self._startup_error = ""
        self._runtime_state = "idle"
        self._device_fallback_reason = ""
        self._last_prepare_ms: float | None = None
        self._last_predict_ms: float | None = None
        self._gpu_details = {
            "device_name": "CPU",
            "capability": "n/a",
            "cuda_version": torch.version.cuda,
            "torch_version": torch.__version__,
        }

        if self._requested_device == "cpu":
            self._device = "cpu"
        elif self._requested_device == "cuda":
            try:
                self._gpu_details = self._validate_cuda()
                self._device = "cuda"
            except Exception as exc:
                self._device = "cuda"
                self._available = False
                self._runtime_state = "error"
                self._startup_error = str(exc)
                self._gpu_details = {
                    "device_name": "unavailable",
                    "capability": "unknown",
                    "cuda_version": torch.version.cuda,
                    "torch_version": torch.__version__,
                }
        else:
            try:
                self._gpu_details = self._validate_cuda()
                self._device = "cuda"
            except Exception as exc:
                self._device = "cpu"
                self._device_fallback_reason = str(exc)

    @staticmethod
    def _validate_cuda() -> dict[str, Any]:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available")

        dev_idx = 0
        capability = torch.cuda.get_device_capability(dev_idx)
        name = torch.cuda.get_device_name(dev_idx)

        # Real GPU operation check before SAM load.
        x = torch.randn((1024, 1024), device="cuda")
        y = torch.randn((1024, 1024), device="cuda")
        z = x @ y
        _ = torch.mean(z).item()

        return {
            "device_name": name,
            "capability": f"{capability[0]}.{capability[1]}",
            "cuda_version": torch.version.cuda,
            "torch_version": torch.__version__,
        }

    def gpu_status(self) -> dict[str, Any]:
        device_name = self._gpu_details.get("device_name", "CPU") if self._device == "cuda" else "CPU"
        capability = self._gpu_details.get("capability", "n/a") if self._device == "cuda" else "n/a"
        return {
            "ok": self._available,
            "configured_device": self._requested_device,
            "active_device": self._device,
            "device_name": device_name,
            "capability": capability,
            "cuda_version": torch.version.cuda,
            "torch_version": torch.__version__,
            "model_loaded": self._model_loaded,
            "state": self._runtime_state,
            "error": self._startup_error,
            "fallback_reason": self._device_fallback_reason,
            "cached_captures": len(self._states),
            "last_prepare_ms": self._last_prepare_ms,
            "last_predict_ms": self._last_predict_ms,
        }

    def _ensure_available(self) -> None:
        if not self._available:
            raise RuntimeError(f"SAM service unavailable: {self._startup_error}")

    def _load_model(self) -> None:
        self._ensure_available()
        if self._model_loaded:
            return

        self._runtime_state = "loading"

        checkpoint = Path(__file__).resolve().parents[3] / "models" / "sam_vit_b_01ec64.pth"
        if not checkpoint.exists():
            self._runtime_state = "error"
            self._startup_error = "SAM checkpoint not found at models/sam_vit_b_01ec64.pth"
            raise FileNotFoundError(
                self._startup_error
            )

        from segment_anything import SamPredictor, sam_model_registry

        try:
            sam = sam_model_registry["vit_b"](checkpoint=str(checkpoint))
            sam.to(device=self._device)
            self._predictor = SamPredictor(sam)
            self._model_loaded = True
            self._startup_error = ""
            self._runtime_state = "ready"
        except Exception as exc:
            self._runtime_state = "error"
            self._startup_error = str(exc)
            raise

    def _touch_state(self, capture_id: str) -> CaptureSamState:
        state = self._states.pop(capture_id)
        self._states[capture_id] = state
        return state

    def _evict_if_needed(self) -> None:
        while len(self._states) > self._max_cached_captures:
            self._states.popitem(last=False)

    def register_capture(self, capture_id: str, image_bgr: np.ndarray) -> None:
        with self._lock:
            self._states[capture_id] = CaptureSamState(image_bgr=image_bgr)
            self._touch_state(capture_id)
            self._evict_if_needed()

    def _snapshot_embedding(self) -> CaptureEmbedding:
        features = self._predictor.features
        if features is None:
            raise RuntimeError("SAM predictor produced empty embedding")
        return CaptureEmbedding(
            features=features.detach().clone(),
            input_size=tuple(self._predictor.input_size),
            original_size=tuple(self._predictor.original_size),
        )

    def _restore_embedding(self, embedding: CaptureEmbedding) -> None:
        self._predictor.features = embedding.features
        self._predictor.input_size = embedding.input_size
        self._predictor.original_size = embedding.original_size
        self._predictor.is_image_set = True

    def prepare_embedding(self, capture_id: str) -> None:
        with self._lock:
            t0 = time.perf_counter()
            self._load_model()
            state = self._states.get(capture_id)
            if state is None:
                raise KeyError("Unknown capture_id")
            self._touch_state(capture_id)
            if state.embedding is not None:
                self._last_prepare_ms = (time.perf_counter() - t0) * 1000.0
                return
            image_rgb = cv2.cvtColor(state.image_bgr, cv2.COLOR_BGR2RGB)
            with torch.inference_mode():
                self._predictor.set_image(image_rgb)
            state.embedding = self._snapshot_embedding()
            self._last_prepare_ms = (time.perf_counter() - t0) * 1000.0
            if self._runtime_state != "error":
                self._runtime_state = "ready"

    def predict(self, capture_id: str, points: list[tuple[float, float]], labels: list[int], request_id: int) -> dict[str, Any]:
        self._ensure_available()
        if len(points) == 0:
            return {"request_id": request_id, "scores": [], "best_index": -1, "masks": []}

        point_arr = np.array(points, dtype=np.float32)
        label_arr = np.array(labels, dtype=np.int32)

        with self._lock:
            t0 = time.perf_counter()
            state = self._states.get(capture_id)
            if state is None:
                raise KeyError("Unknown capture_id")
            self._touch_state(capture_id)
            if state.embedding is None:
                raise RuntimeError("Embedding not prepared")
            if request_id < state.latest_request_id:
                raise ValueError("Stale request_id")
            state.latest_request_id = request_id

            self._runtime_state = "processing"
            self._restore_embedding(state.embedding)
            with torch.inference_mode():
                masks, scores, _ = self._predictor.predict(
                    point_coords=point_arr,
                    point_labels=label_arr,
                    multimask_output=True,
                )
            state.latest_prediction = PredictionBundle(request_id=request_id, masks=masks, scores=scores)
            self._last_predict_ms = (time.perf_counter() - t0) * 1000.0
            if self._runtime_state != "error":
                self._runtime_state = "ready"

        encoded_masks: list[str] = []
        for mask in masks:
            mask_u8 = mask.astype(np.uint8)
            rgba = np.zeros((mask_u8.shape[0], mask_u8.shape[1], 4), dtype=np.uint8)
            rgba[..., 0] = 58
            rgba[..., 1] = 160
            rgba[..., 2] = 255
            rgba[..., 3] = mask_u8 * 140
            ok, buf = cv2.imencode(".png", rgba)
            if not ok:
                raise RuntimeError("Failed to encode SAM mask")
            encoded_masks.append(buf.tobytes().hex())

        best_idx = int(np.argmax(scores))
        return {
            "request_id": request_id,
            "scores": [float(x) for x in scores.tolist()],
            "best_index": best_idx,
            "masks": encoded_masks,
            "prediction_ms": self._last_predict_ms,
        }

    def get_candidate_mask(self, capture_id: str, request_id: int, candidate_index: int) -> np.ndarray:
        self._ensure_available()
        with self._lock:
            state = self._states.get(capture_id)
            if state is None or state.latest_prediction is None:
                raise KeyError("No prediction available")
            self._touch_state(capture_id)
            pred = state.latest_prediction
            if pred.request_id != request_id:
                raise KeyError("Stale request_id")
            if candidate_index < 0 or candidate_index >= pred.masks.shape[0]:
                raise IndexError("Invalid candidate_index")

            mask = pred.masks[candidate_index].astype(np.uint8)
            if int(mask.sum()) == 0:
                raise ValueError("Empty mask is not allowed")
            return mask

    def release_capture(self, capture_id: str) -> None:
        with self._lock:
            self._states.pop(capture_id, None)
