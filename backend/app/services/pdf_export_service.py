from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import fitz


class PdfExportService:
    DISPLAY_PAGE_WIDTH = 1000.0

    @staticmethod
    def _color(value: str) -> tuple[float, float, float]:
        value = value.lstrip("#")
        if len(value) != 6:
            return (1.0, 0.33, 0.0)
        return tuple(int(value[index : index + 2], 16) / 255 for index in range(0, 6, 2))  # type: ignore[return-value]

    @staticmethod
    def _dashes(line_type: str) -> str | None:
        if line_type == "dashed":
            return "[8 5] 0"
        if line_type == "dash_dot":
            return "[10 4 2 4] 0"
        return None

    def export(self, source_pdf: Path, result_pdf: Path, payload: dict[str, Any]) -> None:
        document = fitz.open(source_pdf)
        try:
            for sample in payload.get("samples", []):
                transform = sample.get("transform", {})
                if transform.get("visible", True) is False:
                    continue
                page_index = int(sample.get("page_number", 1)) - 1
                if page_index < 0 or page_index >= document.page_count:
                    continue
                page = document[page_index]
                style = sample.get("style", {})
                tx = float(transform.get("tx", 0.0))
                ty = float(transform.get("ty", 0.0))
                rotation = math.radians(float(transform.get("rotation_deg", 0.0)))
                scale = float(payload.get("overlay_scale", 1.0))
                contours = [*sample.get("contour_points", []), *sample.get("hole_points", [])]
                all_points = [point for contour in contours for point in contour]
                if not all_points:
                    continue
                cx = sum(float(point[0]) for point in all_points) / len(all_points)
                cy = sum(float(point[1]) for point in all_points) / len(all_points)
                page_rect = page.rect
                page_scale = page_rect.width / self.DISPLAY_PAGE_WIDTH
                page_rotation = page.rotation
                page_matrix = page.rotation_matrix
                # PyMuPDF's rotation translations can omit UserUnit or the effective CropBox intersection.
                page_matrix.e = page_rect.width if page_rotation in (90, 180) else 0
                page_matrix.f = page_rect.height if page_rotation in (180, 270) else 0
                display_to_page = ~page_matrix
                if page_rotation:
                    # Shape's PDF transformation matrix includes CropBox offsets only with rotation cleared.
                    page.set_rotation(0)
                try:
                    for contour in contours:
                        if len(contour) < 2:
                            continue
                        points: list[fitz.Point] = []
                        for point in contour:
                            local_x = (float(point[0]) - cx) * scale
                            local_y = (float(point[1]) - cy) * scale
                            rotated_x = local_x * math.cos(rotation) - local_y * math.sin(rotation)
                            rotated_y = local_x * math.sin(rotation) + local_y * math.cos(rotation)
                            display_point = fitz.Point(
                                (cx + tx + rotated_x) * page_scale,
                                (cy + ty + rotated_y) * page_scale,
                            )
                            points.append(display_point * display_to_page)
                        shape = page.new_shape()
                        shape.draw_polyline(points)
                        shape.finish(
                            color=self._color(str(style.get("color", transform.get("color", "#ff5500")))),
                            width=float(style.get("width_mm", 0.35)) * 72.0 / 25.4,
                            dashes=self._dashes(str(style.get("line_type", "solid"))),
                            closePath=True,
                        )
                        shape.commit()
                finally:
                    if page_rotation:
                        page.set_rotation(page_rotation)
            document.save(result_pdf, garbage=4, deflate=True)
        finally:
            document.close()
