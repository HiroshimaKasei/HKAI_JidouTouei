# HKAI_JidouTouei

MVP implementation for local factory-side PDF overlay alignment using camera capture, interactive SAM segmentation, contour export, and project save/load.

## Scope implemented

- Local/LAN architecture: FastAPI backend serves API and production frontend from one Windows PC.
- PDF viewing (PDF.js via react-pdf): page selection, pan, zoom.
- Camera panel with live preview polling, capture freeze, and explicit TEST MODE image upload.
- Interactive click prompting for SAM (positive/negative points), undo/reset/redo prompt flow, candidate selection, accept mask.
- Mask acceptance pipeline: binary mask preservation, contour extraction with holes, black-white contour PNG, transparent contour PNG, DXF LWPOLYLINE export with Y inversion.
- Overlay samples on PDF with independent per-sample translate/rotate/visibility/color.
- Multiple samples per PDF page.
- Project save/load to local folders with editable state.
- Single active operator session lock for mutating inspection actions.

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

4. Select SAM device mode (default is auto):

```powershell
# auto: use CUDA if available, else CPU
$env:SAM_DEVICE="auto"

# force CPU
$env:SAM_DEVICE="cpu"

# force CUDA (errors if CUDA is unavailable)
$env:SAM_DEVICE="cuda"
```

5. Development mode (localhost):

```powershell
start.bat
```

6. Production LAN mode (single server on main PC):

```powershell
start_lan.bat
```

Notes:

- `start_lan.bat` installs dependencies, builds the Vite frontend, and starts one FastAPI server bound to `0.0.0.0`.
- Startup prints local and detected LAN URL(s), for example `http://192.168.x.x:8000`.
- Client PCs only need a browser. They do not need Python, Node.js, or camera drivers.
- All project files remain stored on the main server PC under `data/projects/`.

Or manually:

```powershell
cd backend
python run_server.py
```

```powershell
cd frontend
npm run dev
```

Environment variables used by LAN mode:

- `HKAI_HOST` (default `0.0.0.0`)
- `HKAI_PORT` (default `8000`)
- `HKAI_TRUSTED_LAN_CIDRS` (default private ranges + loopback)
- `HKAI_OPERATOR_LOCK_TTL_SECONDS` (default `300`)

## LAN security and firewall

- The server rejects requests whose client IP is outside `HKAI_TRUSTED_LAN_CIDRS`.
- CORS remains restricted to local dev origins (`127.0.0.1:5173`, `localhost:5173`) and is not wildcard.
- For LAN use, do not expose this host/port to the public internet.

Recommended Windows Firewall inbound rule (main server PC):

1. Open `Windows Defender Firewall with Advanced Security`.
2. Create a new `Inbound Rule` for `TCP` port `8000` (or your `HKAI_PORT`).
3. Set `Action` to `Allow the connection`.
4. Apply only to `Domain` profile (and `Private` if needed).
5. In `Scope`, set `Remote IP address` to `These IP addresses` and add only your company subnet(s), for example `192.168.10.0/24`.
6. Do not enable the rule for `Public` profile.

## Multi-user safety

- Only one active inspection operator token is allowed at a time.
- Mutating operations (`capture`, `SAM prepare/predict/accept`, project save, test-image updates) require that token.
- Other browser sessions can view data but cannot overwrite active inspection state until the lock expires or is released.

## SAM runtime policy and verification

- Official Meta SAM ViT-B is used in all modes.
- `SAM_DEVICE=auto` uses CUDA when operational and falls back to CPU when CUDA is unavailable.
- `SAM_DEVICE=cpu` forces CPU and does not call CUDA functions.
- `SAM_DEVICE=cuda` requires working CUDA and reports clear errors if unavailable.
- The SAM checkpoint is loaded once per backend process and reused.
- Per-capture image embeddings are cached and reused for prompt refinement.

Suggested command to validate GPU in your environment:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0), torch.version.cuda, torch.__version__)"
```

For RTX 5070 target workflow, use a CUDA/PyTorch build that supports Blackwell architecture on your machine/driver stack.

## API summary

- GET /api/health/
- GET /api/session/status
- POST /api/session/claim
- POST /api/session/heartbeat
- POST /api/session/release
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
- concurrent multi-operator editing
- non-SAM segmentation models