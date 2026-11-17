import os
import hashlib
import json
import zipfile

import pytest

from app.services.project_service import ProjectService


def test_save_and_load_json_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()

    payload = {
        "project_id": "abc",
        "selected_page": 2,
        "overlay_scale": 1.2,
        "samples": [{"sample_id": "001"}],
    }

    svc.save_json("abc", payload)
    loaded = svc.load_json("abc")

    assert loaded["selected_page"] == 2
    assert loaded["overlay_scale"] == 1.2
    assert loaded["samples"][0]["sample_id"] == "001"


def test_rejects_invalid_project_id(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()

    try:
        svc.project_dir("../escape")
        assert False, "Expected ValueError for invalid project id"
    except ValueError:
        pass


def test_interrupted_commit_recovers_backup_on_restart(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()
    payload = {"project_id": "abc", "selected_page": 1, "samples": []}
    svc.save_json("abc", payload)
    real_replace = os.replace

    def fail_install_and_rollback(src, dst):
        if src.name in {"s", "b"}:
            raise OSError("injected rename failure")
        real_replace(src, dst)

    with monkeypatch.context() as patch:
        patch.setattr(os, "replace", fail_install_and_rollback)
        with pytest.raises(OSError):
            with svc.staged_project("abc") as (staging, transaction):
                (staging / "project.json").write_text("new", encoding="utf-8")
                svc.commit_staged_project("abc", staging, transaction)
    assert not (tmp_path / "abc").exists()
    assert ProjectService().load_json("abc") == payload


@pytest.mark.parametrize("extra,expected_error", [
    ("duplicate", "duplicate paths"),
    ("unlisted", "file list"),
    ("missing_project_checksum", "file list"),
])
def test_import_rejects_duplicate_or_unchecked_members(tmp_path, monkeypatch, extra, expected_error):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()
    payload = json.dumps({"project_id": "abc", "samples": []}).encode()
    files = {"project.json": hashlib.sha256(payload).hexdigest()}
    if extra == "missing_project_checksum":
        files = {}
    archive_path = tmp_path / "input.hkai"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("project.json", payload)
        if extra == "duplicate":
            with pytest.warns(UserWarning):
                archive.writestr("project.json", b'{"project_id":"abc","samples":[1]}')
        elif extra == "unlisted":
            archive.writestr("samples/001/capture.png", b"unverified")
        archive.writestr("manifest.json", json.dumps({"project_id": "abc", "files": files}))
    with pytest.raises(ValueError, match=expected_error):
        svc.import_archive(archive_path)
    assert not (tmp_path / "abc").exists()


def test_import_accepts_manifest_with_directory_entries(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.project_service.PROJECTS_DIR", tmp_path)
    svc = ProjectService()
    files = {
        "project.json": b'{"project_id":"abc","samples":[]}',
        "samples/001/capture.png": b"capture",
    }
    manifest = {"project_id": "abc", "files": {
        name: hashlib.sha256(content).hexdigest() for name, content in files.items()
    }}
    archive_path = tmp_path / "input.hkai"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("samples/", b"")
        archive.writestr("samples/001/", b"")
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr("manifest.json", json.dumps(manifest))
    assert svc.import_archive(archive_path) == "abc"
    assert (tmp_path / "abc" / "samples" / "001" / "capture.png").read_bytes() == b"capture"
