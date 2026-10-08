import { useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Layer, Line, Stage } from "react-konva";

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
};

type DragMode = { kind: "none" } | { kind: "translate"; sampleId: string } | { kind: "rotate"; sampleId: string; startDeg: number; startRot: number };

const COLORS = ["#ff5500", "#0099ff", "#17a05d", "#c83f7f", "#b68000", "#1e78b7"];
export const sampleColor = (index: number) => COLORS[index % COLORS.length];

export function PdfOverlayPanel({
  pdfSource,
  selectedPage,
  setSelectedPage,
  samples,
  selectedSampleId,
  setSelectedSampleId,
  overlayScale,
  onUpdateSample,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 1000, height: 1300 });
  const [pdfZoom, setPdfZoom] = useState(1);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [middleDragging, setMiddleDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });

  const visibleSamples = useMemo(() => samples.filter((s) => s.transform.visible), [samples]);

  function onDocLoadSuccess(info: { numPages: number }) {
    setNumPages(info.numPages);
    if (selectedPage > info.numPages) {
      setSelectedPage(info.numPages);
    }
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
    if (!middleDragging) {
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

  function sampleCenter(sample: SampleData): { x: number; y: number } {
    const all = sample.outerContours.flat();
    if (all.length === 0) {
      return { x: 0, y: 0 };
    }
    const sx = all.reduce((acc, p) => acc + p[0], 0);
    const sy = all.reduce((acc, p) => acc + p[1], 0);
    return { x: sx / all.length, y: sy / all.length };
  }

  function onStageMouseDown(ev: { evt: MouseEvent; target: { attrs: Record<string, unknown> } }) {
    const sampleId = ev.target.attrs["data-sid"] as string | undefined;
    if (!sampleId) {
      return;
    }

    const sample = samples.find((s) => s.sampleId === sampleId);
    if (!sample) {
      return;
    }

    setSelectedSampleId(sampleId);

    if (ev.evt.button === 0) {
      setDragMode({ kind: "translate", sampleId });
      setLastMouse({ x: ev.evt.clientX, y: ev.evt.clientY });
    } else if (ev.evt.button === 2) {
      const c = sampleCenter(sample);
      const angle = Math.atan2(ev.evt.offsetY - c.y, ev.evt.offsetX - c.x) * (180 / Math.PI);
      setDragMode({ kind: "rotate", sampleId, startDeg: angle, startRot: sample.transform.rotationDeg });
    }
  }

  function onStageMouseMove(ev: { evt: MouseEvent }) {
    if (dragMode.kind === "translate") {
      const dx = (ev.evt.clientX - lastMouse.x) / pdfZoom;
      const dy = (ev.evt.clientY - lastMouse.y) / pdfZoom;
      setLastMouse({ x: ev.evt.clientX, y: ev.evt.clientY });
      const sample = samples.find((s) => s.sampleId === dragMode.sampleId);
      if (!sample) {
        return;
      }
      onUpdateSample(sample.sampleId, {
        tx: sample.transform.tx + dx,
        ty: sample.transform.ty + dy,
      });
    } else if (dragMode.kind === "rotate") {
      const sample = samples.find((s) => s.sampleId === dragMode.sampleId);
      if (!sample) {
        return;
      }
      const c = sampleCenter(sample);
      const angle = Math.atan2(ev.evt.offsetY - c.y, ev.evt.offsetX - c.x) * (180 / Math.PI);
      onUpdateSample(sample.sampleId, {
        rotationDeg: dragMode.startRot + (angle - dragMode.startDeg),
      });
    }
  }

  const stageW = pageSize.width;
  const stageH = pageSize.height;

  return (
    <div className="panel pdf-panel">
      <div className="panel-title">PDF + Contour Overlay</div>
      <div className="page-toolbar">
        <button onClick={() => setSelectedPage(Math.max(1, selectedPage - 1))} disabled={selectedPage <= 1}>Prev</button>
        <span>Page {selectedPage}{numPages ? ` / ${numPages}` : ""}</span>
        <button onClick={() => setSelectedPage(Math.min(numPages || selectedPage + 1, selectedPage + 1))} disabled={numPages > 0 && selectedPage >= numPages}>Next</button>
        <span>Zoom {Math.round(pdfZoom * 100)}%</span>
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
          <Document file={pdfSource ?? undefined} onLoadSuccess={onDocLoadSuccess}>
            <Page
              pageNumber={selectedPage}
              width={1000}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(page) => setPageSize({ width: page.width, height: page.height })}
            />
          </Document>
          <div className="overlay-stage-wrap">
            <Stage width={stageW} height={stageH} onMouseDown={onStageMouseDown} onMouseMove={onStageMouseMove} onMouseUp={() => setDragMode({ kind: "none" })}>
              <Layer>
                {visibleSamples.map((sample) => {
                  const isSelected = sample.sampleId === selectedSampleId;
                  const baseStroke = isSelected ? 2.4 : 1.4;

                  const groupContours = [...sample.outerContours, ...sample.holeContours];
                  return groupContours.map((contour, idx) => {
                    const flat = contour.flat();
                    return (
                      <Line
                        key={`${sample.sampleId}-${idx}`}
                        points={flat}
                        x={sample.transform.tx}
                        y={sample.transform.ty}
                        rotation={sample.transform.rotationDeg}
                        scaleX={overlayScale}
                        scaleY={overlayScale}
                        closed
                        stroke={sample.transform.color}
                        strokeWidth={baseStroke}
                        listening
                        hitStrokeWidth={8}
                        attrs={{ "data-sid": sample.sampleId }}
                      />
                    );
                  });
                })}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
      <div className="hint">Middle drag: pan viewport. Wheel: zoom around cursor. Left drag sample: move. Right drag sample: rotate.</div>
    </div>
  );
}
