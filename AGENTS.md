# AGENTS.md — AI自動投影 (AI Automatic Projection Inspection)

> **Applies to the entire repository.** Instructions for Codex, Claude Code and other coding agents. Read this and `docs/ARCHITECTURE.md` before editing. This document describes the uploaded repository snapshot; verify the current checkout (`git status`, code and tests) before acting.

## 1. Mission and deployment

Build a reliable, approachable Windows 11 factory workstation for overlaying a camera-derived product cross-section onto a projection drawing PDF. The main PC owns the Imaging Source **DFK 33UX178** camera, SAM model, project files and FastAPI server; authorized colleagues connect from browsers on the company LAN. The user-facing name is **AI自動投影**. The interface defaults to Japanese, with English available.

**Important:** This is measurement-adjacent manufacturing software. Do not claim dimensional accuracy from visual alignment alone. A fixed display scale is not a physical calibration.

## 2. Read-first map

| Concern | Source of truth |
|---|---|
| Main inspection workflow, sample inheritance, save/load | `frontend/src/App.tsx` |
| Camera display and SAM click-to-pixel mapping | `frontend/src/components/CameraPanel.tsx` |
| PDF.js rendering, Konva overlay, drag/rotate, recenter | `frontend/src/components/PdfOverlayPanel.tsx` |
| Right-hand segmentation / sample / style controls | `frontend/src/components/InspectionInspector.tsx` |
| UI languages / labels (Japanese first) | `frontend/src/i18n.ts` |
| Three-pane CSS, breakpoints and colors | `frontend/src/styles.css` |
| API client and operator token | `frontend/src/api.ts` |
| Frontend saved-data types | `frontend/src/types/models.ts` |
| Backend schemas and legacy normalization | `backend/app/schemas/models.py`, `backend/app/routers/project.py` |
| Camera ownership, acquisition, rotation | `backend/app/services/camera_service.py` |
| SAM capture/embedding/predictions | `backend/app/services/sam_service.py` |
| Mask->contour->DXF | `backend/app/services/contour_service.py` |
| Local project files and `.hkai` import/export | `backend/app/services/project_service.py` |
| Vector `result.pdf` writer | `backend/app/services/pdf_export_service.py` |
| FastAPI routes, LAN gate, static frontend | `backend/app/main.py`, `backend/app/routers/` |
| Single-operator lease | `backend/app/services/operator_session_service.py` |
| One-time setup and daily launcher | `prepare_lan.bat`, `launch_operator.bat`, `create_desktop_shortcut.bat`, `stop_operator.bat` |

More detailed flow diagrams, endpoints, coordinate spaces and file layouts are in `docs/ARCHITECTURE.md`. See `docs/REVIEW_NOTES.md` for observed risks, not assumptions.

## 3. Non-negotiable behavior contracts

1. **Camera image:** The service rotates native frames **90° clockwise by default**. Both preview and full capture use the same orientation. Native 3072×2048 becomes 2048×3072 at full capture resolution. Never rotate the frontend image again. Uploaded test images currently pass through the same orientation setting.
2. **No camera zoom:** All camera states are fit/contained, without wheel/pinch/keyboard zoom. PDF zoom is a *separate* existing feature and must not be removed accidentally.
3. **SAM prompts:** Left click = positive (1); right click = negative (0) on a frozen capture. Store coordinates in oriented capture-image pixels, not CSS pixels. Account for `object-fit: contain` offsets. Changing panel widths must not shift prompt or mask alignment.
4. **State:** `App.tsx` orchestrates SAM prompts, candidates, selected sample, frozen capture and project state. Keep a single source of truth. Invalidate stale asynchronous predictions on image/source changes; do not remove accepted samples when returning to live mode.
5. **Sample inheritance:** When accepting a *new* contour, inherit **previous sample translation, rotation and scale behavior** exactly as implemented. Replacing an existing sample preserves its placement and style. Never auto-center newly accepted samples.
6. **Recenter intent vs current code:** The product requirement is **viewport-only navigation** (no sample movement). In this snapshot, the code currently violates it: `PdfOverlayPanel.moveSampleToPageCenter()` calls `onUpdateSample` and changes `tx/ty`; its test also expects that. Treat as a **known bug**; update code/tests together when fixing, and do not silently redefine the intended behavior.
7. **Drawing transforms:** Raw SAM contour points and prompts are image pixels; `SampleTransform.tx/ty/rotationDeg`, `overlayScale` and PDF viewport pan/zoom are different concerns. Do not mix viewing transformations with persisted geometry. The current renderer uses a **1000 px display-page width**; PDF-native placement migration is NOT completed.
8. **Style:** Per-sample `SampleStyle` stores `color`, `lineType` (`solid`, `dashed`, `dash_dot`), and `widthMm`. Preserve legacy `transform.color` migration and use consistent previews and PDF exports.
9. **Saving:** Keep the original `source.pdf` and project data; local `data/projects/<id>/` is authoritative. Backend generates `result.pdf` and `<id>.hkai` with checksums. Don't claim cloud upload or finished PDF success based solely on local JSON save. Never destructively migrate existing projects.
10. **Security:** An operator lock and a trusted IP allowlist are NOT user authentication. Do not expose sensitive settings or Drive credentials to browsers. Do not open port 8000 to the internet.
11. **User experience:** Japanese is default; all new user-facing controls need `ja` and `en` translations. Name remains **AI自動投影**. Keep 3 panels: camera left, PDF center, inspector right; no zoom/reconnect on resizing.
12. **No unrelated rewrites:** Preserve the working DFK/IC4, SAM, contour extraction, PDF, `.hkai`, LAN and launcher workflows. Use scoped, testable changes.

