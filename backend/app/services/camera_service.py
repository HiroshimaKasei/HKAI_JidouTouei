from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import threading
import time
import uuid

import cv2
import numpy as np


@dataclass
class CaptureFrame:
    capture_id: str
    image: np.ndarray
    mode: str


class CameraService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._live_fallback = self._build_placeholder_frame(3072, 2048, "NO CAMERA")
        self._test_mode_image: np.ndarray | None = None
        self._last_capture: CaptureFrame | None = None
        self._camera_name = "TEST MODE"
        self._ic4_available = False
        self._discover_once()

    def _discover_once(self) -> None:
        try:
            import imagingcontrol4 as ic4  # type: ignore
        except Exception:
            self._ic4_available = False
            self._camera_name = "TEST MODE"
            return

        self._ic4_available = True
        self._camera_name = "IC4 READY"
        self._ic4 = ic4

    @staticmethod
    def _build_placeholder_frame(width: int, height: int, text: str) -> np.ndarray:
        frame = np.full((height, width, 3), 225, dtype=np.uint8)
        cv2.putText(
            frame,
            text,
            (80, height // 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            3.0,
            (40, 40, 40),
            8,
            cv2.LINE_AA,
        )
        return frame

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "camera_available": self._ic4_available,
                "camera_name": self._camera_name,
                "mode": "test" if self._test_mode_image is not None or not self._ic4_available else "camera",
            }

    def set_test_image(self, image_path: Path) -> None:
        img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Unable to read test image")
        with self._lock:
            self._test_mode_image = img
            self._camera_name = f"TEST MODE: {image_path.name}"

    def get_live_frame(self) -> np.ndarray:
        with self._lock:
            if self._test_mode_image is not None:
                return self._test_mode_image.copy()
            if not self._ic4_available:
                # Timestamp confirms preview is live even in fallback mode.
                frame = self._live_fallback.copy()
                ts = time.strftime("%H:%M:%S")
                cv2.putText(frame, ts, (100, 200), cv2.FONT_HERSHEY_SIMPLEX, 3, (0, 80, 180), 6, cv2.LINE_AA)
                return frame

        # IC4 acquisition reference should be adapted here for actual hardware.
        # For MVP in unknown runtime, fallback avoids blocking startup.
        return self._live_fallback.copy()

    def capture(self) -> CaptureFrame:
        frame = self.get_live_frame()
        capture = CaptureFrame(capture_id=uuid.uuid4().hex, image=frame, mode="test" if self._test_mode_image is not None else "camera")
        with self._lock:
            self._last_capture = capture
        return capture

    def get_capture(self, capture_id: str) -> CaptureFrame:
        with self._lock:
            if self._last_capture and self._last_capture.capture_id == capture_id:
                return self._last_capture
        raise KeyError("Unknown capture_id")
