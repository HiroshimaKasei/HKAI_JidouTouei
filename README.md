# AI自動投影

**AI Automatic Projection Inspection** — A Windows-based camera/SAM-to-PDF overlay workstation for production profile inspection, with a browser interface accessible from authorized company LAN computers.

> This README documents the **uploaded repository snapshot**. For development contracts, read [`AGENTS.md`](AGENTS.md); for file/data/control flow, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Known issues and unimplemented plans are in [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md).

## What the application does

The central factory PC acquires frames from an Imaging Source DFK 33UX178 camera, rotates them **90° clockwise by default**, and displays the full portrait view without camera zoom. The operator freezes a full-resolution image, adds positive and negative SAM prompts, reviews segmentation candidates, accepts contours (including holes), and positions the contours over a source PDF drawing. Saved samples keep translation, rotation, visibility, a page number and per-sample line styles (solid/dashed/dash-dot, color and width in mm).

The current UI uses **Camera | PDF Overlay | Inspector** resizable panels. Languages: Japanese (default) and English. The application is named **AI自動投影** in both. The *PDF* workspace supports zoom and pan; the *camera* viewer does not.

### Features available in this snapshot

- React 18 + Vite + TypeScript, `react-pdf`/PDF.js and React-Konva.
- FastAPI backend with ImagingControl4 camera service, official SAM ViT-B and OpenCV contour extraction.
- Live/test image switching, full-resolution capture, click prompting and SAM candidate selection.
- PDF overlay sample move/rotate, per-sample styles, multi-page assignments, sample selection and previous-sample placement inheritance.
- Local project save/load and backend `.hkai` ZIP archive import/export; source PDF, PNG captures/masks, DXF and `result.pdf` vector output.
- Single active operator lease; LAN allowlist; one-click Windows daily launch.

### Not available yet

Google Drive OAuth, Shared Drive browsing/synchronization, administrator authentication, stable PDF-native coordinate migration, and a frontend `.hkai` import button. A backend `/api/project/import` endpoint exists, but the current Load button lists local projects and prompts for an ID. See [Review Notes](docs/REVIEW_NOTES.md).

## Hardware and software

- Main machine: **Windows 11**, Python **3.11 recommended**, Node.js **20+** for building.
- Imaging Source **DFK 33UX178** camera and matching ImagingControl4 driver/SDK for camera work. Tests without hardware cannot verify USB acquisition.
- SAM ViT-B checkpoint: `models/sam_vit_b_01ec64.pth` (not committed).
- Torch 2.9 dependency and a suitable CUDA build/driver for the GPU; if unavailable, `SAM_DEVICE=auto` falls back to CPU. Do not assume a CPU installation has GPU acceleration.

## First-time Windows installation

From the repository root:

1. Install Python 3.11 and Node.js 20+.
2. Run **`prepare_lan.bat`** (creates `.venv`, installs Python packages, downloads frontend npm packages if absent, builds production React frontend).
3. On the main camera PC, verify ImagingControl4 Python bindings in the project's venv (they are **not** included in `backend/requirements.txt` in this snapshot):

   ```powershell
   .\.venv\Scripts\python.exe -m pip install imagingcontrol4
   .\.venv\Scripts\python.exe -c "import imagingcontrol4 as ic4; ic4.Library.init(); print(ic4.DeviceEnum.devices())"
   ```

4. Put the official SAM checkpoint at `models/sam_vit_b_01ec64.pth` and verify PyTorch's CPU/CUDA setup.
5. Run **`create_desktop_shortcut.bat`** once. It creates `AI自動投影.lnk` on the current user's Windows desktop.

> Follow company security rules for software installation and camera access. The ZIP archive does not contain the trained SAM weights.

## Daily operation

