from __future__ import annotations

import json
from pathlib import Path
import zipfile

import cv2
import fitz
import numpy as np
import pytest
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


@pytest.fixture
def project_client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()
    monkeypatch.setattr(project_router, "project_service", svc)
    client = TestClient(app)
    token = client.post("/api/session/claim", json={"operator_name": "pytest"}).json()["token"]
    return client, {"X-Operator-Token": token}, svc


def _pdf_bytes() -> bytes:
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()
    return data


def _post_save(client, headers, payload, files=None):
    return client.post(
        "/api/project/save", headers=headers,
        data={"project_id": "projA", "payload_json": json.dumps(payload)},
        files=files or [],
    )


def _initial_files():
    return [
        ("source_pdf", ("source.pdf", _pdf_bytes(), "application/pdf")),
        *[
            (f"sample_{kind}", (f"{sample_id}_{kind}.png", _png_bytes(fill), "image/png"))
            for sample_id, fill in [("001", 100), ("002", 200)]
            for kind in ("capture", "mask", "contour_bw")
        ],
    ]


def _project_files(pdir: Path):
    return {path.relative_to(pdir).as_posix(): path.read_bytes()
            for path in pdir.rglob("*") if path.is_file()}


@pytest.mark.parametrize("failure", ["asset", "contour", "archive", "commit"])
def test_save_failure_leaves_previous_project_intact(project_client, tmp_path, monkeypatch, failure):
    client, headers, svc = project_client
    payload = _save_payload()
    assert _post_save(client, headers, payload, _initial_files()).status_code == 200
    before = _project_files(tmp_path / "projA")

    def fail(*args, **kwargs):
        raise OSError("injected failure")

    if failure == "asset":
        monkeypatch.setattr(svc, "write_sample_asset", fail)
    elif failure == "contour":
        monkeypatch.setattr(project_router.contour_service, "export", fail)
    elif failure == "archive":
        monkeypatch.setattr(svc, "create_archive", fail)
    else:
        import app.services.project_service as service_module
        real_replace = service_module.os.replace

        def fail_install(src, dst):
            if Path(src).name == "s":
                raise OSError("injected install failure")
            return real_replace(src, dst)

        monkeypatch.setattr(service_module.os, "replace", fail_install)

    payload["selected_page"] = 2
    with pytest.raises(OSError, match="injected"):
        _post_save(client, headers, payload, [
            ("source_pdf", ("source.pdf", b"changed", "application/pdf")),
            ("sample_capture", ("001_capture.png", _png_bytes(50), "image/png")),
        ])
    assert _project_files(tmp_path / "projA") == before


def test_deleted_samples_excluded_from_archive_and_restored_after_undo(project_client, tmp_path):
    client, headers, _ = project_client
    original = _save_payload()
    assert _post_save(client, headers, original, _initial_files()).status_code == 200
    pdir = tmp_path / "projA"
    old_capture = (pdir / "samples" / "002" / "002_capture.png").read_bytes()

    deleted = _save_payload()
    deleted["samples"] = deleted["samples"][:1]
    response = _post_save(client, headers, deleted)
    assert response.status_code == 200
    assert response.json()["artifacts"]["archive"] == {"status": "ready", "error": ""}
    assert not (pdir / "samples" / "002").exists()
    assert (pdir / ".r" / "002" / "002_capture.png").read_bytes() == old_capture
    loaded = client.get("/api/project/load/projA").json()
    assert [sample["sample_id"] for sample in loaded["samples"]] == ["001"]
    assert loaded["reserved_sample_ids"] == ["001", "002"]
    with zipfile.ZipFile(pdir / "projA.hkai") as archive:
        names = set(archive.namelist())
        assert "samples/001/001_capture.png" in names
        assert "samples/001/contour.dxf" in names
        assert not any(name.startswith(("samples/002/", ".r/", ".v/")) for name in names)
        assert set(json.loads(archive.read("manifest.json"))["files"]) == names - {"manifest.json"}

    import_root = tmp_path / "import-target"
    import_root.mkdir()
    # The archive contains only active samples and still imports with checksum validation.
    from app.services import project_service as service_module
    old_root = service_module.PROJECTS_DIR
    try:
        service_module.PROJECTS_DIR = import_root
        imported = ProjectService().import_archive(pdir / "projA.hkai")
        assert imported == "projA"
        assert (import_root / "projA" / "samples" / "001" / "001_capture.png").exists()
        assert not (import_root / "projA" / "samples" / "002").exists()
    finally:
        service_module.PROJECTS_DIR = old_root

    assert _post_save(client, headers, original).status_code == 200
    assert (pdir / "samples" / "002" / "002_capture.png").read_bytes() == old_capture
    with zipfile.ZipFile(pdir / "projA.hkai") as archive:
        assert archive.read("samples/002/002_capture.png") == old_capture


def test_undo_restores_assets_after_sample_id_and_filename_reuse(project_client, tmp_path):
    client, headers, _ = project_client
    original = _save_payload()
    assert _post_save(client, headers, original, _initial_files()).status_code == 200
    deleted = _save_payload()
    deleted["samples"] = deleted["samples"][:1]
    assert _post_save(client, headers, deleted).status_code == 200
    reused = _save_payload()
    reused["samples"][1]["capture_id"] = "new-capture"
    assert _post_save(client, headers, reused, [
        ("sample_capture", ("002_capture.png", _png_bytes(25), "image/png")),
    ]).status_code == 200
    pdir = tmp_path / "projA"
    assert (pdir / "samples" / "002" / "002_capture.png").read_bytes() == _png_bytes(25)
    assert _post_save(client, headers, original).status_code == 200
    assert (pdir / "samples" / "002" / "002_capture.png").read_bytes() == _png_bytes(200)
    assert _post_save(client, headers, reused).status_code == 200
    assert (pdir / "samples" / "002" / "002_capture.png").read_bytes() == _png_bytes(25)


