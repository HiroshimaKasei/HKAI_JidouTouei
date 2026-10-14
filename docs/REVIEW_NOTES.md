# Review notes and prioritized follow-ups

Audit basis: uploaded `HKAI_JidouTouei-main (1).zip`, inspected in the current conversation. This ZIP contains no Git metadata: **commit hash/current remote `main` not verified**. These are implementation findings, not physical-hardware test results.

## Tests actually executed

- `PYTHONPATH=backend python -m pytest backend/tests -q` → **14 passed**, 2 FastAPI `@app.on_event` deprecation warnings; review machine used Python 3.13 and CPU Torch, not the target Windows/DFK hardware environment.
- `npm ci --prefix frontend --offline --no-audit --no-fund` → **could not complete**, missing `yallist-3.1.1.tgz` from local npm cache. Frontend Vitest/build **not executed** in this review. Run `npm ci`, `npm --prefix frontend run test`, `npm --prefix frontend run build` on a connected/provisioned development PC.

## P0: Recenter is destructive (verified directly from source)

- File: `frontend/src/components/PdfOverlayPanel.tsx` — `moveSampleToPageCenter()` uses `onUpdateSample(sampleId,{tx,ty})`, called by `recenterSelectedContour()`.
- Test `frontend/src/components/PdfOverlayPanel.test.tsx` explicitly asserts the mutation.
- Requested contract from operator: **button only pans view to locate contour**, preserving sample placement, zoom, export geometry and saved project. Current behavior instead changes placement. Fix code + test together; compute transformed contour center, then set `viewportPan` to put it in the visible panel center. Do not move sample or change `pdfZoom`. Handle other pages after render.

## P1: PDF-native coordinates and export verification

- `frontend/src/components/PdfOverlayPanel.tsx` still renders `<Page width={1000}>`.
- `backend/app/services/pdf_export_service.py` still uses `DISPLAY_PAGE_WIDTH=1000` and page-width scale instead of a full PDF-native stored transform.
- Add tests for CropBox, rotated and non-default-origin pages, mixed sizes, screen/PDF roundtrip. Don't claim dimensional accuracy from current output without calibration and export validation.

## P1: Expose .hkai and PDF artifacts to operators

- Backend: `/api/project/import`, `/result.pdf`, `/{id}.hkai` exist. `.hkai` archive creation/import and SHA checksums implemented.
- UI `onLoadProject()` only displays an ID prompt for local projects and does not upload an `.hkai` file.
- `frontend/src/api.ts:saveProject` ignores backend `result_pdf_url`, `archive_url`, and `export_error`; UI always says `Project saved` even when PDF export failed. Improve status and provide deliberate Download PDF/Archive or Import Archive actions after checking server response.

## P1: Google Drive and security features missing

- No implemented OAuth, admin-only Settings, Shared Drive browser, persistent upload queue or conflict management. The backend CIDR gate and browser operator lease are not authentication. Plan a security review before exposing company drawings broadly or adding Google credentials.

## P2: Camera input and hardware checks

- `frontend/src/components/CameraPanel.tsx:onUploadTestMode` sets `ev.currentTarget.value` **after an `await`**. Capture the input element before awaiting to avoid unavailable `currentTarget` in asynchronous handlers. Add upload/same-file-selection test.
- `backend/app/services/camera_service.py` rotates 90° by default and handles live/test source switching; test IC4 acquisition/reconnect race on the real DFK 33UX178 with rapid switching. Installation file `backend/requirements.txt` lacks `imagingcontrol4`.
- Camera orientation is in-memory and not currently a persisted operator setting. Avoid double rotation when reopening saved images.

## P2: UI and documentation polish

- Some runtime status strings remain English-only because `translateStatus` only maps known exact phrases. Audit unlocalized statuses/confirmation dialogs before claiming complete bilingual coverage.
- Review three-pane breakpoint behavior at 1366×768 and on resizes to ensure inspector remains accessible and no stage-pointer offsets appear.
- Root `README.md` in the uploaded ZIP has an outdated feature list and test notes. Replace with the paired README/AGENTS/ARCHITECTURE documentation in this package.
- Consider moving deprecated FastAPI `@app.on_event("shutdown")` to lifespan at a safe maintenance point.

## Regression checklist for every significant change

1. Native camera frame vs rotated preview vs full-resolution frozen image.
2. Positive/negative prompts and mask overlay still land on correct pixel after panel resize.
3. New sample follows previous sample translation/rotation; no auto-placement.
4. Existing sample drag/rotate and line style roundtrip in `project.json`.
5. Recenter pans viewport only; sample `tx/ty/rotationDeg`, PDF zoom and PDF export unchanged.
6. Source PDF preserved; result PDF generated with correct colored vector strokes/line widths; errors surfaced.
7. `.hkai` save → import → load → re-edit → save; corrupt archive rejected; no path escapes.
8. Japanese default + live language switching and readable labels.
9. One operator only, LAN allowed clients only, no public exposure.
10. Windows launcher, camera driver and SAM checkpoint verified on the actual deployment PC.
