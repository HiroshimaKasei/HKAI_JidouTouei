# Architecture & Data Contracts — AI自動投影

> Grounded in the uploaded repository snapshot. Not a claim of a particular Git commit or deployed Windows state.

## 1. Runtime deployment

```text
Company LAN browsers
    │ HTTP to main PC :8000 (same origin)
    ▼
FastAPI app (backend/app/main.py)
    ├── /api/health + session operator lease
    ├── /api/camera => CameraService => IC4 DFK 33UX178
    ├── /api/sam => SamService => PyTorch + official SAM ViT-B
    ├── /api/project => ProjectService + PdfExportService + ContourService
    └── / => frontend/dist React SPA (built by Vite)
                     |
                     ├── CameraPanel (live or frozen prompt canvas)
                     ├── PdfOverlayPanel (PDF.js + Konva)
                     ├── SegmentationControls (camera-side SAM controls)
                     └── InspectionInspector (samples and styles)
```

The FastAPI process creates singleton services in `backend/app/state.py`. Run **one backend worker** by design: camera, SAM capture state and operator lock are process-local. Multiple Uvicorn workers would break that assumption unless state is externalized.

## 2. Operator and source flow

```text
App.tsx -> api.ts -> FastAPI
  GET /api/camera/status             checks IC4 / test-image state
  GET /api/camera/frame              JPEG, downscaled preview
  POST /api/camera/test-image        switches to uploaded image mode
  POST /api/camera/test-image/clear  returns to physical camera
  POST /api/camera/orientation       rotates 0/90/180/270 (default 90)
  POST /api/camera/capture           full-res rotated PNG hex + capture ID
  POST /api/sam/prepare              cache SAM embedding for capture
  POST /api/sam/predict              prompt points -> mask candidates
  POST /api/sam/accept               accepted mask + contours
```

Mutation endpoints require `X-Operator-Token`, obtained from `/api/session/claim` and renewed through `/api/session/heartbeat`; `/release` relinquishes it. Read endpoints are subject to the trusted-LAN IP check but not general user login. Distinguish this safety mechanism from authentication/authorization.

## 3. Image-space and PDF-space contracts

### Image

- Physical camera frame native orientation is 3072×2048 (nominal DFK IMX178). `CameraService._rotate` is applied consistently for preview and capture, with default `orientation_deg=90`; full capture is thus nominally 2048×3072.
- Preview is constrained by `get_live_preview_frame(max_width=1280)` and delivered as JPEG. The SAM capture remains original rotated image size and is PNG-encoded.
- `CameraPanel.imageLayout()` computes containment factor `min(canvas_w/image_w, canvas_h/image_h)` plus offset; pointer positions are inverted into frozen-image pixel coordinates before prompting. No camera zoom.
- `PromptPoint.label`: 1 positive, 0 negative. SAM masks, prompts, contour points and saved capture must share one orientation.

### PDF & Konva

- Current `PdfOverlayPanel.tsx` renders `<Page width={1000}>` and builds a Konva stage over the same render dimensions. Browser viewport uses `viewportPan` and `pdfZoom` (not sample geometry).
- Accepted contour vertices live in capture pixels; `overlayScale` is a project-level contour scale, while `SampleTransform.tx`, `ty`, `rotationDeg` and `visible` persist per sample.
- `SampleStyle`: `color` (HEX), `lineType` `solid|dashed|dash_dot`, `widthMm` (mm). Legacy `transform.color` remains for compatibility.
- The backend `PdfExportService.DISPLAY_PAGE_WIDTH=1000.0` scales geometry to displayed PDF page width using `page.rect.width / 1000`, then maps the displayed coordinates through the inverse page rotation to PyMuPDF page coordinates. It converts line widths from millimetres to PDF points via `72 / 25.4`. The frontend uses the rendered page width to represent the same line width and dash lengths; the selected contour is visually emphasized. Non-default PDF UserUnit can still affect exported stroke width. This is **not** an independent PDF-native persisted transform or physical calibration.
- Chain: oriented camera pixels → raw contour and centroid → project `overlayScale` around that centroid → sample rotation and `tx`/`ty` in 1000-wide display coordinates → page-specific display-to-PDF scale and rotation → vector PDF. Viewport zoom and pan affect only display. DXF vertices remain image-derived coordinates, not calibrated dimensions.
- Recenter changes `viewportPan` to bring the transformed contour center into view; it does not change `SampleTransform` or zoom. Cross-page navigation waits for the selected page to render.

When introducing PDF-native coordinates later, plan a **versioned schema migration**; handle CropBox, Rotate, point origins, page-specific dimensions, and old 1000 px placements. Never reinterpret old transforms silently.

## 4. Accepted-sample lifecycle

```text
Capture -> SAM prompts -> predict candidates -> accept mask
     -> outer contours + holes + binary mask/contour PNG
     -> sample in App.tsx
     -> page number, transform, SampleStyle
     -> interactive overlay / right-side inspector
     -> local save -> project.json + image files + DXF + result.pdf + .hkai
```

For new samples, `App.tsx` inherits the previous sample's `tx`, `ty` and `rotationDeg`. Existing `overlayScale` is shared project state. For resegmentation, it uses the selected sample's transform, style and page number. Preserve this during UI refactors.

## 5. Local project data and formats

