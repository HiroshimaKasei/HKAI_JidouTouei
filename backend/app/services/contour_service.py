from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import ezdxf
import numpy as np


@dataclass
class ContourExportResult:
    contour_bw_path: Path
    contour_transparent_path: Path
    dxf_path: Path
    outer_contours: list[list[list[float]]]
    hole_contours: list[list[list[float]]]


class ContourService:
    @staticmethod
    def _mask_to_contours(mask: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if hierarchy is None:
            hierarchy = np.empty((1, 0, 4), dtype=np.int32)
        return contours, hierarchy

    @staticmethod
    def _to_xy_lists(contour: np.ndarray) -> list[list[float]]:
        pts = contour[:, 0, :]
        return [[float(p[0]), float(p[1])] for p in pts]

    def export(self, mask: np.ndarray, output_dir: Path, stem: str) -> ContourExportResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        mask_u8 = (mask.astype(np.uint8) * 255)
        contours, hierarchy = self._mask_to_contours(mask_u8)

        h, w = mask_u8.shape[:2]
        contour_bw = np.full((h, w, 3), 255, dtype=np.uint8)
        contour_alpha = np.zeros((h, w, 4), dtype=np.uint8)

        outer_contours: list[list[list[float]]] = []
        hole_contours: list[list[list[float]]] = []

        if len(contours) > 0:
            cv2.drawContours(contour_bw, contours, -1, (0, 0, 0), 1)
            cv2.drawContours(contour_alpha, contours, -1, (0, 0, 0, 255), 1)

            for idx, c in enumerate(contours):
                if len(c) < 3:
                    continue
                parent = hierarchy[0][idx][3] if hierarchy.shape[1] > idx else -1
                points = self._to_xy_lists(c)
                if parent < 0:
                    outer_contours.append(points)
                else:
                    hole_contours.append(points)

        contour_bw_path = output_dir / f"{stem}_contour_bw.png"
        contour_transparent_path = output_dir / f"{stem}_contour_transparent.png"
        cv2.imwrite(str(contour_bw_path), contour_bw)
        cv2.imwrite(str(contour_transparent_path), contour_alpha)

        dxf_path = output_dir / f"{stem}_contour.dxf"
        self._write_dxf(dxf_path, outer_contours, hole_contours, h)

        return ContourExportResult(
            contour_bw_path=contour_bw_path,
            contour_transparent_path=contour_transparent_path,
            dxf_path=dxf_path,
            outer_contours=outer_contours,
            hole_contours=hole_contours,
        )

    @staticmethod
    def _write_dxf(dxf_path: Path, outer: list[list[list[float]]], holes: list[list[list[float]]], image_height: int) -> None:
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()

        def add_closed(points: list[list[float]], layer: str) -> None:
            if len(points) < 3:
                return
            dxf_points = [(p[0], float(image_height) - p[1]) for p in points]
            msp.add_lwpolyline(dxf_points, close=True, dxfattribs={"layer": layer})

        for pts in outer:
            add_closed(pts, "OUTER")
        for pts in holes:
            add_closed(pts, "HOLE")

        doc.saveas(dxf_path)
