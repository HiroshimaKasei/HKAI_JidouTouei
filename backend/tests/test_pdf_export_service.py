from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app.services.pdf_export_service import PdfExportService


def _source_pdf(path: Path, pages: list[tuple[int, int, int, tuple[int, int, int, int] | None]]) -> bytes:
    document = fitz.open()
    try:
        for index, (width, height, rotation, crop) in enumerate(pages):
            page = document.new_page(width=width, height=height)
            page.insert_text((100, 150), f"Source page {index + 1}")
            if crop:
                page.set_cropbox(fitz.Rect(crop))
            page.set_rotation(rotation)
        document.save(path)
    finally:
        document.close()
    return path.read_bytes()


def _sample(page: int = 1, **overrides: object) -> dict:
    return {
        "page_number": page,
        "contour_points": [[[100, 100], [200, 100], [150, 200]]],
        "hole_points": [],
        **overrides,
    }


def _assert_lines(drawing: dict, expected: list[tuple[float, float]]) -> None:
    items = drawing["items"]
    assert len(items) == len(expected)
    for index, item in enumerate(items):
        assert item[0] == "l"
        assert tuple(item[1]) == pytest.approx(expected[index], abs=0.01)
        assert tuple(item[2]) == pytest.approx(expected[(index + 1) % len(expected)], abs=0.01)


@pytest.mark.parametrize(
    ("visibility", "expected_counts"),
    [
        ((True, True), (1, 1)),
        ((False, False), (0, 0)),
        ((True, False), (1, 0)),
        ((False, True), (0, 1)),
    ],
)
def test_visibility_exports_real_pdf_without_changing_source(
    tmp_path: Path, visibility: tuple[bool, bool], expected_counts: tuple[int, int]
) -> None:
    source = tmp_path / "source.pdf"
    result = tmp_path / "result.pdf"
    source_bytes = _source_pdf(source, [(500, 700, 0, None), (800, 600, 0, None)])
    samples = [
        _sample(1, transform={"visible": visibility[0]}, style={"color": "#ff0000"}),
        _sample(2, transform={"visible": visibility[1]}, style={"color": "#0000ff"}),
    ]

    PdfExportService().export(source, result, {"samples": samples})

    assert source.read_bytes() == source_bytes
    with fitz.open(source) as original, fitz.open(result) as document:
        assert document.page_count == 2
        for index, expected in enumerate(expected_counts):
            page = document[index]
            assert f"Source page {index + 1}" in page.get_text()
            assert len(page.get_drawings()) == expected
            same_pixels = page.get_pixmap().samples == original[index].get_pixmap().samples
            assert same_pixels == (expected == 0)
            if expected:
                assert page.get_drawings()[0]["color"] == pytest.approx(
                    (1, 0, 0) if index == 0 else (0, 0, 1)
                )


def test_legacy_defaults_and_invalid_pages(tmp_path: Path) -> None:
    source, result = tmp_path / "source.pdf", tmp_path / "result.pdf"
    _source_pdf(source, [(500, 700, 0, None)])
    samples = [
        _sample(transform={"color": "#0099ff"}),
        _sample(transform={"tx": 200}),
        _sample(contour_points=[[[300, 100], [400, 100], [350, 200]]]),
        _sample(0),
        _sample(2),
    ]
    samples[0].pop("page_number")

    PdfExportService().export(source, result, {"samples": samples})

    with fitz.open(result) as document:
        drawings = document[0].get_drawings()
        assert len(drawings) == 3
        assert drawings[0]["color"] == pytest.approx((0, 0.6, 1))
        assert drawings[1]["color"] == pytest.approx((1, 1 / 3, 0), abs=0.001)
        assert drawings[0]["width"] == pytest.approx(0.35 * 72 / 25.4, abs=0.001)
        assert drawings[0]["dashes"] == "[] 0"
        _assert_lines(drawings[0], [(50, 50), (100, 50), (75, 100)])
        _assert_lines(drawings[1], [(150, 50), (200, 50), (175, 100)])
        _assert_lines(drawings[2], [(150, 50), (200, 50), (175, 100)])


