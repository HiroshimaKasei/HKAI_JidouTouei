from app.services.project_service import ProjectService


def test_save_and_load_json_roundtrip(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "PROJECTS_DIR", tmp_path)
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
    from app import config

    monkeypatch.setattr(config, "PROJECTS_DIR", tmp_path)
    svc = ProjectService()

    try:
        svc.project_dir("../escape")
        assert False, "Expected ValueError for invalid project id"
    except ValueError:
        pass
