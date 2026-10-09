from __future__ import annotations

from app.services.camera_service import CameraService
from app.services.contour_service import ContourService
from app.services.operator_session_service import OperatorSessionService
from app.services.project_service import ProjectService
from app.services.sam_service import SamService
from app.config import OPERATOR_LOCK_TTL_SECONDS


camera_service = CameraService()
contour_service = ContourService()
project_service = ProjectService()
sam_service = SamService()
operator_session_service = OperatorSessionService(ttl_seconds=OPERATOR_LOCK_TTL_SECONDS)
