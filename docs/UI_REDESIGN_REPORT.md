# Phase 1 UI redesign report

## Audit findings

- The previous compact breakpoint placed the inspector below the two primary
  panes; the PDF lost space and controls could require workspace scrolling.
- Header status chips competed for space, the local project loader used a
  text prompt, and segmentation was separated from the camera workflow.
- Sample HEX edits could temporarily write invalid colors into project state.
- Recenter changed saved sample translation rather than navigating the view.
- The save UI discarded the backend's PDF export error.

## Changes

- Added the token-based light workstation theme, responsive resizable panes,
  keyboard separators, saved/clamped widths, reset and compact inspector drawer.
- Grouped camera source and SAM controls, added prompt counts and signed
  markers, and retained the original capture/prediction state in `App.tsx`.
- Added PDF fit/reset controls and view-only, cross-page contour recentering.
- Structured sample selection, visibility, placement readout and line styling;
  invalid partial HEX values no longer enter canonical sample state.
- Added a focus-managed local project picker and bilingual status, control and
  confirmation text. The save status now shows returned PDF export errors.
- Files changed: `frontend/src/App.tsx`, `api.ts`, `i18n.ts`, `styles.css`,
  `components/CameraPanel.tsx`, `PdfOverlayPanel.tsx`,
  `InspectionInspector.tsx`, new `SegmentationControls.tsx` and
  `ProjectPicker.tsx`, and the corresponding frontend tests.
  `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `REVIEW_NOTES.md` and the
  design system were updated. No backend schema, endpoint or archive format
  was changed; the frontend now reads the existing `export_error` field.

## Validation

- `npm.cmd --prefix frontend run test`: **28 passed**, 3 files.
- `npm.cmd --prefix frontend run build`: **passed**; Vite reports chunks over
  500 kB.
- Browser screenshots and layout checks were performed with mocked APIs at
  1920×1280, 1920×1080, 1600×900, 1366×768 and 1280×720. The compact
  inspector was opened at both narrow sizes. A 1024×576 effective viewport
  was also checked. The measured Japanese and English headers did not overflow
  and the application did not acquire a horizontal scrollbar. Individual
  camera and inspector panels can scroll vertically.
- With reset widths, measured camera/PDF widths were 380/1090 px at
  1920, 380/770 px at 1600, 380/954 px at 1366 and 380/868 px at 1280.
  Compact widths are measured with the inspector closed.
- A synthetic PDF and sample were used to drag the contour before and after a
  keyboard panel resize; the resulting translation matched the pointer
  deltas. A synthetic frozen image and mocked SAM responses were used to
  check positive and negative image-pixel prompts after resizing.
- These browser checks used fixtures, not a physical camera, SAM model or
  production backend. Backend tests were not run because no backend contract
  or implementation was changed.

## Remaining work and manual checks

- On the factory PC, check camera connection/reconnection, portrait capture,
  actual SAM inference, prompt/mask alignment during resizing, and PDF
  interaction with real multi-page drawings.
- Verify saved and exported PDF geometry against rotated, cropped and mixed-size
  pages. The existing 1000 px display-page coordinate convention is not a
  physical calibration or a completed PDF-native migration.
- The backend can import `.hkai` archives, but the UI still has no archive
  picker or PDF/archive download controls. Drive integration is not present.
- Backend-supplied error details may remain in their original language.