- Main PC: double-click **AI自動投影** desktop shortcut (or `launch_operator.bat`). It starts the prepared FastAPI server when needed and opens `http://127.0.0.1:8000`.
- Other approved company PC: open `http://<MAIN-PC-LAN-IP>:8000` in a browser. They need no Python, Node.js or camera drivers.
- Stop: `stop_operator.bat` on the server PC; closing a browser tab alone does not stop the backend.
- After source code/dependency updates: rerun `prepare_lan.bat` before `launch_operator.bat`.
- Dev server: `start.bat` launches development mode (frontend Vite port 5173, backend port 8000). Production uses port 8000 for both API and built frontend.

### Operator inspection flow

1. Select **Open PDF / PDFを開く** and choose a source drawing.
2. Inspect live camera or **Open Image / 画像を開く**, then **Capture / 撮影**.
3. On frozen image, left click to add positive prompts; right click for negative prompts; select a SAM candidate and **Accept Mask / マスクを確定**.
4. In the center PDF, drag accepted samples to translate, right-drag to rotate. New samples inherit the **previous sample's position/rotation**; don't auto-center them.
5. In the right inspector, choose sample visibility, line colors, solid/dashed/dash-dot type and width, plus the existing overlay scale.
6. **Save / 保存** persists to the main PC's `data/projects/<project_id>/`. Backend produces `result.pdf` and `<project_id>.hkai` when possible. These are retrievable through backend URLs, not yet a full export UI.
7. **Load / 読み込み** reloads a local project by ID. The backend has `.hkai` import API support but the current frontend has no archive file-picker.

**Warning:** The current **Recenter Contour** control changes persisted sample translation rather than viewport pan. It is a known discrepancy from the intended view-only behavior. Check alignment after using it until corrected.

## Repository map

```text
frontend/src/
  App.tsx                      main workflow/state, three-pane layout
  api.ts                      FastAPI calls and operator token
  i18n.ts                     Japanese/English dictionary
  types/models.ts             sample/line-style types
  components/
    CameraPanel.tsx           live/captured view and SAM prompt mapping
    PdfOverlayPanel.tsx       PDF.js, Konva overlay, recenter/drag/rotate
    InspectionInspector.tsx   SAM controls, samples, line styles
  styles.css                  corporate colors, resizing, responsive layout
backend/
  app/main.py                 FastAPI app, LAN gate, static assets
  app/routers/                camera, SAM, project, session and health
  app/services/               camera, SAM, contour/DXF, PDF export, project, lock
  app/schemas/models.py       Pydantic project payloads
  run_server.py               production uvicorn entrypoint
  tests/                      pytest tests
prepare_lan.bat               one-time setup/build
launch_operator.bat            daily launcher
create_desktop_shortcut.bat    Windows shortcut
stop_operator.bat              stop launcher-managed backend
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full sequence, saved project structure, endpoints and coordinate rules.

## Configuration

| Variable | Meaning |
|---|---|
| `SAM_DEVICE` | `auto` (default), `cpu`, or `cuda` |
| `HKAI_HOST` | Production listen address; default `0.0.0.0` |
| `HKAI_PORT` | Production port; default `8000` |
| `HKAI_TRUSTED_LAN_CIDRS` | Allowed client IP networks; defaults include RFC1918 ranges and loopback — restrict to real company subnets |
| `HKAI_OPERATOR_LOCK_TTL_SECONDS` | Operator lease TTL (default 300 seconds) |
| `VITE_API_BASE` | Optional frontend API override; production normally uses same origin |

Bind LAN port 8000 only within approved company network segments and scope Windows Firewall rules accordingly. The CIDR gate and operator lock are **not** user authentication. Never expose the app to the public Internet.

## Tests

Run in the repo root after installing the relevant dependencies:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build
```

**Audit of uploaded ZIP:** backend pytest **14 passed** (Python 3.13 review environment, without physical IC4 camera); frontend tests/build could not be rerun because npm packages were unavailable offline. These are environment-limited findings, not an assertion that production hardware has been validated.

## Development guidance

Agent instructions: [`AGENTS.md`](AGENTS.md). Architecture and API: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Verified gaps and proposed priorities: [`docs/REVIEW_NOTES.md`](docs/REVIEW_NOTES.md). The repository root and internal API names remain `HKAI_*` for compatibility, even though the displayed application name is **AI自動投影**.
