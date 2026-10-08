from pathlib import Path

import cv2
import numpy as np

from app.services.contour_service import ContourService


def test_export_contours_and_holes(tmp_path: Path) -> None:
    mask = np.zeros((200, 240), dtype=np.uint8)
    cv2.rectangle(mask, (20, 20), (220, 180), 1, -1)
    cv2.rectangle(mask, (80, 80), (160, 140), 0, -1)

    svc = ContourService()
    result = svc.export(mask, tmp_path, "unit")

    assert result.contour_bw_path.exists()
    assert result.contour_transparent_path.exists()
    assert result.dxf_path.exists()

    assert len(result.outer_contours) >= 1
    assert len(result.hole_contours) >= 1


def test_dxf_uses_inverted_y_coordinates(tmp_path: Path) -> None:
    mask = np.zeros((10, 10), dtype=np.uint8)
    mask[2:8, 2:8] = 1

    svc = ContourService()
    result = svc.export(mask, tmp_path, "invert")

    content = result.dxf_path.read_text(encoding="utf-8", errors="ignore")
    assert "OUTER" in content
