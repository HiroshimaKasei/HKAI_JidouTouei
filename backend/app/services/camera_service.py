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
        self._lock = threading.RLock()
        self._test_mode_image: np.ndarray | None = None
        self._last_capture: CaptureFrame | None = None
        self._latest_native_frame: np.ndarray | None = None
        self._camera_name = "DISCONNECTED"
        self._camera_available = False
        self._connected = False
        self._ic4 = None
        self._grabber = None
        self._snap_sink = None
        self._stop_event = threading.Event()
        self._worker: threading.Thread | None = None
        self._last_error = ""

        self._discover_and_start()

    def _discover_and_start(self) -> None:
        try:
            import imagingcontrol4 as ic4  # type: ignore
        except Exception:
            with self._lock:
                self._camera_available = False
                self._camera_name = "IC4 not available"
                self._connected = False
            return

        with self._lock:
            self._ic4 = ic4
            self._camera_available = True
            self._camera_name = "IC4 available"

        self._start_worker()

    def _start_worker(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        self._stop_event.clear()
        self._worker = threading.Thread(target=self._acquisition_loop, daemon=True)
        self._worker.start()

    def _find_device(self):
        # IC4 API variants differ by package release; this method probes safely.
        ic4 = self._ic4
        if ic4 is None:
            return None

        if hasattr(ic4, "Library") and hasattr(ic4.Library, "init"):
            try:
                ic4.Library.init()
            except Exception:
                pass

        devices = []
        try:
            if hasattr(ic4, "DeviceEnum") and hasattr(ic4.DeviceEnum, "devices"):
                devices = list(ic4.DeviceEnum.devices())
            elif hasattr(ic4, "DeviceEnum") and hasattr(ic4.DeviceEnum, "list"):
                devices = list(ic4.DeviceEnum.list())
        except Exception:
            devices = []

        if not devices:
            return None

        for dev in devices:
            name = str(getattr(dev, "model_name", "") or getattr(dev, "display_name", "") or dev)
            if "DFK 33UX178" in name:
                return dev
        return devices[0]

    def _open_camera(self) -> None:
        ic4 = self._ic4
        if ic4 is None:
            raise RuntimeError("IC4 module unavailable")

        device = self._find_device()
        if device is None:
            raise RuntimeError("No IC4 camera detected")

        grabber = ic4.Grabber()
        grabber.device_open(device)

        snap_sink = ic4.SnapSink()
        if hasattr(grabber, "stream_setup"):
            try:
                grabber.stream_setup(snap_sink)
            except TypeError:
                # Some IC4 builds require setup options; default setup often works with positional args.
                grabber.stream_setup(snap_sink, None)
        else:
            raise RuntimeError("IC4 Grabber.stream_setup is unavailable")

        name = str(getattr(device, "model_name", "") or getattr(device, "display_name", "") or "IC4 Camera")

        with self._lock:
            self._grabber = grabber
            self._snap_sink = snap_sink
            self._camera_name = name
            self._connected = True
            self._last_error = ""

    def _close_camera(self) -> None:
        with self._lock:
            grabber = self._grabber
            self._grabber = None
            self._snap_sink = None
            self._connected = False
            self._latest_native_frame = None
        if grabber is not None:
            try:
                if hasattr(grabber, "stream_stop"):
                    grabber.stream_stop()
            except Exception:
                pass
            try:
                if hasattr(grabber, "device_close"):
                    grabber.device_close()
            except Exception:
                pass

    def _snap_to_numpy(self, snap) -> np.ndarray | None:
        # Probe common conversion methods across IC4 python releases.
        for method in ["numpy_copy", "to_numpy", "as_numpy"]:
            if hasattr(snap, method):
                try:
                    arr = getattr(snap, method)()
                    if isinstance(arr, np.ndarray):
                        return arr
                except Exception:
                    pass
        return None

    def _acquisition_loop(self) -> None:
        while not self._stop_event.is_set():
            if self._test_mode_image is not None:
                time.sleep(0.1)
                continue

            if not self._connected:
                try:
                    self._open_camera()
                except Exception as exc:
                    with self._lock:
                        self._last_error = str(exc)
                        self._connected = False
                    time.sleep(1.0)
                    continue

            try:
                with self._lock:
                    sink = self._snap_sink
                if sink is None:
                    raise RuntimeError("Snap sink unavailable")

                if hasattr(sink, "snap_single"):
                    snap = sink.snap_single(250)
                elif hasattr(sink, "snap"):
                    snap = sink.snap(250)
                else:
                    raise RuntimeError("No snap method on IC4 sink")

                frame = self._snap_to_numpy(snap)
                if frame is None:
                    raise RuntimeError("Failed to convert IC4 frame to numpy")

                if frame.ndim == 2:
                    frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
                elif frame.shape[2] == 4:
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

                with self._lock:
                    self._latest_native_frame = frame.copy()
                    self._last_error = ""
            except Exception as exc:
                with self._lock:
                    self._last_error = str(exc)
                self._close_camera()
                time.sleep(0.5)

    def shutdown(self) -> None:
        self._stop_event.set()
        if self._worker is not None:
            self._worker.join(timeout=2.0)
        self._close_camera()

    def status(self) -> dict[str, Any]:
        with self._lock:
            mode = "test" if self._test_mode_image is not None else "camera"
            return {
                "camera_available": self._camera_available,
                "camera_connected": self._connected,
                "camera_name": self._camera_name,
                "mode": mode,
                "last_error": self._last_error,
            }

    def set_test_image(self, image_path: Path) -> None:
        img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Unable to read test image")
        with self._lock:
            self._test_mode_image = img
            self._camera_name = f"TEST MODE: {image_path.name}"
            self._connected = False

    def clear_test_mode(self) -> None:
        with self._lock:
            self._test_mode_image = None
        self._start_worker()

    def _current_native_frame(self) -> np.ndarray:
        with self._lock:
            if self._test_mode_image is not None:
                return self._test_mode_image.copy()
            if self._latest_native_frame is not None:
                return self._latest_native_frame.copy()
        raise RuntimeError("No camera frame available. Connect camera or load TEST MODE image.")

    def get_live_preview_frame(self, max_width: int = 1280) -> np.ndarray:
        frame = self._current_native_frame()
        h, w = frame.shape[:2]
        if w <= max_width:
            return frame
        scale = max_width / float(w)
        resized = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        return resized

    def get_live_frame(self, max_width: int = 1280) -> np.ndarray:
        return self.get_live_preview_frame(max_width=max_width)

    def capture(self) -> CaptureFrame:
        frame = self._current_native_frame()
        mode = "test" if self._test_mode_image is not None else "camera"
        capture = CaptureFrame(capture_id=uuid.uuid4().hex, image=frame, mode=mode)
        with self._lock:
            self._last_capture = capture
        return capture

    def get_capture(self, capture_id: str) -> CaptureFrame:
        with self._lock:
            if self._last_capture and self._last_capture.capture_id == capture_id:
                return self._last_capture
        raise KeyError("Unknown capture_id")
