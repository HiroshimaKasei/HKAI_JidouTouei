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


class SampleTransform(BaseModel):
    tx: float = 0.0
    ty: float = 0.0
    rotation_deg: float = 0.0
    visible: bool = True
    color: str = "#ff5500"


class SaveSamplePayload(BaseModel):
    sample_id: str
    capture_id: str
    width: int
    height: int
    prompts: list[PromptPoint] = Field(default_factory=list)
    contour_points: list[list[list[float]]] = Field(default_factory=list)
    hole_points: list[list[list[float]]] = Field(default_factory=list)
    transform: SampleTransform = Field(default_factory=SampleTransform)


class SaveProjectPayload(BaseModel):
    project_id: str
    selected_page: int
    overlay_scale: float = 1.0
    samples: list[SaveSamplePayload] = Field(default_factory=list)


class LoadProjectResponse(BaseModel):
    project_id: str
    selected_page: int
    overlay_scale: float
    source_pdf_url: str
    samples: list[SaveSamplePayload]
