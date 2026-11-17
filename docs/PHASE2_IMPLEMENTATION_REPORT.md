# Phase 2 implementation report

## Initial state and confirmed causes

- Initial checkout: clean `main` at `02a4f859835c3692cb2fd2f95afeccd8ee765e2a`.
- PDF export ignored sample visibility; rotated and cropped pages needed a display-to-page transform. Frontend line widths and dashes used fixed display values rather than page dimensions.
- Save completion cleared all image buffers and the dirty flag even when edits occurred during the request. Unfinished capture state was marked dirty but not saved.
- Direct multi-file saves could leave inconsistent artifacts after failures. Deleted sample assets could remain in archives; immediate deletion would also break undo.
- PDF document viewport state could carry across sources. Sample transform controls were read-only and project archive import and downloads were not exposed in the UI.
- Archive validation did not require all extracted files to be covered by the checksum manifest or reject duplicate member names.

## Implementation and compatibility

- Hidden samples remain in project metadata and retain their original per-sample contour DXF, but are omitted from PDF overlays. DXF coordinates are image-derived and are not physically calibrated.
- PDF export maps 1000-wide display coordinates through page scale and inverse page rotation; page geometry tests include rotated and cropped documents. Display line widths and dash lengths use page dimensions. Existing persisted coordinate semantics and schema v1/v2 loading are preserved; no PDF-native migration was performed.
- Client saves use immutable snapshots, revisions, request identity and duplicate-save prevention. Later edits remain dirty, and image buffers are retained for retries and history. Capture and unfinished segmentation are explicitly temporary; destructive transitions warn. Stale capture and mask acceptance responses are invalidated.
- Staged project saves retain the last valid state on failure and recover interrupted replacements. Deleted and replaced assets are retained locally for undo, excluded from active archives, and sample IDs are reserved across reloads. These retained versions and backups can grow and need operational disk monitoring.
- Undo/redo covers sample changes and overlay scale; pointer gestures form one history entry. Numeric X/Y are display pixels and rotation is degrees. History is session-local.
- Document changes reset PDF viewport state, while recenter remains viewport-only. Archive upload, searchable local picker and downloads for returned artifacts are available. PDF failures and missing source PDFs are reported separately from editable project persistence.
- Import rejects duplicate or unlisted ZIP members and checks all listed contents. Upload endpoints stream to bounded spools, with 1 GiB archive, 256 MiB source PDF, 64 MiB per sample asset and 1 GiB total save limits. Multipart parsing precedes endpoint checks; deployment-level request and disk limits are still required.
- Save responses retain existing fields and add artifact status details; load adds optional `reserved_sample_ids`. No existing project schema or archive version was silently reinterpreted.
- Repeatable preparation now uses `npm ci`; Windows CI runs frontend tests/build and backend tests. Generated PID/build metadata and the empty root `git` file were untracked without deleting the local files.

## Files changed

- Backend: project router and services, PDF exporter, project tests and new PDF export tests.
- Frontend: `App.tsx`, `api.ts`, `i18n.ts`, `styles.css`, PDF overlay, inspector and project picker, plus their tests.
- Operations/documentation: `.gitignore`, `prepare_lan.bat`, `.github/workflows/checks.yml`, README, AGENTS, architecture, review notes and this report.

## Validation

- `npm.cmd --prefix frontend run test`: **53 passed**, 5 files.
- `npm.cmd --prefix frontend run build`: **passed**; Vite warns about chunks larger than 500 kB.
- `.\.venv\Scripts\python.exe -m pytest backend\tests -q`: **72 passed**, 15 deprecation warnings.
- Pylance syntax checks passed for the changed backend project router, project service and PDF exporter.
- Browser: isolated Vite preview, with backend unavailable, was checked at 1920×1280, 1920×1080, 1600×900, 1366×768 and 1280×720. The document and header did not horizontally overflow; the English compact inspector opened at 1280×720. A screenshot was inspected. These are layout checks, not a complete camera, drag, import or save workflow test.
- CI configuration was added but has not been run on GitHub Actions. No physical camera, vendor driver or GPU inference was tested.

## Remaining risks and deferred work

- Non-default PDF UserUnit can affect exported stroke width. Validate actual rotated, cropped and mixed-size factory drawings against known output; no physical dimensional accuracy is claimed.
- LAN allowlisting and the operator lease are not authentication. Read-only endpoints are accessible to allowed LAN clients. The read-only/operator/administrator access-control design remains a separate deployment decision; do not expose the server to the Internet.
- Multipart parser limits, disk quotas, backup/version retention policy, concurrent multi-worker access, robust structured localization of all existing backend errors, and a versioned PDF-native coordinate migration remain future work.
- The full interactive browser matrix, including real image prompt mapping and contour dragging after resize, remains to be verified on the factory PC.

## Factory-PC checklist

1. Verify DFK 33UX178 driver, 90° orientation, live/full capture, reconnect and source switching.
2. Verify actual SAM CPU/GPU inference and positive/negative prompt and mask alignment after resizing.
3. Verify sample placement inheritance, drag/rotate, undo/redo and numeric edits.
4. Compare PDF output for representative portrait, landscape, rotated, cropped and mixed-page drawings; check line styles and widths independently of any physical calibration.
5. Test save failure/retry, archive import conflict, load/re-edit/save, and downloads on the target disk; monitor retained backup space.
6. Confirm firewall and trusted CIDRs on the company network; verify Japanese and English at workstation resolutions.
