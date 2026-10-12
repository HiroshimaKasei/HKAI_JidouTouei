from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PromptPoint(BaseModel):
    x: float
    y: float
    label: Literal[0, 1]


class PrepareEmbeddingRequest(BaseModel):
    capture_id: str


class PredictRequest(BaseModel):
    capture_id: str
    points: list[PromptPoint] = Field(default_factory=list)
    request_id: int = 0


class AcceptMaskRequest(BaseModel):
    capture_id: str
    request_id: int
    candidate_index: int


class RegisterCaptureImageRequest(BaseModel):
    image_png_hex: str


class SampleFileRefs(BaseModel):
    capture: str = ""
    mask: str = ""
    contour_bw: str = ""


class SampleTransform(BaseModel):
    tx: float = 0.0
    ty: float = 0.0
    rotation_deg: float = 0.0
    visible: bool = True
    color: str = "#ff5500"


class SampleStyle(BaseModel):
    color: str = "#ff5500"
    line_type: Literal["solid", "dashed", "dash_dot"] = "solid"
    width_mm: float = Field(default=0.35, gt=0.0, le=10.0)


class SaveSamplePayload(BaseModel):
    sample_id: str
    capture_id: str
    page_number: int = 1
    width: int
    height: int
    prompts: list[PromptPoint] = Field(default_factory=list)
    contour_points: list[list[list[float]]] = Field(default_factory=list)
    hole_points: list[list[list[float]]] = Field(default_factory=list)
    files: SampleFileRefs = Field(default_factory=SampleFileRefs)
    transform: SampleTransform = Field(default_factory=SampleTransform)
    style: SampleStyle = Field(default_factory=SampleStyle)


class SaveProjectPayload(BaseModel):
    project_id: str
    selected_page: int
    overlay_scale: float = 1.0
    schema_version: int = 2
    project_name: str = ""
    source_pdf_hash: str = ""
    source_drive_file_id: str = ""
    samples: list[SaveSamplePayload] = Field(default_factory=list)


class LoadProjectResponse(BaseModel):
    project_id: str
    selected_page: int
    overlay_scale: float
    source_pdf_url: str
    samples: list[SaveSamplePayload]
