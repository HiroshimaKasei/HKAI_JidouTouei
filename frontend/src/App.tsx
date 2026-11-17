import { useEffect, useMemo, useRef, useState } from "react";

import {
  acceptMask,
  capture,
  clearTestImage,
  fetchFileAsFile,
  fileToHex,
  getCameraStatus,
  getHealth,
  importProject,
  loadProject,
  prepareEmbedding,
  predictMask,
  registerCaptureFile,
  releaseOperatorSession,
  resolveApiPath,
  resolvePdfUrl,
  saveProject,
  uploadTestImage,
} from "./api";
import { CameraPanel } from "./components/CameraPanel";
import { InspectionInspector } from "./components/InspectionInspector";
import { PdfOverlayPanel, sampleColor } from "./components/PdfOverlayPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { SegmentationControls } from "./components/SegmentationControls";
import { translateStatus, useLocale } from "./i18n";
import type { CameraStatus, PromptPoint, SampleData, SampleStyle } from "./types/models";

const DEFAULT_SAMPLE_STYLE: SampleStyle = { color: "#ff5500", lineType: "solid", widthMm: 0.35 };
const STYLE_COLORS = ["#ff5500", "#0099ff", "#17a05d", "#c83f7f", "#b68000", "#1e78b7"];
const DEFAULT_CAMERA_WIDTH = 380;
const MIN_CAMERA_WIDTH = 300;
const MIN_PDF_WIDTH = 480;
const MIN_INSPECTOR_WIDTH = 370;
const COMPACT_WIDTH = 1400;

function defaultPdfWidth() {
  return Math.max(MIN_PDF_WIDTH, window.innerWidth - DEFAULT_CAMERA_WIDTH - 410 - 40);
}

function storedWidth(key: string, fallback: number) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampPanelWidths(camera: number, pdf: number) {
  const compact = window.innerWidth <= COMPACT_WIDTH;
  const available = Math.max(0, window.innerWidth - (compact ? 32 : 40));
  const inspector = compact ? 0 : MIN_INSPECTOR_WIDTH;
  const minCamera = Math.min(MIN_CAMERA_WIDTH, available * 0.4);
  const minPdf = Math.min(MIN_PDF_WIDTH, Math.max(0, available - minCamera - inspector));
  const maxCamera = Math.max(minCamera, available - minPdf - inspector);
  const nextCamera = Math.min(Math.max(camera, minCamera), maxCamera);
  const maxPdf = Math.max(minPdf, available - nextCamera - inspector);
  return { camera: nextCamera, pdf: Math.min(Math.max(pdf, minPdf), maxPdf) };
}

