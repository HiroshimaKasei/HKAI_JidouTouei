import { useMemo, useRef, useState } from "react";
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
    return [10, 6];
  }
  if (lineType === "dash_dot") {
    return [12, 5, 2, 5];
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

export function PdfOverlayPanel({
  pdfSource,
  selectedPage,
  setSelectedPage,
  samples,
  selectedSampleId,
  setSelectedSampleId,
  overlayScale,
  onUpdateSample,
  language,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 1000, height: 1300 });
  const [pdfZoom, setPdfZoom] = useState(1);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [middleDragging, setMiddleDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });

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

  function onDocLoadSuccess(info: { numPages: number }) {
    setNumPages(info.numPages);
    if (selectedPage > info.numPages) {
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
  }

  function onSampleMouseDown(sample: SampleData, evt: MouseEvent) {
    setSelectedSampleId(sample.sampleId);
    const pointer = toContentPoint(evt.clientX, evt.clientY);
    if (!pointer) {
      return;
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
        <button onClick={() => setSelectedPage(Math.max(1, selectedPage - 1))} disabled={selectedPage <= 1}>{translate(language, "previous")}</button>
        <span>{translate(language, "page")} {selectedPage}{numPages ? ` / ${numPages}` : ""}</span>
        <button onClick={() => setSelectedPage(Math.min(numPages || selectedPage + 1, selectedPage + 1))} disabled={numPages > 0 && selectedPage >= numPages}>{translate(language, "next")}</button>
        <span>{translate(language, "zoom")} {Math.round(pdfZoom * 100)}%</span>
      </div>
      <div
        ref={viewportRef}
        className="pdf-viewport"
        onWheel={onWheel}
        onMouseDown={onViewportMouseDown}
        onMouseMove={onViewportMouseMove}
        onMouseUp={onViewportMouseUp}
        onMouseLeave={onViewportMouseUp}
      >
        <div
          className="pdf-layer-stack"
          style={{ transform: `translate(${viewportPan.x}px, ${viewportPan.y}px) scale(${pdfZoom})`, transformOrigin: "0 0" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {pdfSource ? <Document file={pdfSource} onLoadSuccess={onDocLoadSuccess}>
            <Page
              pageNumber={selectedPage}
              width={1000}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(page) => setPageSize({ width: page.width, height: page.height })}
            />
          </Document> : <div className="pdf-empty">{translate(language, "noPdf")}</div>}
          <div className="overlay-stage-wrap">
            <Stage width={stageW} height={stageH} onMouseMove={onStageMouseMove} onMouseUp={() => setDragMode({ kind: "none" })}>
              <Layer>
                {visibleSamples.map((sample) => {
                  const isSelected = sample.sampleId === selectedSampleId;
                  const baseStroke = Math.max(0.7, sample.style.widthMm * 3.78);
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
                            dash={dashFor(sample.style.lineType)}
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
