from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.project_service import ProjectService
import app.routers.project as project_router


def _png_bytes(fill: int) -> bytes:
    img = np.zeros((16, 16), dtype=np.uint8)
    img[3:13, 3:13] = fill
    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return encoded.tobytes()


def _save_payload(selected_page: int = 1) -> dict[str, object]:
    return {
        "project_id": "projA",
        "selected_page": selected_page,
        "overlay_scale": 1.0,
        "samples": [
            {
                "sample_id": "001",
                "capture_id": "cap-001",
                "page_number": 1,
                "width": 16,
                "height": 16,
                "prompts": [],
                "contour_points": [[[0, 0], [10, 0], [10, 10], [0, 10]]],
                "hole_points": [],
                "transform": {"tx": 0.0, "ty": 0.0, "rotation_deg": 0.0, "visible": True, "color": "#ff5500"},
                "files": {"capture": "001_capture.png", "mask": "001_mask.png", "contour_bw": "001_contour_bw.png"},
            },
            {
                "sample_id": "002",
                "capture_id": "cap-002",
                "page_number": 2,
                "width": 16,
                "height": 16,
                "prompts": [],
                "contour_points": [[[1, 1], [9, 1], [9, 9], [1, 9]]],
                "hole_points": [],
                "transform": {"tx": 2.0, "ty": 3.0, "rotation_deg": 10.0, "visible": True, "color": "#0099ff"},
                "files": {"capture": "002_capture.png", "mask": "002_mask.png", "contour_bw": "002_contour_bw.png"},
            },
        ],
    }


def test_save_load_repeated_preserves_multi_sample_and_dxf(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()
    monkeypatch.setattr(project_router, "project_service", svc)

    # Keep global state in sync with the patched service for this test run.
    monkeypatch.setattr("app.state.project_service", svc)

    client = TestClient(app)
    claim = client.post("/api/session/claim", json={"operator_name": "pytest"})
    assert claim.status_code == 200
    token = claim.json()["token"]
    headers = {"X-Operator-Token": token}

    files = [
        ("source_pdf", ("source.pdf", b"%PDF-1.4\n%mock", "application/pdf")),
        ("sample_capture", ("001_capture.png", _png_bytes(100), "image/png")),
        ("sample_capture", ("002_capture.png", _png_bytes(120), "image/png")),
        ("sample_mask", ("001_mask.png", _png_bytes(255), "image/png")),
        ("sample_mask", ("002_mask.png", _png_bytes(255), "image/png")),
        ("sample_contour_bw", ("001_contour_bw.png", _png_bytes(255), "image/png")),
        ("sample_contour_bw", ("002_contour_bw.png", _png_bytes(255), "image/png")),
    ]

    payload = _save_payload(selected_page=1)
    resp = client.post(
        "/api/project/save",
        headers=headers,
        data={"project_id": "projA", "payload_json": json.dumps(payload)},
        files=files,
    )
    assert resp.status_code == 200

    pdir = tmp_path / "projA"
    assert (pdir / "samples" / "001" / "contour.dxf").exists()
    assert (pdir / "samples" / "002" / "contour.dxf").exists()

    load_resp = client.get("/api/project/load/projA")
    assert load_resp.status_code == 200
    loaded = load_resp.json()
    assert loaded["selected_page"] == 1
    assert len(loaded["samples"]) == 2
    assert {s["page_number"] for s in loaded["samples"]} == {1, 2}

    # Re-save same project with a switched selected page and new source PDF.
    payload2 = _save_payload(selected_page=2)
    payload2["overlay_scale"] = 1.25
    resp2 = client.post(
        "/api/project/save",
        headers=headers,
        data={"project_id": "projA", "payload_json": json.dumps(payload2)},
        files=[("source_pdf", ("source.pdf", b"%PDF-1.4\n%updated", "application/pdf"))],
    )
    assert resp2.status_code == 200

    load_resp2 = client.get("/api/project/load/projA")
    assert load_resp2.status_code == 200
    loaded2 = load_resp2.json()
    assert loaded2["selected_page"] == 2
    assert loaded2["overlay_scale"] == 1.25
    assert len(loaded2["samples"]) == 2

    # Ensure derived DXF artifacts remain available after repeated saves.
    assert (pdir / "samples" / "001" / "contour.dxf").exists()
    assert (pdir / "samples" / "002" / "contour.dxf").exists()

    # Drawing switch persistence check: source.pdf should be overwritten by latest save.
    assert (pdir / "source.pdf").read_bytes().startswith(b"%PDF-1.4\n%updated")