function hexToDataUrl(hex: string, mime = "image/png"): string {
  const bytes = hex.match(/.{1,2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") ?? "";
  return `data:${mime};base64,${btoa(bytes)}`;
}

function nextSampleId(ids: Iterable<string>): string {
  let maxId = 0;
  for (const id of ids) {
    const n = Number(id);
    if (Number.isFinite(n)) {
      maxId = Math.max(maxId, n);
    }
  }
  return String(maxId + 1).padStart(3, "0");
}

type EditingSnapshot = { samples: SampleData[]; scale: number; selectedId: string | null };

function sampleFileUrl(projectId: string, sampleId: string, fileName: string): string {
  return resolveApiPath(`/api/project/${projectId}/samples/${sampleId}/${fileName}`);
}

function makeProjectId(): string {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `project_${timestamp}_${crypto.randomUUID().slice(0, 8)}`;
}

export function App() {
  const { language, setLanguage, t } = useLocale();
  const [statusText, setStatusText] = useState("Initializing");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null);
  const [gpuStatus, setGpuStatus] = useState<string>("SAM: Checking");
  const [samDevice, setSamDevice] = useState<"cpu" | "cuda">("cpu");

  const [pdfSource, setPdfSource] = useState<string | File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [overlayScale, setOverlayScale] = useState(1);

  const [captureId, setCaptureId] = useState<string | null>(null);
  const [frozenImageHex, setFrozenImageHex] = useState("");
  const [frozenSize, setFrozenSize] = useState<{ width: number; height: number } | null>(null);
  const [segReady, setSegReady] = useState(false);
  const [prompts, setPrompts] = useState<PromptPoint[]>([]);
  const [candidateMasks, setCandidateMasks] = useState<string[]>([]);
  const [candidateScores, setCandidateScores] = useState<number[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [maskPreviewHex, setMaskPreviewHex] = useState("");
  const [isPredicting, setIsPredicting] = useState(false);
  const [hasLatestPrediction, setHasLatestPrediction] = useState(false);

  const [samples, setSamples] = useState<SampleData[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [replaceSampleId, setReplaceSampleId] = useState<string | null>(null);

  const requestCounterRef = useRef(0);
  const latestAcceptedRequestIdRef = useRef(0);
  const predictTokenRef = useRef(0);
  const activePredictTokenRef = useRef(0);
  const captureEpochRef = useRef(0);

  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [artifacts, setArtifacts] = useState<{ pdf: string; archive: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const saveInFlightRef = useRef(false);
  const projectRevisionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const usedSampleIdsRef = useRef(new Set<string>());
  const samplesRef = useRef(samples);
  const overlayScaleRef = useRef(overlayScale);
  const selectedSampleIdRef = useRef(selectedSampleId);
  const pastRef = useRef<EditingSnapshot[]>([]);
  const futureRef = useRef<EditingSnapshot[]>([]);
  const gestureRef = useRef<EditingSnapshot | null>(null);
  const activeWorkRef = useRef(false);
  const dirtyRef = useRef(false);
  selectedSampleIdRef.current = selectedSampleId;
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const [panelWidths, setPanelWidths] = useState(() => clampPanelWidths(
    storedWidth("hkai-camera-pane-width", DEFAULT_CAMERA_WIDTH),
    storedWidth("hkai-pdf-pane-width", defaultPdfWidth())
  ));
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const previousViewportWidthRef = useRef(window.innerWidth);

  const projectIdRef = useRef(makeProjectId());

  function markDirty() {
    projectRevisionRef.current += 1;
    dirtyRef.current = true;
    setIsDirty(true);
    setArtifacts(null);
  }

  function markClean() {
    dirtyRef.current = false;
    setIsDirty(false);
  }

  function snapshot(): EditingSnapshot {
    return { samples: samplesRef.current, scale: overlayScaleRef.current, selectedId: selectedSampleIdRef.current };
  }

  function refreshHistory() {
    setHistoryVersion((version) => version + 1);
  }

  function clearHistory() {
    pastRef.current = [];
    futureRef.current = [];
    gestureRef.current = null;
    refreshHistory();
  }

  function editProject(nextSamples: SampleData[], nextScale = overlayScaleRef.current) {
    if (!gestureRef.current) {
      pastRef.current.push(snapshot());
      futureRef.current = [];
      refreshHistory();
    }
    samplesRef.current = nextSamples;
    overlayScaleRef.current = nextScale;
    setSamples(nextSamples);
    setOverlayScale(nextScale);
    markDirty();
  }

  function startSampleGesture() {
    if (!gestureRef.current) gestureRef.current = snapshot();
  }

  function endSampleGesture() {
    const start = gestureRef.current;
    gestureRef.current = null;
    if (start && start.samples !== samplesRef.current) {
      pastRef.current.push(start);
      futureRef.current = [];
      refreshHistory();
    }
  }

  function restoreHistory(direction: "undo" | "redo") {
    endSampleGesture();
    const from = direction === "undo" ? pastRef.current : futureRef.current;
    const to = direction === "undo" ? futureRef.current : pastRef.current;
    const entry = from.pop();
    if (!entry) return;
    to.push(snapshot());
    samplesRef.current = entry.samples;
    overlayScaleRef.current = entry.scale;
    selectedSampleIdRef.current = entry.selectedId;
    setSamples(entry.samples);
    setOverlayScale(entry.scale);
    setSelectedSampleId(entry.selectedId);
    markDirty();
    refreshHistory();
  }

  useEffect(() => {
    activeWorkRef.current = Boolean(captureId || frozenImageHex || prompts.length || isPredicting || segReady);
  }, [captureId, frozenImageHex, prompts, isPredicting, segReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        event.preventDefault();
        restoreHistory(key === "y" || event.shiftKey ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("hkai-camera-pane-width", String(panelWidths.camera));
    window.localStorage.setItem("hkai-pdf-pane-width", String(panelWidths.pdf));
  }, [panelWidths]);

  function startResizeDivider(divider: "camera" | "pdf", event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const gridLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const onMove = (moveEvent: PointerEvent) => setPanelWidths((current) => {
      const camera = divider === "camera" ? moveEvent.clientX - gridLeft - 12 : current.camera;
      const pdf = divider === "pdf" ? moveEvent.clientX - gridLeft - 20 - current.camera : current.pdf;
      return clampPanelWidths(camera, pdf);
    });
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onDividerKeyDown(divider: "camera" | "pdf", event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
    if (!delta) return;
    event.preventDefault();
    setPanelWidths((current) => clampPanelWidths(divider === "camera" ? current.camera + delta : current.camera, divider === "pdf" ? current.pdf + delta : current.pdf));
  }

  function resetLayout() {
    setPanelWidths(clampPanelWidths(DEFAULT_CAMERA_WIDTH, defaultPdfWidth()));
    setInspectorOpen(false);
  }

  useEffect(() => {
    const onResize = () => {
      const delta = window.innerWidth - previousViewportWidthRef.current;
      previousViewportWidthRef.current = window.innerWidth;
      setViewportWidth(window.innerWidth);
      setPanelWidths((current) => clampPanelWidths(current.camera, current.pdf + delta));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [health, cam] = await Promise.all([getHealth(), getCameraStatus()]);
        setCameraStatus(cam);
        const sam = (health as {
          sam?: {
            active_device?: string;
            state?: string;
            model_loaded?: boolean;
            error?: string;
            device_name?: string;
            capability?: string;
          };
          gpu?: {
            active_device?: string;
            state?: string;
            model_loaded?: boolean;
            error?: string;
            device_name?: string;
            capability?: string;
          };
        }).sam ?? (health as { gpu?: { active_device?: string; state?: string; model_loaded?: boolean; error?: string; device_name?: string; capability?: string } }).gpu;
        if (sam) {
          setSamDevice(sam.active_device === "cuda" ? "cuda" : "cpu");
          const device = sam.active_device === "cuda" ? "GPU" : "CPU";
          const state = sam.state ?? "idle";
          if (sam.error) {
            setGpuStatus(`SAM: ${device} Error (${sam.error})`);
          } else if (state === "loading") {
            setGpuStatus(`SAM: ${device} Loading`);
          } else if (state === "processing") {
            setGpuStatus(`SAM: ${device} Processing`);
          } else if (sam.model_loaded) {
            if (sam.active_device === "cuda") {
              const cap = sam.capability ? ` sm_${sam.capability.replace(".", "")}` : "";
              setGpuStatus(`SAM: GPU Ready (${sam.device_name ?? "CUDA"}${cap})`);
            } else {
              setGpuStatus("SAM: CPU Ready");
            }
          } else {
            setGpuStatus(`SAM: ${device} Idle`);
          }
        }
        setStatusText((current) => current === "Initializing" ? "Ready" : current);
      } catch (err) {
        setStatusText((current) => current === "Initializing" ? `Startup error: ${(err as Error).message}` : current);
      }
    })();

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || activeWorkRef.current || saveInFlightRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
      void releaseOperatorSession();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void releaseOperatorSession();
    };
  }, []);

  function invalidatePredictions(clearMask = true) {
    predictTokenRef.current += 1;
    activePredictTokenRef.current = 0;
    setIsPredicting(false);
    setHasLatestPrediction(false);
    setCandidateMasks([]);
    setCandidateScores([]);
    setSelectedCandidateIndex(0);
    if (clearMask) {
      setMaskPreviewHex("");
    }
  }

  function resetActiveSegmentation() {
    captureEpochRef.current += 1;
    setCaptureId(null);
    setFrozenImageHex("");
    setFrozenSize(null);
    setSegReady(false);
    setPrompts([]);
    requestCounterRef.current = 0;
    latestAcceptedRequestIdRef.current = 0;
    invalidatePredictions();
    setReplaceSampleId(null);
  }

  function confirmDiscardActiveSegmentation(action: "openImage" | "returnLive" | "capture"): boolean {
    const hasActiveSegmentation = Boolean(captureId || frozenImageHex || prompts.length || isPredicting || segReady);
    const message = language === "ja"
      ? `撮影画像とセグメンテーションを破棄して「${t(action)}」を実行しますか？`
      : `Discard the active capture and segmentation to ${t(action)}?`;
    return !hasActiveSegmentation || window.confirm(message);
  }

  async function onOpenImage(file: File) {
    if (!confirmDiscardActiveSegmentation("openImage")) {
      return;
    }
    const status = await uploadTestImage(file);
    resetActiveSegmentation();
    setCameraStatus(status);
    setStatusText(`Image source selected: ${file.name}`);
  }

  async function onReturnToLive() {
    if (!confirmDiscardActiveSegmentation("returnLive")) {
      return;
    }
    const status = await clearTestImage();
    resetActiveSegmentation();
    setCameraStatus(status);
    setStatusText(status.camera_connected ? "Live camera preview restored" : "Live camera reconnecting...");
  }

  function confirmDiscardIfDirty(action: "newInspection" | "loadAnother"): boolean {
    if (!isDirty && !activeWorkRef.current) {
      return true;
    }
    return window.confirm(language === "ja" ? `未保存の変更と一時的な撮影・セグメンテーションを破棄して${t(action)}しますか？` : `Discard unsaved project changes and temporary capture/segmentation to ${t(action)}?`);
  }

  useEffect(() => {
    if (!captureId || !segReady) {
      return;
    }
    const posCount = prompts.filter((p) => p.label === 1).length;
    if (posCount === 0) {
      invalidatePredictions();
      return;
    }

    const reqId = ++requestCounterRef.current;
    const token = ++predictTokenRef.current;
    activePredictTokenRef.current = token;
    setIsPredicting(true);
    setHasLatestPrediction(false);
    setGpuStatus(samDevice === "cuda" ? "SAM: GPU Processing" : "SAM: CPU Processing");
    setStatusText("Running SAM inference...");
    const reqCapture = captureId;

    void predictMask(reqCapture, prompts, reqId)
      .then((resp) => {
        if (activePredictTokenRef.current !== token) {
          return;
        }
        if (reqCapture !== captureId) {
          return;
        }
        latestAcceptedRequestIdRef.current = resp.request_id;
        setCandidateMasks(resp.masks);
        setCandidateScores(resp.scores);
        const idx = resp.best_index >= 0 ? resp.best_index : 0;
        setSelectedCandidateIndex(idx);
        setMaskPreviewHex(resp.masks[idx] ?? "");
        setHasLatestPrediction(true);
        const predMs = (resp as { prediction_ms?: number }).prediction_ms;
        setStatusText(predMs ? `Segmentation updated (${predMs.toFixed(0)} ms)` : "Segmentation updated");
        setGpuStatus(samDevice === "cuda" ? "SAM: GPU Ready" : "SAM: CPU Ready");
      })
      .catch((err) => {
        if (activePredictTokenRef.current === token) {
          setCandidateMasks([]);
          setCandidateScores([]);
          setMaskPreviewHex("");
          setHasLatestPrediction(false);
          setStatusText(`SAM error: ${(err as Error).message}`);
          setGpuStatus(samDevice === "cuda" ? `SAM: GPU Error (${(err as Error).message})` : `SAM: CPU Error (${(err as Error).message})`);
        }
      })
      .finally(() => {
        if (activePredictTokenRef.current === token) {
          setIsPredicting(false);
        }
      });
  }, [captureId, prompts, segReady]);

  async function onOpenPdf(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) {
      return;
    }
    if (!confirmDiscardIfDirty("newInspection")) {
      ev.currentTarget.value = "";
      return;
    }
    projectIdRef.current = makeProjectId();
    usedSampleIdsRef.current = new Set();
    clearHistory();
    resetActiveSegmentation();
    samplesRef.current = [];
    overlayScaleRef.current = 1;
    setSamples([]);
    setSelectedSampleId(null);
    setOverlayScale(1);
    setStatusText(`Loaded PDF: ${file.name} (new inspection)`);
    markDirty();
    setSaveError("");
    setPdfFile(file);
    setPdfSource(file);
    setSelectedPage(1);
    ev.currentTarget.value = "";
  }

  async function onCapture() {
    if (!confirmDiscardActiveSegmentation("capture")) return;
    const epoch = ++captureEpochRef.current;
    invalidatePredictions();
    setStatusText("Capturing frame...");
    try {
      const cap = await capture();
      if (epoch !== captureEpochRef.current) return;
      setCaptureId(cap.capture_id);
      setFrozenSize({ width: cap.width, height: cap.height });
      setFrozenImageHex(cap.capture_png_hex);
      setPrompts([]);
      setReplaceSampleId(null);
      requestCounterRef.current = 0;
      latestAcceptedRequestIdRef.current = 0;
      invalidatePredictions();

      setGpuStatus(samDevice === "cuda" ? "SAM: GPU Loading" : "SAM: CPU Loading");

      const prep = (await prepareEmbedding(cap.capture_id)) as { prepare_ms?: number } | void;
      if (epoch !== captureEpochRef.current) return;
      setSegReady(true);
      const prepMs = prep && typeof prep === "object" ? prep.prepare_ms : undefined;
      setStatusText(prepMs ? `Capture frozen. Add SAM prompts. Embedding: ${prepMs.toFixed(0)} ms` : "Capture frozen. Add SAM prompts.");
      setGpuStatus(samDevice === "cuda" ? "SAM: GPU Ready" : "SAM: CPU Ready");
    } catch (err) {
      if (epoch !== captureEpochRef.current) return;
      setStatusText(`Capture error: ${(err as Error).message}`);
      setGpuStatus(samDevice === "cuda" ? `SAM: GPU Error (${(err as Error).message})` : `SAM: CPU Error (${(err as Error).message})`);
    }
  }

  function onAddPrompt(p: PromptPoint) {
    setPrompts((prev) => [...prev, p]);
  }

  function onUndoPrompt() {
    setPrompts((prev) => prev.slice(0, -1));
    invalidatePredictions();
  }

  function onResetPrompts() {
    setPrompts([]);
    invalidatePredictions();
  }

  function onRedoSegmentation() {
    onResetPrompts();
    setStatusText("Segmentation restarted on frozen image");
  }

  async function onAcceptMask() {
    if (!captureId) {
      return;
    }
    if (isPredicting) {
      setStatusText("Wait for inference to finish");
      return;
    }
    if (!hasLatestPrediction) {
      setStatusText("Wait for a successful latest prediction");
      return;
    }
    if (!candidateMasks[selectedCandidateIndex]) {
      setStatusText("No mask candidate selected");
      return;
    }

    const epoch = captureEpochRef.current;
    const predictionToken = predictTokenRef.current;
    try {
      const resp = await acceptMask(captureId, latestAcceptedRequestIdRef.current, selectedCandidateIndex);
      if (epoch !== captureEpochRef.current || predictionToken !== predictTokenRef.current) return;
      const replacementId = replaceSampleId;
      const currentSamples = samplesRef.current;
      const replacementTarget = replacementId ? currentSamples.find((s) => s.sampleId === replacementId) : undefined;
      const inherit = currentSamples.length > 0 ? currentSamples[currentSamples.length - 1].transform : null;
      const nextId = replacementTarget ? replacementTarget.sampleId : nextSampleId(usedSampleIdsRef.current);

      const sample: SampleData = {
        sampleId: nextId,
        captureId,
        pageNumber: replacementTarget?.pageNumber ?? selectedPage,
        width: frozenSize?.width ?? 0,
        height: frozenSize?.height ?? 0,
        prompts,
        outerContours: resp.outer_contours,
        holeContours: resp.hole_contours,
        transform: replacementTarget
          ? replacementTarget.transform
          : inherit
            ? {
                tx: inherit.tx,
                ty: inherit.ty,
                rotationDeg: inherit.rotationDeg,
                visible: true,
                color: sampleColor(samples.length),
              }
            : {
                tx: 0,
                ty: 0,
                rotationDeg: 0,
                visible: true,
                color: sampleColor(samples.length),
              },
              style: replacementTarget?.style ?? { ...DEFAULT_SAMPLE_STYLE, color: sampleColor(samples.length) },
        capturePngHex: frozenImageHex,
        maskPngHex: resp.mask_png_hex,
        contourBwPngHex: resp.contour_bw_png_hex,
      };

      if (replacementTarget) {
        const ok = window.confirm(language === "ja" ? `サンプル ${replacementTarget.sampleId} のマスクを現在の結果で置き換えますか？` : `Replace sample ${replacementTarget.sampleId} mask with current segmentation?`);
        if (!ok) {
          setStatusText("Replace cancelled");
          return;
        }
        editProject(currentSamples.map((s) => (s.sampleId === replacementTarget.sampleId ? sample : s)));
        setReplaceSampleId(null);
      } else {
        if (replacementId) {
          setReplaceSampleId(null);
        }
        usedSampleIdsRef.current.add(sample.sampleId);
        editProject([...currentSamples, sample]);
      }

      setSelectedSampleId(sample.sampleId);
      setStatusText(`Accepted mask as Sample ${sample.sampleId}`);
      onRedoSegmentation();
    } catch (err) {
      if (epoch !== captureEpochRef.current) return;
      setStatusText(`Accept error: ${(err as Error).message}`);
    }
  }

  function updateSample(sampleId: string, patch: Partial<SampleData["transform"]>) {
    editProject(samplesRef.current.map((s) => (s.sampleId === sampleId ? { ...s, transform: { ...s.transform, ...patch } } : s)));
  }

  function updateSampleStyle(sampleId: string, patch: Partial<SampleStyle>) {
    editProject(samplesRef.current.map((s) => (s.sampleId === sampleId ? { ...s, style: { ...s.style, ...patch } } : s)));
  }

  function applyStyleToAll(style: SampleStyle) {
    editProject(samplesRef.current.map((s) => ({ ...s, style: { ...style } })));
  }

  function deleteSample(sampleId: string) {
    editProject(samplesRef.current.filter((s) => s.sampleId !== sampleId));
    if (selectedSampleId === sampleId) {
      setSelectedSampleId(null);
    }
  }

  async function redoSelectedSample() {
    if (!selectedSampleId) {
      return;
    }
    const target = samples.find((s) => s.sampleId === selectedSampleId);
    if (!target) {
      return;
    }

    if (!confirmDiscardActiveSegmentation("capture")) return;
    const epoch = ++captureEpochRef.current;
    invalidatePredictions();
    try {
      let captureFile: File;
      if (target.capturePngHex) {
        const bytes = Uint8Array.from((target.capturePngHex.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
        captureFile = new File([bytes], "capture.png", { type: "image/png" });
      } else {
        const fileName = target.captureFile ?? "capture.png";
        captureFile = await fetchFileAsFile(
          sampleFileUrl(projectIdRef.current, target.sampleId, fileName),
          fileName
        );
      }

      const reg = await registerCaptureFile(captureFile);
      await prepareEmbedding(reg.capture_id);
      const captureHex = target.capturePngHex ?? (await fileToHex(captureFile));
      if (epoch !== captureEpochRef.current) return;
      setReplaceSampleId(target.sampleId);
      setCaptureId(reg.capture_id);
      setFrozenImageHex(captureHex);
      setFrozenSize({ width: reg.width, height: reg.height });
      setPrompts([]);
      requestCounterRef.current = 0;
      latestAcceptedRequestIdRef.current = 0;
      invalidatePredictions();
      setSegReady(true);
      setStatusText(`Redo segmentation prepared for Sample ${target.sampleId}`);
    } catch (err) {
      if (epoch !== captureEpochRef.current) return;
      setStatusText(`Redo setup failed: ${(err as Error).message}`);
    }
  }

  function onCancelSegmentation() {
    const hadReplaceTarget = Boolean(replaceSampleId);
    resetActiveSegmentation();
    if (hadReplaceTarget) {
      setStatusText("Redo replacement cancelled; original sample kept");
      return;
    }
    setStatusText("Capture/segmentation cancelled");
  }

  async function onSaveProject() {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError("");
    const requestId = ++saveRequestRef.current;
    const revision = projectRevisionRef.current;
    const projectId = projectIdRef.current;
    const savedPage = selectedPage;
    const savedScale = overlayScaleRef.current;
    const savedPdf = pdfFile;
    try {
      const savedSamples = structuredClone(samplesRef.current);
      const result = await saveProject(
        projectId,
        {
          project_id: projectId,
          selected_page: savedPage,
          overlay_scale: savedScale,
          samples: savedSamples,
        },
        savedPdf ?? undefined
      );
      if (requestId !== saveRequestRef.current || projectId !== projectIdRef.current) return;
      if (result?.ok === false) throw new Error("Project save was not completed");
      const current = revision === projectRevisionRef.current;
      if (current) {
        markClean();
        setArtifacts({ pdf: result?.result_pdf_url ?? "", archive: result?.archive_url ?? "" });
      }
      if (result?.export_error) {
        setSaveError(`${t("saveExportWarning")}: ${result.export_error}`);
      } else if (result?.artifacts?.result_pdf.status === "missing") {
        setSaveError(t("savedWithoutPdf"));
      }
      setStatusText(current ? `Project saved: ${projectId}` : t("olderRevisionSaved"));
    } catch (err) {
      setSaveError(`${t("saveFailed")}: ${(err as Error).message}`);
      setStatusText(t("saveFailed"));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function onImportProject(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || isImporting || saveInFlightRef.current) return;
    setIsImporting(true);
    setSaveError("");
    try {
      const imported = await importProject(file);
      setStatusText(`${t("importSucceeded")}: ${imported.project_id}`);
      setProjectPickerOpen(true);
    } catch (err) {
      setSaveError(`${t("importFailed")}: ${(err as Error).message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function onLoadProject(pick: string): Promise<boolean> {
      if (saveInFlightRef.current) return false;
      if (!confirmDiscardIfDirty("loadAnother")) {
        return false;
      }
      const proj = await loadProject(pick);
      resetActiveSegmentation();
      projectIdRef.current = proj.project_id;
      setSelectedPage(proj.selected_page);
      setOverlayScale(proj.overlay_scale);
      overlayScaleRef.current = proj.overlay_scale;
      setPdfFile(null);
      setPdfSource(resolvePdfUrl(proj.source_pdf_url));

      const loadedSamples: SampleData[] = proj.samples.map((s) => {
        const captureFile = s.files?.capture ?? "capture.png";
        const maskFile = s.files?.mask ?? "mask.png";
        const contourFile = s.files?.contour_bw ?? "contour_bw.png";
        return {
          sampleId: s.sample_id,
          captureId: s.capture_id,
          pageNumber: s.page_number ?? 1,
          width: s.width,
          height: s.height,
          prompts: s.prompts,
          outerContours: s.contour_points,
          holeContours: s.hole_points,
          transform: {
            tx: s.transform.tx,
            ty: s.transform.ty,
            rotationDeg: s.transform.rotation_deg,
            visible: s.transform.visible,
            color: s.transform.color,
          },
          style: {
            color: s.style?.color ?? s.transform.color,
            lineType: s.style?.line_type ?? "solid",
            widthMm: s.style?.width_mm ?? 0.35,
          },
          captureFile,
          maskFile,
          contourBwFile: contourFile,
        };
      });
      setSamples(loadedSamples);
      samplesRef.current = loadedSamples;
      usedSampleIdsRef.current = new Set([...loadedSamples.map((s) => s.sampleId), ...(proj.reserved_sample_ids ?? [])]);
      clearHistory();
      setSelectedSampleId(loadedSamples[0]?.sampleId ?? null);
      projectRevisionRef.current += 1;
      markClean();
      setArtifacts(null);
      setSaveError("");
      setStatusText(`Loaded project ${pick}`);
      return true;
  }

  const hasSegCandidates = candidateMasks.length > 0;
  const selectedMaskDataUrl = useMemo(() => {
    if (!maskPreviewHex) {
      return "";
    }
    return hexToDataUrl(maskPreviewHex);
  }, [maskPreviewHex]);
  const renderedPanelWidths = useMemo(() => clampPanelWidths(panelWidths.camera, panelWidths.pdf), [panelWidths, viewportWidth]);
  const compactLayout = viewportWidth <= COMPACT_WIDTH;
  const operationalError = /^(Startup error:|SAM error:|Capture error:|Accept error:|Redo setup failed:)/.test(statusText)
    ? translateStatus(language, statusText) : "";

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">AI自動投影</div>
        <label className="action-btn">
          {t("openPdf")}
          <input type="file" accept="application/pdf" onChange={onOpenPdf} disabled={isSaving} />
        </label>
        <button className="action-btn primary-action" onClick={onCapture}>{t("capture")}</button>
        <button className="action-btn" onClick={onSaveProject} disabled={isSaving}>{t(isSaving ? "saving" : "save")}</button>
        <button className="action-btn" onClick={() => setProjectPickerOpen(true)} disabled={isSaving}>{t("load")}</button>
        <label className="action-btn">{t("importArchive")}<input type="file" accept=".hkai" onChange={onImportProject} disabled={isSaving || isImporting} /></label>
        {artifacts?.pdf ? <a className="action-btn" href={resolveApiPath(artifacts.pdf)} download={`${projectIdRef.current}.pdf`}>{t("downloadPdf")}</a> : null}
        {artifacts?.archive ? <a className="action-btn" href={resolveApiPath(artifacts.archive)} download={`${projectIdRef.current}.hkai`}>{t("downloadArchive")}</a> : null}
        <button className="action-btn layout-reset" onClick={resetLayout}>{t("resetLayout")}</button>
        {compactLayout ? <button ref={inspectorToggleRef} className="inspector-toggle" aria-expanded={inspectorOpen} aria-controls="inspector-drawer" onClick={() => setInspectorOpen((open) => !open)}>{t(inspectorOpen ? "hideInspector" : "showInspector")}</button> : null}
        <div className="status-summary" tabIndex={0} title={`${translateStatus(language, gpuStatus)}\n${translateStatus(language, statusText)}\n${t(isDirty ? "unsaved" : "saved")}`}>
          <span>{translateStatus(language, gpuStatus)}</span>
          <span aria-live="polite">{translateStatus(language, statusText)}</span>
          <span>{t(isSaving ? "saving" : isDirty ? "unsaved" : "saved")}</span>
          {captureId ? <span>{t("temporaryCapture")}</span> : null}
        </div>
        <div className="language-switch" role="group" aria-label={t("language")}>
          <button className={language === "ja" ? "active" : ""} onClick={() => setLanguage("ja")}>日本語</button>
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button>
        </div>
      </header>
      {saveError || operationalError ? <div className="operation-error" role="alert"><span>{saveError || operationalError}</span><button onClick={() => { setSaveError(""); if (operationalError) setStatusText("Ready"); }}>{t("dismiss")}</button></div> : null}

      <main className={compactLayout ? "layout-grid compact-layout" : "layout-grid"} style={{ "--camera-pane-width": `${renderedPanelWidths.camera}px`, "--pdf-pane-width": `${renderedPanelWidths.pdf}px` } as React.CSSProperties}>
        <section className="camera-pane">
          <CameraPanel
            frozenImageHex={frozenImageHex}
            frozenSize={frozenSize}
            promptPoints={prompts}
            maskHex={maskPreviewHex}
            cameraStatus={cameraStatus}
            segmentationReady={segReady}
            onAddPoint={onAddPrompt}
            onOpenImage={onOpenImage}
            onReturnToLive={onReturnToLive}
            language={language}
          >
            {captureId ? <div className="hint warn" role="status">{t("temporaryCapture")}</div> : null}
            <SegmentationControls
              language={language} prompts={prompts.length} isPredicting={isPredicting} hasSegCandidates={hasSegCandidates} hasLatestPrediction={hasLatestPrediction}
              candidateScores={candidateScores} selectedCandidateIndex={selectedCandidateIndex} selectedMaskDataUrl={selectedMaskDataUrl}
              onUndoPrompt={onUndoPrompt} onResetPrompts={onResetPrompts} onRedoSegmentation={onRedoSegmentation} onAcceptMask={onAcceptMask} onCancelSegmentation={onCancelSegmentation}
              onSelectCandidate={(index) => { setSelectedCandidateIndex(index); setMaskPreviewHex(candidateMasks[index] ?? ""); }}
            />
          </CameraPanel>
        </section>

        <div className="resize-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("resizeCamera")} aria-valuenow={renderedPanelWidths.camera} onPointerDown={(event) => startResizeDivider("camera", event)} onKeyDown={(event) => onDividerKeyDown("camera", event)} />

        <section className="pdf-pane">
          <PdfOverlayPanel
            pdfSource={pdfSource}
            selectedPage={selectedPage}
            setSelectedPage={(page) => { if (page !== selectedPage) { setSelectedPage(page); markDirty(); } }}
            samples={samples}
            selectedSampleId={selectedSampleId}
            setSelectedSampleId={setSelectedSampleId}
            overlayScale={overlayScale}
            onUpdateSample={updateSample}
            onSampleEditStart={startSampleGesture}
            onSampleEditEnd={endSampleGesture}
            language={language}
          />
        </section>
        {!compactLayout ? <div className="resize-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("resizePdf")} aria-valuenow={renderedPanelWidths.pdf} onPointerDown={(event) => startResizeDivider("pdf", event)} onKeyDown={(event) => onDividerKeyDown("pdf", event)} /> : null}
        <div id="inspector-drawer" className={compactLayout ? "inspector-wrap drawer" : "inspector-wrap"} hidden={compactLayout && !inspectorOpen} onKeyDown={(event) => { if (compactLayout && event.key === "Escape") { setInspectorOpen(false); inspectorToggleRef.current?.focus(); } }}>
        <InspectionInspector
          language={language} isPredicting={isPredicting}
          samples={samples} selectedSampleId={selectedSampleId} overlayScale={overlayScale} styleColors={STYLE_COLORS} defaultStyle={DEFAULT_SAMPLE_STYLE}
          onSelectSample={setSelectedSampleId}
          onUpdateSample={updateSample} onUpdateSampleStyle={updateSampleStyle} onApplyStyleToAll={applyStyleToAll} onDeleteSample={deleteSample}
          onRedoSelectedSample={redoSelectedSample} onSetOverlayScale={(scale) => editProject(samplesRef.current, scale)}
          canUndo={historyVersion >= 0 && pastRef.current.length > 0} canRedo={historyVersion >= 0 && futureRef.current.length > 0}
          onUndo={() => restoreHistory("undo")} onRedo={() => restoreHistory("redo")}
        />
        </div>
      </main>
      {projectPickerOpen ? <ProjectPicker language={language} onClose={() => setProjectPickerOpen(false)} onLoad={onLoadProject} /> : null}
    </div>
  );
}