```text
data/projects/<project_id>/
  project.json                 Pydantic metadata / editable state
  source.pdf                   original source PDF snapshot
  result.pdf                   PyMuPDF-generated vector overlay when export succeeds
  <project_id>.hkai            ZIP-compatible archive + manifest.json SHA-256 checksums
  samples/<sample_id>/
    <name>_capture.png          oriented full-resolution image
    <name>_mask.png             accepted mask
    <name>_contour_bw.png       black/white contour visualization
    contour.dxf                DXF from mask contour extraction
```

File naming is based on the saved `files` references; don't assume every filename above is fixed for older projects. `project.json` stores `schema_version` (default 2 for new saves), selected page, overlay scale, sample page, raw contour geometry and style. `backend/app/routers/project.py:_normalize_payload` supplies compatibility defaults.

The archive is created by `ProjectService.create_archive`, and imported through `ProjectService.import_archive`. It checks member count/uncompressed size, paths, required metadata and SHA-256 checksums, then installs into a new project directory. The UI can upload `.hkai` and browse local projects; an existing project ID is not overwritten.

Save stages files and artifacts before replacing the project directory; interrupted replacements can recover a prior backup. Deleted/replaced sample assets are retained locally for session undo but excluded from the active archive. Save results include `export_error`, artifact statuses and URLs; only returned artifacts get download links. Local save does not guarantee a generated PDF.

Project edits increment a client revision; an immutable snapshot is submitted once per save. A successful response clears the dirty flag only if no newer revision exists. Capture, prompts and unfinished segmentation are temporary workspace state and are not serialized; accepted samples are persisted. Undo history is session-local.

Uploads are spooled with limits: archive 1 GiB, source PDF 256 MiB, each sample asset 64 MiB, and total save uploads 1 GiB. FastAPI's multipart parsing occurs before these endpoint checks, so deployment-level request and disk limits remain necessary. Retained versions and recovery backups can consume disk space; do not remove them while recovery or undo may be needed.

## 6. API overview

| Route | Meaning |
|---|---|
| `GET /api/health/` | Camera/SAM state |
| `GET /api/session/status` | Lock status |
| `POST /api/session/claim` | Claim current operator token |
| `POST /api/session/heartbeat` | Renew lease |
| `POST /api/session/release` | Release lease |
| `GET /api/camera/status` / `/frame` | Camera state/preview |
| `POST /api/camera/orientation` | Change camera rotation |
| `POST /api/camera/test-image` / `/clear` | Uploaded image source mode |
| `POST /api/camera/capture` | Full-res image capture |
| `POST /api/sam/register-image` | Register existing PNG for SAM redo |
| `POST /api/sam/prepare` / `/predict` / `/accept` | Embedding/prompt/mask flow |
| `GET /api/project/list` | Local project list |
| `POST /api/project/save` | Save project; attempt PDF and archive generation |
| `POST /api/project/import` | Import `.hkai` archive |
| `GET /api/project/load/{project_id}` | Load editable project metadata |
| `GET /api/project/{project_id}/source.pdf` | Original PDF |
| `GET /api/project/{project_id}/result.pdf` | Derived vector PDF |
| `GET /api/project/{project_id}/{project_id}.hkai` | Editable archive |
| `GET /api/project/{project_id}/samples/{sample_id}/{name}` | Capture/mask/contour/DXF |

## 7. State and responsibilities

- `App.tsx`: inspection and UI workflow, localization hook, selected sample and project, layout widths/localStorage. Do not let the inspector keep a divergent sample copy.
- `CameraPanel.tsx`: renders prompt and mask overlays; never owns the canonical SAM data.
- `PdfOverlayPanel.tsx`: renders PDF and uses `onUpdateSample` for actual sample translation/rotation; viewport pan/zoom should remain UI-only.
- `SegmentationControls.tsx`: camera-side SAM controls, driven by `App.tsx` state.
- `InspectionInspector.tsx`: presentational sample and style controls, driven through typed callbacks; it becomes a drawer on compact screens.
- `ProjectPicker.tsx`: accessible local project selection using the existing list/load APIs.
- Backend Pydantic models and TS types must be updated together on schema changes; verify legacy normalization.
- `PdfExportService`: derived document; should never overwrite `source.pdf`.
- `ProjectService`: local project persistence and `.hkai` packaging; this remains authoritative until cloud sync is fully implemented.

## 8. Start, logging and deployment

- `prepare_lan.bat`: one-time dependency/build preparation; it does not include `imagingcontrol4` in the pinned requirements.
- `create_desktop_shortcut.bat`: creates `AI自動投影.lnk` by PowerShell Unicode character construction.
- `launch_operator.bat`: health checks port 8000, starts one server, creates `logs/server.pid` and output logs, opens browser.
- `stop_operator.bat`: kills recorded process tree.
- Default trusted CIDRs include private ranges; restrict to actual company subnet(s). Production single origin at port 8000; never port-forward publicly.

## 9. Future feature boundaries

Google Workspace OAuth/Shared Drive support, persistent sync queue, per-user authentication, and PDF-native coordinate migration are **planned** but not present in this snapshot. Do not fabricate endpoints or test results for them. Preserve local-first project behavior when adding those features.

### Access-control design boundary

A future deployment decision must define identities and roles: read-only users may view approved projects and downloads; operators additionally control the camera and modify projects; administrators manage access, trusted networks and server-side credentials. Authentication, per-project authorization, audit and session expiry must be enforced server-side. The current LAN allowlist and operator lease provide none of those identity guarantees; read endpoints remain accessible to allowed LAN clients. Do not expose port 8000 publicly or add default credentials.
