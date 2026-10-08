from __future__ import annotations

from app.services.camera_service import CameraService
from app.services.contour_service import ContourService
from app.services.project_service import ProjectService
from app.services.sam_service import SamService


camera_service = CameraService()
contour_service = ContourService()
project_service = ProjectService()
sam_service = SamService()