def test_hidden_contours_and_holes_do_not_hide_other_page_content(tmp_path: Path) -> None:
    source, result = tmp_path / "source.pdf", tmp_path / "result.pdf"
    document = fitz.open()
    try:
        page = document.new_page(width=500, height=700)
        page.draw_line((20, 20), (40, 40), color=(0, 0, 0))
        document.save(source)
    finally:
        document.close()
    source_bytes = source.read_bytes()
    samples = [
        _sample(style={"color": "#00ff00"}),
        _sample(
            transform={"visible": False},
            contour_points=[[[300, 300], [400, 300], [350, 400]]],
            hole_points=[[[330, 330], [370, 330], [350, 370]]],
            style={"color": "#ff0000"},
        ),
    ]

    PdfExportService().export(source, result, {"samples": samples})

    assert source.read_bytes() == source_bytes
    with fitz.open(result) as document:
        drawings = document[0].get_drawings()
        assert len(drawings) == 2
        assert drawings[0]["color"] == pytest.approx((0, 0, 0))
        assert drawings[1]["color"] == pytest.approx((0, 1, 0))


@pytest.mark.parametrize(
    ("line_type", "dashes"),
    [("solid", "[] 0"), ("dashed", "[ 8 5 ] 0"), ("dash_dot", "[ 10 4 2 4 ] 0")],
)
def test_geometry_and_line_styles(tmp_path: Path, line_type: str, dashes: str) -> None:
    source, result = tmp_path / "source.pdf", tmp_path / "result.pdf"
    _source_pdf(source, [(500, 700, 0, None)])
    sample = _sample(
        contour_points=[[[100, 100], [200, 100], [150, 250]]],
        hole_points=[[[140, 130], [160, 130], [150, 190]]],
        transform={"tx": 50, "ty": 30, "rotation_deg": 90, "color": "#ff0000"},
        style={"color": "#00cc66", "line_type": line_type, "width_mm": 0.5},
    )

    PdfExportService().export(source, result, {"overlay_scale": 2, "samples": [sample]})

    with fitz.open(result) as document:
        drawings = document[0].get_drawings()
        assert len(drawings) == 2
        _assert_lines(drawings[0], [(150, 40), (150, 140), (0, 90)])
        _assert_lines(drawings[1], [(120, 80), (120, 100), (60, 90)])
        for drawing in drawings:
            assert drawing["color"] == pytest.approx((0, 0.8, 0.4))
            assert drawing["width"] == pytest.approx(0.5 * 72 / 25.4, abs=0.001)
            assert drawing["dashes"] == dashes


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize(
    ("media", "crop", "raw_crop", "user_unit"),
    [
        ((0, 0, 600, 800), None, None, 1),
        ((20, 30, 620, 830), (70, 100, 570, 700), None, 1),
        ((-150, -90, 450, 710), (-100, 100, 400, 700), None, 1),
        ((0, 0, 600, 800), (50, 100, 550, 700), None, 2),
        ((0, 0, 600, 800), (50, 100, 550, 700), None, 0.5),
        ((0, 0, 600, 800), None, "[-100 -100 500 700]", 1),
        ((0, 0, 600, 800), None, "[50 100 900 900]", 2),
    ],
)
def test_display_geometry_with_rotation_crop_and_origin(
    tmp_path: Path,
    rotation: int,
    media: tuple[int, int, int, int],
    crop: tuple[int, int, int, int] | None,
    raw_crop: str | None,
    user_unit: float,
) -> None:
    source, result = tmp_path / "source.pdf", tmp_path / "result.pdf"
    document = fitz.open()
    try:
        page = document.new_page(width=600, height=800)
        page.set_mediabox(fitz.Rect(media))
        page.draw_line((20, 20), (40, 40), color=(0, 0, 0))
        if crop:
            page.set_cropbox(fitz.Rect(crop))
        if raw_crop:
            document.xref_set_key(page.xref, "CropBox", raw_crop)
        document.xref_set_key(page.xref, "UserUnit", str(user_unit))
        page.set_rotation(rotation)
        document.save(source)
    finally:
        document.close()
    source_bytes = source.read_bytes()
    sample = _sample(
        contour_points=[[[100, 100], [200, 100], [150, 250]]],
        hole_points=[[[140, 130], [160, 130], [150, 190]]],
        transform={"tx": 150, "ty": 30, "rotation_deg": 90},
        style={"color": "#ff0000", "width_mm": 0.5},
    )
    PdfExportService().export(source, result, {"overlay_scale": 2, "samples": [sample]})

    assert source.read_bytes() == source_bytes
    expected = [
        [(400, 80), (400, 280), (100, 180)],
        [(340, 160), (340, 200), (220, 180)],
    ]
    with fitz.open(source) as original, fitz.open(result) as exported:
        page = exported[0]
        assert page.rotation == rotation
        assert tuple(page.mediabox) == pytest.approx(tuple(original[0].mediabox))
        assert tuple(page.cropbox) == pytest.approx(tuple(original[0].cropbox))
        assert exported.xref_get_key(page.xref, "UserUnit") == original.xref_get_key(original[0].xref, "UserUnit")
        width, height = page.rect.width, page.rect.height
        assert (width, height) == pytest.approx((original[0].rect.width, original[0].rect.height))
        pixels = page.get_pixmap(matrix=fitz.Matrix(1000 / width, 1000 / width))
        samples = pixels.samples
        reds = {
            (i // pixels.n % pixels.width, i // pixels.n // pixels.width)
            for i in range(0, len(samples), pixels.n)
            if samples[i] > 180 and samples[i + 1] < 100 and samples[i + 2] < 100
        }
        assert reds
        assert min(x for x, _ in reds) == pytest.approx(100, abs=5)
        assert max(x for x, _ in reds) == pytest.approx(400, abs=5)
        assert min(y for _, y in reds) == pytest.approx(80, abs=5)
        assert max(y for _, y in reds) == pytest.approx(280, abs=5)
        for contour in expected:
            for start, end in zip(contour, contour[1:] + contour[:1]):
                midpoint = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
                assert any(abs(x - midpoint[0]) <= 3 and abs(y - midpoint[1]) <= 3 for x, y in reds)

        page.set_rotation(0)
        drawings = page.get_drawings()
        assert len(drawings) == 3  # Original black line plus outer and hole strokes.
        for drawing, contour in zip(drawings[1:], expected):
            items = drawing["items"]
            assert len(items) == 3
            for item, (x, y) in zip(items, contour):
                assert item[0] == "l"
                point = item[1]
                if rotation == 90:
                    displayed = (width - point.y, point.x)
                elif rotation == 180:
                    displayed = (width - point.x, height - point.y)
                elif rotation == 270:
                    displayed = (point.y, height - point.x)
                else:
                    displayed = (point.x, point.y)
                assert displayed == pytest.approx((x * width / 1000, y * width / 1000), abs=0.01)


def test_mixed_samples_on_rotated_pages_of_different_widths(tmp_path: Path) -> None:
    source, result = tmp_path / "source.pdf", tmp_path / "result.pdf"
    source_bytes = _source_pdf(
        source, [(600, 800, 90, (50, 100, 550, 700)), (900, 950, 270, None)]
    )
    samples = [
        _sample(1, style={"color": "#ff0000", "width_mm": 1}),
        _sample(1, transform={"tx": 250}, style={"color": "#0000ff", "width_mm": 1}),
        _sample(1, transform={"visible": False}, style={"color": "#00ff00"}),
        _sample(2, style={"color": "#00ff00", "width_mm": 1}),
        _sample(2, transform={"visible": False}, style={"color": "#ff0000"}),
    ]
    PdfExportService().export(source, result, {"samples": samples})

    assert source.read_bytes() == source_bytes
    with fitz.open(source) as original, fitz.open(result) as exported:
        assert [page.rect.width for page in exported] == [600, 950]
        for index, page in enumerate(exported):
            assert page.rotation == original[index].rotation
            assert page.get_text() == original[index].get_text()
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1000 / page.rect.width, 1000 / page.rect.width))
            samples = pixmap.samples
            positions = {"red": [], "green": [], "blue": []}
            for i in range(0, len(samples), pixmap.n):
                r, g, b = samples[i : i + 3]
                position = (i // pixmap.n % pixmap.width, i // pixmap.n // pixmap.width)
                if r > 180 and g < 100 and b < 100:
                    positions["red"].append(position)
                elif g > 180 and r < 100 and b < 100:
                    positions["green"].append(position)
                elif b > 180 and r < 100 and g < 100:
                    positions["blue"].append(position)
            expected_colors = {"red": 100, "blue": 350} if index == 0 else {"green": 100}
            for color, points in positions.items():
                if color in expected_colors:
                    assert points
                    assert min(x for x, _ in points) == pytest.approx(expected_colors[color], abs=6)
                else:
                    assert not points
