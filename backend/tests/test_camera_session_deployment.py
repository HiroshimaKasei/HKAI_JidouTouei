from __future__ import annotations

from pathlib import Path
import threading

import numpy as np

from app.main import _client_allowed
from app.services.camera_service import CameraService
from app.services.operator_session_service import OperatorSessionService


def _camera_service_for_test() -> CameraService:
    service = CameraService.__new__(CameraService)
    service._lock = threading.RLock()
    service._test_mode_image = None
    service._last_capture = None
    service._latest_native_frame = None
    service._camera_name = "IC4 Camera"
    service._camera_available = True
    service._connected = True
    service._last_error = ""
    return service


def test_test_image_closes_the_active_grabber(monkeypatch) -> None:
    service = _camera_service_for_test()
    closed = []
    monkeypatch.setattr("app.services.camera_service.cv2.imread", lambda *_args: np.zeros((4, 4, 3), dtype=np.uint8))
    monkeypatch.setattr(service, "_close_camera", lambda: closed.append(True))

    service.set_test_image(Path("fixture.png"))

    assert closed == [True]
    assert service.status()["mode"] == "test"


def test_clearing_test_image_restarts_camera_acquisition(monkeypatch) -> None:
    service = _camera_service_for_test()
    service._test_mode_image = np.zeros((4, 4, 3), dtype=np.uint8)
    restarted = []
    monkeypatch.setattr(service, "_start_worker", lambda: restarted.append(True))

    service.clear_test_mode()

    assert service._test_mode_image is None
    assert restarted == [True]


def test_operator_lock_requires_same_browser_tab_to_reclaim() -> None:
    service = OperatorSessionService()

    first = service.claim("192.168.10.25", client_id="tab-a")
    second_tab = service.claim("192.168.10.25", client_id="tab-b")
    same_tab = service.claim("192.168.10.25", client_id="tab-a")

    assert first["granted"] is True
    assert second_tab["granted"] is False
    assert same_tab["granted"] is True
    assert same_tab["token"] == first["token"]


def test_only_trusted_lan_clients_are_allowed() -> None:
    assert _client_allowed("192.168.10.25") is True
    assert _client_allowed("8.8.8.8") is False


def test_daily_launcher_checks_readiness_and_does_not_install() -> None:
    root = Path(__file__).resolve().parents[2]
    launcher = (root / "launch_operator.bat").read_text(encoding="ascii")
    prepare = (root / "prepare_lan.bat").read_text(encoding="ascii")

    assert "Invoke-WebRequest" in launcher
    assert "pip install" not in launcher
    assert "run_server.py" in launcher
    assert "pip install" in prepare
    assert "run build" in prepare