## 4. Current feature truth (uploaded ZIP)

**Implemented in source:** three resizable panels; localStorage widths; ja/en switch; live/test image switch; no camera zoom; 90° camera rotation; prompt+SAM acceptance; sample list; line styles; Konva PDF overlay; manual sample drag/rotate; `/api/project/save`, `/load`, `/import`; local `result.pdf` and `.hkai`; FastAPI static LAN server; operator lease.

**Not implemented:** Google Workspace OAuth, administrator authentication, Shared Drive file browser, durable Drive sync/retry/conflict queue, fully PDF-native coordinate migration. Do not write docs or mock UI suggesting they exist. Frontend does not currently provide a `.hkai` file-picker import action even though backend `POST /api/project/import` exists.

## 5. Development and test commands

From repository root on Windows PowerShell (after dependencies are installed):

```powershell
# Backend regression
.\.venv\Scripts\python.exe -m pytest backend/tests -q

# Frontend checks
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build

# One-time install/build for factory PC
.\prepare_lan.bat

# Daily launch / stop
.\launch_operator.bat
.\stop_operator.bat
```

Development mode: `start.bat` or `python backend/run_server.py` from the correct Python/import context plus `npm --prefix frontend run dev` (port 5173). Production LAN: FastAPI serves built `frontend/dist` at port 8000. Backend default LAN host `0.0.0.0`; enforce actual company subnets through `HKAI_TRUSTED_LAN_CIDRS` and Windows Firewall.

Python 3.11 recommended, Node.js 20+. `models/sam_vit_b_01ec64.pth` must be provisioned separately. Camera PC needs ImagingControl4 (currently **not pinned** in backend requirements). SAM uses official ViT-B, with `SAM_DEVICE=auto|cpu|cuda` and lazy model loading. GPU availability and vendor drivers must be verified on the physical PC; CI without camera/CUDA is not hardware validation.

## 6. Testing obligations by area

- **Camera/UI:** `CameraPanel.test.tsx`; simulate portrait/landscape and letterboxed click mapping; wheel must remain normal scrolling. Test source switching, reconnect, no double rotation.
- **Samples/UI:** `App.test.tsx`; preserve inherited `tx/ty/rotationDeg`, frozen-image cancellation and accepted samples, line-style persistence.
- **PDF:** `PdfOverlayPanel.test.tsx`; validate page switching, bounds, pan-only recenter semantics, and no persisted-transform mutation. Add exported-PDF geometry comparisons, including rotated/cropped/multi-page source PDFs.
- **Project:** `backend/tests/test_project_*`; verify JSON/`source.pdf`/captures/masks/contours/DXF/result PDF/archive roundtrip, corrupt archives, checksums, old schema compatibility and safe imports.
- **SAM:** `backend/tests/test_sam_*`; use mocks for heavyweight hardware/model dependencies; don't claim real GPU inference unless executed.
- **LAN/security:** `backend/tests/test_camera_session_deployment.py`; operator exclusivity, CIDR filtering, restart state and not confusing locking with authentication.

**Observed audit (this ZIP):** `PYTHONPATH=backend python -m pytest backend/tests -q` passed **14 tests** in a non-Windows Python 3.13 review environment, with FastAPI `on_event` deprecation warnings. Frontend tests/build were **not run here** because npm offline dependencies were missing; do not mark them passed without running them on an appropriately provisioned machine.

## 7. Change process for future agents

1. Print `git status -sb`, current commit hash and file tree before edits; the upload ZIP has no `.git` metadata, so no commit is inferred from it.
2. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/REVIEW_NOTES.md`; then inspect exact live code and tests for the requested feature.
3. State a short implementation plan and list invariants at risk.
4. Change the smallest cohesive set of files; add bilingual strings when adding UI.
5. Run the relevant frontend/backend tests and build, and report precisely what ran and what did not.
6. Describe schema/API changes, old-project migration, hardware/manual checks, and known risks. Never claim tests you have not run.
7. Never commit models, company source PDFs, real captures, tokens, `data/`, `.venv/`, `frontend/dist/`, server logs or secrets.

## 8. Future Google Drive implementation boundary

Shared Drive is planned, **not present**. Integrate through FastAPI only: an admin-authorized OAuth flow on the main PC; protected server-side refresh-token storage; read-only approved PDF source folder; editable inspection results folder; local-first save plus persistent, restart-safe sync queue; idempotent upload with conflict detection. Configure real Drive IDs through verified admin settings, never hardcode paths or deploy fake OAuth. Ordinary LAN operator clients must not receive Google secrets.
