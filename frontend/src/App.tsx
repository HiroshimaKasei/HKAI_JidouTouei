import { useEffect, useMemo, useRef, useState } from "react";

import {
  acceptMask,
  capture,
  getCameraStatus,
  getHealth,
  listProjects,
  loadProject,
  registerCaptureImage,
  prepareEmbedding,
  predictMask,
  resolvePdfUrl,
  saveProject,
} from "./api";
import { CameraPanel } from "./components/CameraPanel";
import { PdfOverlayPanel, sampleColor } from "./components/PdfOverlayPanel";
import type { CameraStatus, PromptPoint, SampleData } from "./types/models";

function hexToDataUrl(hex: string, mime = "image/png"): string {
  const bytes = hex.match(/.{1,2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") ?? "";
  return `data:${mime};base64,${btoa(bytes)}`;
}

async function fetchAsHex(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  const ab = await res.arrayBuffer();
  const arr = new Uint8Array(ab);
  return Array.from(arr)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function App() {
  const [statusText, setStatusText] = useState("Initializing");
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null);
  const [gpuStatus, setGpuStatus] = useState<string>("Checking GPU");

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

  const [samples, setSamples] = useState<SampleData[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [replaceSampleId, setReplaceSampleId] = useState<string | null>(null);

  const requestCounterRef = useRef(0);
  const latestAppliedRequestRef = useRef(0);

  const projectIdRef = useRef(`project_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`);

  useEffect(() => {
    (async () => {
      try {
        const [health, cam] = await Promise.all([getHealth(), getCameraStatus()]);
        setCameraStatus(cam);
        const gpu = (health as { gpu?: { device_name?: string; capability?: string; model_loaded?: boolean } }).gpu;
        if (gpu) {
          setGpuStatus(`${gpu.device_name ?? "GPU"} sm_${gpu.capability?.replace(".", "") ?? "??"} SAM:${gpu.model_loaded ? "loaded" : "idle"}`);
        }
        setStatusText("Ready");
      } catch (err) {
        setStatusText(`Startup error: ${(err as Error).message}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!captureId || !segReady) {
      return;
    }
    const posCount = prompts.filter((p) => p.label === 1).length;
    if (posCount === 0) {
      setCandidateMasks([]);
      setCandidateScores([]);
      setMaskPreviewHex("");
      return;
    }

    const reqId = ++requestCounterRef.current;
    setStatusText("Running SAM inference...");

    void predictMask(captureId, prompts, reqId)
      .then((resp) => {
        if (resp.request_id < latestAppliedRequestRef.current) {
          return;
        }
        latestAppliedRequestRef.current = resp.request_id;
        setCandidateMasks(resp.masks);
        setCandidateScores(resp.scores);
        const idx = resp.best_index >= 0 ? resp.best_index : 0;
        setSelectedCandidateIndex(idx);
        setMaskPreviewHex(resp.masks[idx] ?? "");
        setStatusText("Segmentation updated");
      })
      .catch((err) => setStatusText(`SAM error: ${(err as Error).message}`));
  }, [captureId, prompts, segReady]);

  async function onOpenPdf(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) {
      return;
    }
    setPdfFile(file);
    setPdfSource(file);
    setSelectedPage(1);
    setStatusText(`Loaded PDF: ${file.name}`);
  }

  async function onCapture() {
    setStatusText("Capturing frame...");
    try {
      const cap = await capture();
      setCaptureId(cap.capture_id);
      setFrozenSize({ width: cap.width, height: cap.height });
      setFrozenImageHex(cap.capture_png_hex);
      setPrompts([]);
      setMaskPreviewHex("");
      setCandidateMasks([]);
      setCandidateScores([]);
      setSelectedCandidateIndex(0);
      latestAppliedRequestRef.current = 0;
      requestCounterRef.current = 0;

      await prepareEmbedding(cap.capture_id);
      setSegReady(true);
      setStatusText("Capture frozen. Add SAM prompts.");
    } catch (err) {
      setStatusText(`Capture error: ${(err as Error).message}`);
    }
  }

  function onAddPrompt(p: PromptPoint) {
    setPrompts((prev) => [...prev, p]);
  }

  function onUndoPrompt() {
    setPrompts((prev) => prev.slice(0, -1));
  }

  function onResetPrompts() {
    setPrompts([]);
    setMaskPreviewHex("");
    setCandidateMasks([]);
    setCandidateScores([]);
    setSelectedCandidateIndex(0);
  }

  function onRedoSegmentation() {
    onResetPrompts();
    setStatusText("Segmentation restarted on frozen image");
  }

  async function onAcceptMask() {
    if (!captureId) {
      return;
    }
    if (!candidateMasks[selectedCandidateIndex]) {
      setStatusText("No mask candidate selected");
      return;
    }

    try {
      const resp = await acceptMask(captureId, latestAppliedRequestRef.current, selectedCandidateIndex);
      const inherit = samples.length > 0 ? samples[samples.length - 1].transform : null;
      const nextId = replaceSampleId ?? String(samples.length + 1).padStart(3, "0");

      const replacementTarget = samples.find((s) => s.sampleId === replaceSampleId);
      const sample: SampleData = {
        sampleId: nextId,
        captureId,
        width: frozenSize?.width ?? 0,
        height: frozenSize?.height ?? 0,
        prompts,
        outerContours: resp.outer_contours,
        holeContours: resp.hole_contours,
        transform: replacementTarget
          ? replacementTarget.transform
          : inherit
            ? { ...inherit }
            : {
                tx: 0,
                ty: 0,
                rotationDeg: 0,
                visible: true,
                color: sampleColor(samples.length),
              },
        capturePngHex: frozenImageHex,
        maskPngHex: resp.mask_png_hex,
        contourBwPngHex: resp.contour_bw_png_hex,
      };

      if (replaceSampleId) {
        const ok = window.confirm(`Replace sample ${replaceSampleId} mask with current segmentation?`);
        if (!ok) {
          setStatusText("Replace cancelled");
          return;
        }
        setSamples((prev) => prev.map((s) => (s.sampleId === replaceSampleId ? sample : s)));
        setReplaceSampleId(null);
      } else {
        setSamples((prev) => [...prev, sample]);
      }

      setSelectedSampleId(sample.sampleId);
      setStatusText(`Accepted mask as Sample ${sample.sampleId}`);
      onRedoSegmentation();
    } catch (err) {
      setStatusText(`Accept error: ${(err as Error).message}`);
    }
  }

  function updateSample(sampleId: string, patch: Partial<SampleData["transform"]>) {
    setSamples((prev) => prev.map((s) => (s.sampleId === sampleId ? { ...s, transform: { ...s.transform, ...patch } } : s)));
  }

  function deleteSample(sampleId: string) {
    setSamples((prev) => prev.filter((s) => s.sampleId !== sampleId));
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

    try {
      const reg = await registerCaptureImage(target.capturePngHex);
      await prepareEmbedding(reg.capture_id);
      setReplaceSampleId(target.sampleId);
      setCaptureId(reg.capture_id);
      setFrozenImageHex(target.capturePngHex);
      setFrozenSize({ width: reg.width, height: reg.height });
      setPrompts([]);
      setMaskPreviewHex("");
      setCandidateMasks([]);
      setCandidateScores([]);
      setSelectedCandidateIndex(0);
      latestAppliedRequestRef.current = 0;
      requestCounterRef.current = 0;
      setSegReady(true);
      setStatusText(`Redo segmentation prepared for Sample ${target.sampleId}`);
    } catch (err) {
      setStatusText(`Redo setup failed: ${(err as Error).message}`);
    }
  }

  async function onSaveProject() {
    try {
      await saveProject(
        projectIdRef.current,
        {
          project_id: projectIdRef.current,
          selected_page: selectedPage,
          overlay_scale: overlayScale,
          samples,
        },
        pdfFile ?? undefined
      );
      setStatusText(`Project saved: ${projectIdRef.current}`);
    } catch (err) {
      setStatusText(`Save failed: ${(err as Error).message}`);
    }
  }

  async function onLoadProject() {
    try {
      const projects = await listProjects();
      if (projects.length === 0) {
        setStatusText("No saved projects");
        return;
      }
      const pick = window.prompt("Enter project id", projects[projects.length - 1]);
      if (!pick) {
        return;
      }
      const proj = await loadProject(pick);
      projectIdRef.current = proj.project_id;
      setSelectedPage(proj.selected_page);
      setOverlayScale(proj.overlay_scale);
      setPdfFile(null);
      setPdfSource(resolvePdfUrl(proj.source_pdf_url));

      const loadedSamples: SampleData[] = [];
      for (const s of proj.samples) {
        const captureHex = await fetchAsHex(`http://127.0.0.1:8000/api/project/${proj.project_id}/samples/${s.sample_id}/capture.png`);
        const maskHex = await fetchAsHex(`http://127.0.0.1:8000/api/project/${proj.project_id}/samples/${s.sample_id}/mask.png`);
        const contourHex = await fetchAsHex(`http://127.0.0.1:8000/api/project/${proj.project_id}/samples/${s.sample_id}/contour_bw.png`);
        loadedSamples.push({
          sampleId: s.sample_id,
          captureId: s.capture_id,
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
          capturePngHex: captureHex,
          maskPngHex: maskHex,
          contourBwPngHex: contourHex,
        });
      }
      setSamples(loadedSamples);
      setSelectedSampleId(loadedSamples[0]?.sampleId ?? null);
      setStatusText(`Loaded project ${pick}`);
    } catch (err) {
      setStatusText(`Load failed: ${(err as Error).message}`);
    }
  }

  const hasSegCandidates = candidateMasks.length > 0;

  const selectedMaskDataUrl = useMemo(() => {
    if (!maskPreviewHex) {
      return "";
    }
    return hexToDataUrl(maskPreviewHex);
  }, [maskPreviewHex]);

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">HKAI JidouTouei MVP</div>
        <label className="action-btn">
          Open PDF
          <input type="file" accept="application/pdf" onChange={onOpenPdf} />
        </label>
        <button className="action-btn" onClick={onCapture}>Capture</button>
        <button className="action-btn" onClick={onSaveProject}>Save</button>
        <button className="action-btn" onClick={onLoadProject}>Load</button>
        <div className="status-chip">{gpuStatus}</div>
        <div className="status-chip">{statusText}</div>
      </header>

      <main className="layout-grid">
        <section className="left-pane">
          <CameraPanel
            frozenImageHex={frozenImageHex}
            frozenSize={frozenSize}
            promptPoints={prompts}
            maskHex={maskPreviewHex}
            cameraStatus={cameraStatus}
            segmentationReady={segReady}
            onAddPoint={onAddPrompt}
          />

          <div className="panel">
            <div className="panel-title">Segmentation Controls</div>
            <div className="control-row">
              <button onClick={onUndoPrompt} disabled={prompts.length === 0}>Undo Prompt</button>
              <button onClick={onResetPrompts}>Reset Prompts</button>
              <button onClick={onRedoSegmentation}>Redo</button>
            </div>
            <div className="control-row">
              <button onClick={onAcceptMask} disabled={!hasSegCandidates}>Accept Mask</button>
              <button onClick={() => setReplaceSampleId(null)}>Cancel</button>
            </div>
            <div className="control-row">
              <label>Candidate</label>
              <select
                value={selectedCandidateIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedCandidateIndex(idx);
                  setMaskPreviewHex(candidateMasks[idx] ?? "");
                }}
              >
                {candidateScores.map((score, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1} ({score.toFixed(3)})
                  </option>
                ))}
              </select>
            </div>
            {selectedMaskDataUrl ? <img className="mini-mask-preview" src={selectedMaskDataUrl} alt="selected mask" /> : null}
          </div>

          <div className="panel">
            <div className="panel-title">Sample List</div>
            <div className="sample-list">
              {samples.map((s) => (
                <div key={s.sampleId} className={selectedSampleId === s.sampleId ? "sample-item active" : "sample-item"}>
                  <button className="sample-label" onClick={() => setSelectedSampleId(s.sampleId)}>
                    Sample {s.sampleId}
                  </button>
                  <button onClick={() => updateSample(s.sampleId, { visible: !s.transform.visible })}>{s.transform.visible ? "Hide" : "Show"}</button>
                  <button onClick={() => deleteSample(s.sampleId)}>Delete</button>
                </div>
              ))}
            </div>
            <div className="control-row">
              <button onClick={redoSelectedSample} disabled={!selectedSampleId}>Redo Segmentation</button>
              <label>
                Overlay Scale
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={overlayScale}
                  onChange={(e) => setOverlayScale(Number(e.target.value) || 1)}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="right-pane">
          <PdfOverlayPanel
            pdfSource={pdfSource}
            selectedPage={selectedPage}
            setSelectedPage={setSelectedPage}
            samples={samples}
            selectedSampleId={selectedSampleId}
            setSelectedSampleId={setSelectedSampleId}
            overlayScale={overlayScale}
            onUpdateSample={updateSample}
          />
        </section>
      </main>
    </div>
  );
}
