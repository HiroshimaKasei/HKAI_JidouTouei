# HKAI_JidouTouei

MVP implementation for local factory-side PDF overlay alignment using camera capture, interactive SAM segmentation, contour export, and project save/load.

## Scope implemented

- Local-only architecture: FastAPI backend + React/TypeScript frontend on 127.0.0.1.
- PDF viewing (PDF.js via react-pdf): page selection, pan, zoom.
- Camera panel with live preview polling, capture freeze, and explicit TEST MODE image upload.
- Interactive click prompting for SAM (positive/negative points), undo/reset/redo prompt flow, candidate selection, accept mask.
- Mask acceptance pipeline: binary mask preservation, contour extraction with holes, black-white contour PNG, transparent contour PNG, DXF LWPOLYLINE export with Y inversion.
- Overlay samples on PDF with independent per-sample translate/rotate/visibility/color.
- Multiple samples per PDF page.
- Project save/load to local folders with editable state.

## Repository structure

- backend/app/main.py: FastAPI app and router registration.
- backend/app/routers/: camera, SAM, project, health endpoints.
- backend/app/services/: camera, SAM, contour/DXF, project persistence services.
- backend/tests/: focused backend unit tests.
- frontend/src/App.tsx: operator workflow and state orchestration.
- frontend/src/components/CameraPanel.tsx: camera/prompt interaction view.
- frontend/src/components/PdfOverlayPanel.tsx: PDF render and Konva overlays.
- start.bat: local startup helper.

## Requirements

- Windows 11
- Python 3.11 recommended
- Node.js 20+ (for frontend build/dev)
- NVIDIA GPU with CUDA runtime compatible with your PyTorch build
- SAM ViT-B checkpoint file

## Setup

1. Create/install Python environment (3.11):

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

2. Install frontend dependencies:

```powershell
npm --prefix frontend install
```

3. Download SAM checkpoint:

- Put the official ViT-B checkpoint at:
	- models/sam_vit_b_01ec64.pth

4. Run backend and frontend:

```powershell
start.bat
```

Or manually:

```powershell
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
npm run dev
```

## GPU policy and verification

- This MVP does not silently fall back to CPU for SAM.
- Backend validates CUDA availability and runs a real GPU tensor matmul before SAM model load.
- If GPU/CUDA is not ready, SAM endpoints return explicit errors while API remains up.

Suggested command to validate GPU in your environment:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0), torch.version.cuda, torch.__version__)"
```

For RTX 5070 target workflow, use a CUDA/PyTorch build that supports Blackwell architecture on your machine/driver stack.

## API summary

- GET /api/health/
- GET /api/camera/status
- GET /api/camera/frame
- POST /api/camera/test-image
- POST /api/camera/capture
- POST /api/sam/register-image
- POST /api/sam/prepare
- POST /api/sam/predict
- POST /api/sam/accept
- GET /api/project/list
- POST /api/project/save
- GET /api/project/load/{project_id}
- GET /api/project/{project_id}/source.pdf
- GET /api/project/{project_id}/samples/{sample_id}/{name}

## Project storage

Saved under:

data/projects/<project_id>/

Includes:

- source.pdf
- project.json
- samples/<sample_id>/capture.png
- samples/<sample_id>/mask.png
- samples/<sample_id>/contour_bw.png
- samples/<sample_id>/contour.dxf

Notes:

- DXF coordinates are unitless pixel-derived values.
- Y-axis inversion is applied for Cartesian export.

## Tests

Run backend tests:

```powershell
python -m pytest backend/tests -q
```

Covered:

- contour extraction includes holes and output files
- DXF generation path
- project JSON save/load roundtrip

## Current limitations

- IC4 camera service is scaffolded with explicit TEST MODE fallback; the exact DFK 33UX178 acquisition call path is not fully hardware-validated in this environment.
- Frontend build/test execution requires Node.js/npm to be installed locally.
- Python 3.11 is required for target runtime; this development environment executed tests on Python 3.10.
- No calibration/mm conversion is implemented (by design for this MVP).

## Out of scope intentionally excluded

- ChArUco calibration
- millimeter measurements
- automatic alignment
- OK/NG inspection
- cloud storage
- database server
- multi-user networking
- non-SAM segmentation models