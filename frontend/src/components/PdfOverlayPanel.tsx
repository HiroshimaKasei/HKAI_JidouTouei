import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Group, Layer, Line, Stage } from "react-konva";

import { translate, type Language } from "../i18n";
import type { SampleData } from "../types/models";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type Props = {
  pdfSource: string | File | null;
  selectedPage: number;
  setSelectedPage: (v: number) => void;
  samples: SampleData[];
  selectedSampleId: string | null;
  setSelectedSampleId: (id: string | null) => void;
  overlayScale: number;
  onUpdateSample: (sampleId: string, patch: Partial<SampleData["transform"]>) => void;
  onSampleEditStart?: (sampleId: string) => void;
  onSampleEditEnd?: (sampleId: string) => void;
  language: Language;
};

type DragMode =
  | { kind: "none" }
  | {
      kind: "translate";
      sampleId: string;
      startPointer: { x: number; y: number };
      startTx: number;
      startTy: number;
    }
  | {
      kind: "rotate";
      sampleId: string;
      startAngleDeg: number;
      startRotDeg: number;
    };

const COLORS = ["#ff5500", "#0099ff", "#17a05d", "#c83f7f", "#b68000", "#1e78b7"];
export const sampleColor = (index: number) => COLORS[index % COLORS.length];

function dashFor(lineType: SampleData["style"]["lineType"]): number[] {
  if (lineType === "dashed") {
    return [8, 5];
  }
  if (lineType === "dash_dot") {
    return [10, 4, 2, 4];
  }
  return [];
}

function calcCentroid(sample: SampleData): { x: number; y: number } {
  const all = [...sample.outerContours, ...sample.holeContours].flat();
  if (all.length === 0) {
    return { x: 0, y: 0 };
  }
  let sx = 0;
  let sy = 0;
  for (const p of all) {
    sx += p[0];
    sy += p[1];
  }
  return { x: sx / all.length, y: sy / all.length };
}

export function transformedContourBounds(sample: SampleData, overlayScale: number): { centerX: number; centerY: number } | null {
  const points = [...sample.outerContours, ...sample.holeContours].flat();
  if (points.length === 0) {
    return null;
  }

  const centroid = calcCentroid(sample);
  const radians = sample.transform.rotationDeg * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const localX = (point[0] - centroid.x) * overlayScale;
    const localY = (point[1] - centroid.y) * overlayScale;
    const x = sample.transform.tx + centroid.x + localX * cosine - localY * sine;
    const y = sample.transform.ty + centroid.y + localX * sine + localY * cosine;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return { centerX: (minX + maxX) * 0.5, centerY: (minY + maxY) * 0.5 };
}