def test_undo_resegmentation_of_same_capture_restores_previous_mask(project_client, tmp_path):
    client, headers, _ = project_client
    original = _save_payload()
    assert _post_save(client, headers, original, _initial_files()).status_code == 200
    revised = _save_payload()
    revised["samples"][0]["contour_points"] = [[[2, 2], [8, 2], [8, 8]]]
    assert _post_save(client, headers, revised, [
        ("sample_mask", ("001_mask.png", _png_bytes(40), "image/png")),
    ]).status_code == 200
    mask = tmp_path / "projA" / "samples" / "001" / "001_mask.png"
    assert mask.read_bytes() == _png_bytes(40)
    assert _post_save(client, headers, original).status_code == 200
    assert mask.read_bytes() == _png_bytes(100)


def test_pdf_failure_keeps_previous_project_backup_and_returns_compatible_error(project_client, tmp_path):
    client, headers, _ = project_client
    payload = _save_payload()
    assert _post_save(client, headers, payload, _initial_files()).status_code == 200
    before = _project_files(tmp_path / "projA")
    payload["selected_page"] = 2
    response = _post_save(client, headers, payload, [
        ("source_pdf", ("source.pdf", b"bad pdf", "application/pdf")),
    ])
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] and data["export_error"]
    assert data["result_pdf_url"] == "" and data["archive_url"]
    assert data["artifacts"]["result_pdf"] == {"status": "failed", "error": data["export_error"]}
    assert not (tmp_path / "projA" / "result.pdf").exists()
    backups = list((tmp_path / ".tx").glob("*/b"))
    assert len(backups) == 1
    assert _project_files(backups[0]) == before
    with zipfile.ZipFile(tmp_path / "projA" / "projA.hkai") as archive:
        assert "result.pdf" not in archive.namelist()


def test_legacy_inline_assets_and_invalid_hex_rollback(project_client, tmp_path):
    client, headers, _ = project_client
    payload = _save_payload()
    payload["samples"] = payload["samples"][:1]
    sample = payload["samples"][0]
    sample.pop("files")
    sample["capture_png_hex"] = _png_bytes(123).hex()
    assert _post_save(client, headers, payload).status_code == 200
    pdir = tmp_path / "projA"
    assert (pdir / "samples" / "001" / "capture.png").read_bytes() == _png_bytes(123)
    assert client.get("/api/project/load/projA").json()["samples"][0]["files"]["capture"] == "capture.png"

    before = _project_files(pdir)
    bad = _save_payload()
    bad["samples"][1]["files"] = {}
    bad["samples"][1]["capture_png_hex"] = "not-hex"
    response = _post_save(client, headers, bad)
    assert response.status_code == 400
    assert "Invalid hex" in response.json()["detail"]
    assert _project_files(pdir) == before


@pytest.mark.parametrize("kind", ["archive", "source", "sample", "total"])
def test_upload_limits_return_413_without_changing_project(project_client, tmp_path, monkeypatch, kind):
    client, headers, _ = project_client
    payload = _save_payload()
    assert _post_save(client, headers, payload, _initial_files()).status_code == 200
    before = _project_files(tmp_path / "projA")
    if kind == "archive":
        monkeypatch.setattr(project_router, "MAX_ARCHIVE_BYTES", 5)
        response = client.post("/api/project/import", headers=headers,
                               files={"archive": ("large.hkai", b"123456", "application/zip")})
    elif kind == "source":
        monkeypatch.setattr(project_router, "MAX_SOURCE_BYTES", 5)
        response = _post_save(client, headers, payload, [
            ("source_pdf", ("source.pdf", b"123456", "application/pdf")),
        ])
    elif kind == "sample":
        monkeypatch.setattr(project_router, "MAX_SAMPLE_BYTES", 5)
        response = _post_save(client, headers, payload, [
            ("sample_capture", ("001_capture.png", b"123456", "image/png")),
        ])
    else:
        monkeypatch.setattr(project_router, "MAX_SAVE_UPLOAD_BYTES", 8)
        response = _post_save(client, headers, payload, [
            ("sample_capture", ("001_capture.png", b"12345", "image/png")),
            ("source_pdf", ("source.pdf", b"12345", "application/pdf")),
        ])
    assert response.status_code == 413
    assert response.json() == {"detail": "Upload exceeds size limit"}
    assert _project_files(tmp_path / "projA") == before


def test_uploads_are_read_in_bounded_chunks(project_client, monkeypatch):
    from starlette.datastructures import UploadFile

    client, headers, _ = project_client
    sizes = []
    original_read = UploadFile.read

    async def tracked_read(self, size=-1):
        sizes.append(size)
        return await original_read(self, size)

    monkeypatch.setattr(UploadFile, "read", tracked_read)
    monkeypatch.setattr(project_router, "UPLOAD_CHUNK_BYTES", 8)
    assert _post_save(client, headers, _save_payload(), _initial_files()).status_code == 200
    assert sizes and all(0 < size <= 8 for size in sizes)


def test_archive_error_does_not_expose_server_paths(project_client, monkeypatch):
    client, headers, svc = project_client

    def fail(_path):
        raise ValueError(r"C:\private\project")

    monkeypatch.setattr(svc, "import_archive", fail)
    response = client.post("/api/project/import", headers=headers,
                           files={"archive": ("bad.hkai", b"archive", "application/zip")})
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid project archive"}