export function PdfOverlayPanel({
  pdfSource,
  selectedPage,
  setSelectedPage,
  samples,
  selectedSampleId,
  setSelectedSampleId,
  overlayScale,
  onUpdateSample,
  onSampleEditStart,
  onSampleEditEnd,
  language,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const documentSequence = useRef(0);
  const documentRequest = useMemo(() => ({ key: ++documentSequence.current }), [pdfSource]);
  const pageRequest = useMemo(() => ({}), [documentRequest, selectedPage]);
  const activeDocument = useRef(documentRequest);
  const activePage = useRef(pageRequest);
  const currentPage = useRef(selectedPage);
  const fitNewDocument = useRef(true);
  const sampleGesture = useRef<string | null>(null);
  const editEndRef = useRef(onSampleEditEnd);
  const [numPages, setNumPages] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 1000, height: 1300 });
  const [nativePageWidth, setNativePageWidth] = useState(1000);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [middleDragging, setMiddleDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });
  const [pendingRecenterSampleId, setPendingRecenterSampleId] = useState<string | null>(null);
  const [renderedPage, setRenderedPage] = useState<object | null>(null);

  function endSampleGesture() {
    const sampleId = sampleGesture.current;
    if (sampleId === null) return;
    sampleGesture.current = null;
    editEndRef.current?.(sampleId);
  }

  useLayoutEffect(() => {
    editEndRef.current = onSampleEditEnd;
  }, [onSampleEditEnd]);

  useLayoutEffect(() => {
    activeDocument.current = documentRequest;
    fitNewDocument.current = true;
    setNumPages(0);
    setPendingRecenterSampleId(null);
    setRenderedPage(null);
    setPageSize({ width: 1000, height: 1300 });
    setNativePageWidth(1000);
    setPdfZoom(1);
    setViewportPan({ x: 0, y: 0 });
    setMiddleDragging(false);
    setDragMode({ kind: "none" });
    endSampleGesture();
  }, [documentRequest]);

  useLayoutEffect(() => {
    activePage.current = pageRequest;
    currentPage.current = selectedPage;
    endSampleGesture();
    setDragMode({ kind: "none" });
  }, [pageRequest]);

  useEffect(() => {
    function finishGesture() {
      endSampleGesture();
      setMiddleDragging(false);
      setDragMode({ kind: "none" });
    }
    window.addEventListener("mouseup", finishGesture);
    window.addEventListener("blur", finishGesture);
    return () => {
      window.removeEventListener("mouseup", finishGesture);
      window.removeEventListener("blur", finishGesture);
      endSampleGesture();
    };
  }, []);

  const visibleSamples = useMemo(
    () => samples.filter((s) => s.transform.visible && (s.pageNumber ?? 1) === selectedPage),
    [samples, selectedPage]
  );

  const centroidBySample = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const s of visibleSamples) {
      map.set(s.sampleId, calcCentroid(s));
    }
    return map;
  }, [visibleSamples]);

  const selectedSample = samples.find((sample) => sample.sampleId === selectedSampleId) ?? null;
  const selectedBounds = selectedSample ? transformedContourBounds(selectedSample, overlayScale) : null;

  function centerViewportOnSample(sample: SampleData) {
    const bounds = transformedContourBounds(sample, overlayScale);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!bounds || !rect) {
      return;
    }
    setViewportPan({ x: rect.width / 2 - bounds.centerX * pdfZoom, y: rect.height / 2 - bounds.centerY * pdfZoom });
  }

  useEffect(() => {
    if (!pendingRecenterSampleId || renderedPage !== pageRequest) {
      return;
    }
    const pendingSample = samples.find((sample) => sample.sampleId === pendingRecenterSampleId);
    if (!pendingSample || (pendingSample.pageNumber ?? 1) !== selectedPage) {
      setPendingRecenterSampleId(null);
      return;
    }
    centerViewportOnSample(pendingSample);
    setPendingRecenterSampleId(null);
  }, [pendingRecenterSampleId, renderedPage, pageRequest, selectedPage, samples, overlayScale, pdfZoom]);

  function onDocLoadSuccess(info: { numPages: number }) {
    if (activeDocument.current !== documentRequest) return;
    setNumPages(info.numPages);
    if (currentPage.current > info.numPages) {
      setSelectedPage(info.numPages);
    }
  }

  function toContentPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    return {
      x: (clientX - rect.left - viewportPan.x) / pdfZoom,
      y: (clientY - rect.top - viewportPan.y) / pdfZoom,
    };
  }

  function onWheel(ev: React.WheelEvent<HTMLDivElement>) {
    ev.preventDefault();
    fitNewDocument.current = false;
    const factor = ev.deltaY < 0 ? 1.1 : 0.9;
    const next = Math.min(8, Math.max(0.2, pdfZoom * factor));
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      setPdfZoom(next);
      return;
    }

    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const ox = (cx - viewportPan.x) / pdfZoom;
    const oy = (cy - viewportPan.y) / pdfZoom;
    const nx = cx - ox * next;
    const ny = cy - oy * next;

    setPdfZoom(next);
    setViewportPan({ x: nx, y: ny });
  }

  function onViewportMouseDown(ev: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (ev.button !== 1) {
      return;
    }
    fitNewDocument.current = false;
    setMiddleDragging(true);
    setLastMouse({ x: ev.clientX, y: ev.clientY });
  }

  function onViewportMouseMove(ev: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (!middleDragging || dragMode.kind !== "none") {
      return;
    }
    const dx = ev.clientX - lastMouse.x;
    const dy = ev.clientY - lastMouse.y;
    setLastMouse({ x: ev.clientX, y: ev.clientY });
    setViewportPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onViewportMouseUp() {
    setMiddleDragging(false);
    setDragMode({ kind: "none" });
    endSampleGesture();
  }

  function recenterSelectedContour() {
    if (!selectedSample || !selectedBounds) {
      return;
    }
    fitNewDocument.current = false;
    const samplePage = selectedSample.pageNumber ?? 1;
    if (samplePage !== selectedPage || renderedPage !== pageRequest) {
      setPendingRecenterSampleId(selectedSample.sampleId);
      setSelectedPage(samplePage);
      return;
    }
    centerViewportOnSample(selectedSample);
  }

  function fitView(mode: "page" | "width", size = pageSize) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const zoom = Math.min(8, Math.max(0.2, mode === "width" ? rect.width / size.width : Math.min(rect.width / size.width, rect.height / size.height)));
    setPdfZoom(zoom);
    setViewportPan({ x: (rect.width - size.width * zoom) / 2, y: mode === "page" ? (rect.height - size.height * zoom) / 2 : 0 });
  }

  function onSampleMouseDown(sample: SampleData, evt: MouseEvent) {
    setSelectedSampleId(sample.sampleId);
    const pointer = toContentPoint(evt.clientX, evt.clientY);
    if (!pointer) {
      return;
    }

    if (evt.button === 0 || evt.button === 2) {
      endSampleGesture();
      sampleGesture.current = sample.sampleId;
      onSampleEditStart?.(sample.sampleId);
    }

    if (evt.button === 0) {
      setDragMode({
        kind: "translate",
        sampleId: sample.sampleId,
        startPointer: pointer,
        startTx: sample.transform.tx,
        startTy: sample.transform.ty,
      });
      return;
    }

    if (evt.button === 2) {
      evt.preventDefault();
      const c = centroidBySample.get(sample.sampleId) ?? { x: 0, y: 0 };
      const center = {
        x: sample.transform.tx + c.x,
        y: sample.transform.ty + c.y,
      };
      const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI);
      setDragMode({
        kind: "rotate",
        sampleId: sample.sampleId,
        startAngleDeg: angle,
        startRotDeg: sample.transform.rotationDeg,
      });
    }
  }

  function onStageMouseMove(ev: { evt: MouseEvent }) {
    const pointer = toContentPoint(ev.evt.clientX, ev.evt.clientY);
    if (!pointer) {
      return;
    }

    if (dragMode.kind === "translate") {
      const sample = samples.find((s) => s.sampleId === dragMode.sampleId);
      if (!sample) {
        return;
      }
      onUpdateSample(sample.sampleId, {
        tx: dragMode.startTx + (pointer.x - dragMode.startPointer.x),
        ty: dragMode.startTy + (pointer.y - dragMode.startPointer.y),
      });
      return;
    }

    if (dragMode.kind === "rotate") {
      const sample = samples.find((s) => s.sampleId === dragMode.sampleId);
      if (!sample) {
        return;
      }
      const c = centroidBySample.get(sample.sampleId) ?? { x: 0, y: 0 };
      const center = {
        x: sample.transform.tx + c.x,
        y: sample.transform.ty + c.y,
      };
      const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI);
      onUpdateSample(sample.sampleId, {
        rotationDeg: dragMode.startRotDeg + (angle - dragMode.startAngleDeg),
      });
    }
  }

  const stageW = pageSize.width;
  const stageH = pageSize.height;

  return (
    <div className="panel pdf-panel">
      <div className="panel-title">{translate(language, "pdfOverlay")}</div>
      <div className="page-toolbar">
        <button onClick={() => setSelectedPage(Math.max(1, selectedPage - 1))} disabled={!pdfSource || selectedPage <= 1}>{translate(language, "previous")}</button>
        <span>{translate(language, "page")} {selectedPage}{numPages ? ` / ${numPages}` : ""}</span>
        <button onClick={() => setSelectedPage(Math.min(numPages, selectedPage + 1))} disabled={!numPages || selectedPage >= numPages}>{translate(language, "next")}</button>
        <span>{translate(language, "zoom")} {Math.round(pdfZoom * 100)}%</span>
        <button type="button" onClick={() => { fitNewDocument.current = false; fitView("page"); }} disabled={!pdfSource || renderedPage !== pageRequest}>{translate(language, "fitPage")}</button>
        <button type="button" onClick={() => { fitNewDocument.current = false; fitView("width"); }} disabled={!pdfSource || renderedPage !== pageRequest}>{translate(language, "fitWidth")}</button>
        <button type="button" onClick={() => { fitNewDocument.current = false; setPdfZoom(1); setViewportPan({ x: 0, y: 0 }); }} disabled={!pdfSource}>{translate(language, "resetView")}</button>
        <button type="button" onClick={recenterSelectedContour} disabled={!selectedBounds} title={translate(language, "recenterContour")}>{translate(language, "recenterContour")}</button>
      </div>
      <div
        ref={viewportRef}
        className="pdf-viewport"
        onWheel={onWheel}
        onMouseDown={onViewportMouseDown}
        onMouseMove={onViewportMouseMove}
        onMouseUp={onViewportMouseUp}
        onMouseLeave={onViewportMouseUp}
        onPointerCancel={onViewportMouseUp}
      >
        <div
          className="pdf-layer-stack"
          style={{ transform: `translate(${viewportPan.x}px, ${viewportPan.y}px) scale(${pdfZoom})`, transformOrigin: "0 0" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {pdfSource ? <Document key={documentRequest.key} file={pdfSource} onLoadSuccess={onDocLoadSuccess} loading={translate(language, "pdfLoading")} error={translate(language, "pdfError")}>
            <Page
              key={selectedPage}
              pageNumber={selectedPage}
              width={1000}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(page) => {
                if (activePage.current !== pageRequest) return;
                const viewport = page.getViewport({ scale: 1 });
                const size = { width: 1000, height: 1000 * viewport.height / viewport.width };
                setPageSize(size);
                setNativePageWidth(viewport.width);
                setRenderedPage(pageRequest);
                if (fitNewDocument.current) {
                  fitNewDocument.current = false;
                  fitView("page", size);
                }
              }}
            />
          </Document> : <div className="pdf-empty">{translate(language, "noPdf")}</div>}
          <div className="overlay-stage-wrap">
            <Stage width={stageW} height={stageH} onMouseMove={onStageMouseMove} onMouseUp={onViewportMouseUp}>
              <Layer>
                {visibleSamples.map((sample) => {
                  const isSelected = sample.sampleId === selectedSampleId;
                  const displayUnitsPerPoint = 1000 / nativePageWidth;
                  const baseStroke = sample.style.widthMm * 72 / 25.4 * displayUnitsPerPoint;
                  const centroid = centroidBySample.get(sample.sampleId) ?? { x: 0, y: 0 };
                  const allContours = [...sample.outerContours, ...sample.holeContours];

                  return (
                    <Group
                      key={sample.sampleId}
                      x={sample.transform.tx + centroid.x}
                      y={sample.transform.ty + centroid.y}
                      rotation={sample.transform.rotationDeg}
                      scaleX={overlayScale}
                      scaleY={overlayScale}
                      listening
                      onMouseDown={(e) => onSampleMouseDown(sample, e.evt as MouseEvent)}
                      onContextMenu={(e) => e.evt.preventDefault()}
                    >
                      {allContours.map((contour, idx) => {
                        const shifted = contour.flatMap((pt) => [pt[0] - centroid.x, pt[1] - centroid.y]);
                        return (
                          <Line
                            key={`${sample.sampleId}-${idx}`}
                            points={shifted}
                            closed
                            stroke={sample.style.color}
                            dash={dashFor(sample.style.lineType).map((length) => length * displayUnitsPerPoint / Math.max(overlayScale, 0.01))}
                            strokeWidth={(isSelected ? baseStroke + 1 : baseStroke) / Math.max(overlayScale, 0.01)}
                            hitStrokeWidth={10 / Math.max(overlayScale, 0.01)}
                            listening
                          />
                        );
                      })}
                    </Group>
                  );
                })}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
      <div className="hint">{translate(language, "pdfHint")}</div>
    </div>
  );
}
