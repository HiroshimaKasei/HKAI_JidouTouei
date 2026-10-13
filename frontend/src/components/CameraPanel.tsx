import { useEffect, useMemo, useRef, useState } from "react";

import { frameUrl } from "../api";
import { translate, type Language } from "../i18n";
import type { CameraStatus, PromptPoint } from "../types/models";

type Props = {
  frozenImageHex: string;
  frozenSize: { width: number; height: number } | null;
  promptPoints: PromptPoint[];
  maskHex: string;
  cameraStatus: CameraStatus | null;
  segmentationReady: boolean;
  onAddPoint: (p: PromptPoint) => void;
  onOpenImage: (file: File) => Promise<void>;
  onReturnToLive: () => Promise<void>;
  language: Language;
};

function hexPngToDataUrl(hex: string): string {
  return hex ? `data:image/png;base64,${btoa(hex.match(/.{1,2}/g)?.map((byte) => String.fromCharCode(parseInt(byte, 16))).join("") ?? "")}` : "";
}

export function CameraPanel({
  frozenImageHex,
  frozenSize,
  promptPoints,
  maskHex,
  cameraStatus,
  segmentationReady,
  onAddPoint,
  onOpenImage,
  onReturnToLive,
  language,
}: Props) {
  const [liveSrc, setLiveSrc] = useState<string>(frameUrl());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [loadErr, setLoadErr] = useState<string>("");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState({ width: 2, height: 3 });

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!frozenImageHex) {
        setLiveSrc(frameUrl());
      }
    }, 300);
    return () => window.clearInterval(id);
  }, [frozenImageHex]);

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }
    const updateSize = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    updateSize();

    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updateSize()) : null;
    obs?.observe(wrapperRef.current);
    window.addEventListener("resize", updateSize);
    return () => {
      obs?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const imageUrl = useMemo(() => {
    if (frozenImageHex) {
      return hexPngToDataUrl(frozenImageHex);
    }
    return liveSrc;
  }, [frozenImageHex, liveSrc]);

  const maskUrl = useMemo(() => hexPngToDataUrl(maskHex), [maskHex]);
  const displaySize = frozenSize ?? sourceSize;

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function imageLayout() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const width = canvasSize.width || rect?.width || 0;
    const height = canvasSize.height || rect?.height || 0;
    if (!frozenSize || width <= 0 || height <= 0) {
      return null;
    }
    const baseScale = Math.min(width / frozenSize.width, height / frozenSize.height);
    const drawW = frozenSize.width * baseScale * zoom;
    const drawH = frozenSize.height * baseScale * zoom;
    const offX = (width - drawW) * 0.5 + pan.x;
    const offY = (height - drawH) * 0.5 + pan.y;
    return { baseScale, drawW, drawH, offX, offY };
  }

  function mapEventToImage(ev: React.MouseEvent<HTMLDivElement, MouseEvent>): { x: number; y: number } | null {
    if (!wrapperRef.current || !frozenSize) {
      return null;
    }

    const rect = wrapperRef.current.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;

    const layout = imageLayout();
    if (!layout) {
      return null;
    }

    const imgX = (cx - layout.offX) / (layout.baseScale * zoom);
    const imgY = (cy - layout.offY) / (layout.baseScale * zoom);

    if (imgX < 0 || imgY < 0 || imgX >= frozenSize.width || imgY >= frozenSize.height) {
      return null;
    }
    return { x: imgX, y: imgY };
  }

  function onMouseDown(ev: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (!frozenImageHex || !segmentationReady) {
      return;
    }

    if (ev.button === 1) {
      setDragging(true);
      setLastPos({ x: ev.clientX, y: ev.clientY });
      return;
    }

    if (ev.button === 0 || ev.button === 2) {
      ev.preventDefault();
      const mapped = mapEventToImage(ev);
      if (!mapped) {
        return;
      }
      onAddPoint({ x: mapped.x, y: mapped.y, label: ev.button === 0 ? 1 : 0 });
    }
  }

  function onMouseMove(ev: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (!dragging) {
      return;
    }
    const dx = ev.clientX - lastPos.x;
    const dy = ev.clientY - lastPos.y;
    setLastPos({ x: ev.clientX, y: ev.clientY });
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onMouseUp() {
    setDragging(false);
  }

  function onWheel(ev: React.WheelEvent<HTMLDivElement>) {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(6, Math.max(0.3, z * factor)));
  }

  async function onUploadTestMode(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      setLoadErr("");
      await onOpenImage(file);
    } catch (err) {
      setLoadErr((err as Error).message);
    } finally {
      ev.currentTarget.value = "";
    }
  }

  async function onSelectLiveCamera() {
    try {
      setLoadErr("");
      await onReturnToLive();
    } catch (err) {
      setLoadErr((err as Error).message);
    }
  }

  const promptMarkers = promptPoints.map((p, i) => {
    if (!wrapperRef.current || !frozenSize) {
      return null;
    }
    const layout = imageLayout();
    if (!layout) {
      return null;
    }
    const sx = layout.offX + p.x * layout.baseScale * zoom;
    const sy = layout.offY + p.y * layout.baseScale * zoom;
    return (
      <div
        key={`${p.x}-${p.y}-${i}`}
        className={p.label === 1 ? "prompt-point positive" : "prompt-point negative"}
        style={{ left: `${sx}px`, top: `${sy}px` }}
      />
    );
  });

  return (
    <div className="panel camera-panel">
      <div className="panel-title">{translate(language, "camera")}</div>
      <div className="camera-meta">
        <span>{cameraStatus?.camera_name ?? translate(language, "cameraUnavailable")}</span>
        {cameraStatus?.mode === "test" ? <span className="warn">{translate(language, "openImageMode")}</span> : null}
        {cameraStatus?.mode === "camera" && !cameraStatus.camera_connected ? <span className="warn">{translate(language, "reconnecting")}</span> : null}
      </div>
      <div
        ref={wrapperRef}
        className="camera-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        style={{ aspectRatio: `${displaySize.width} / ${displaySize.height}` }}
      >
        <img
          src={imageUrl}
          className="camera-image"
          alt="camera"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          onLoad={(event) => {
            if (!frozenSize) {
              setSourceSize({ width: event.currentTarget.naturalWidth || 2, height: event.currentTarget.naturalHeight || 3 });
            }
          }}
        />
        {maskHex ? <img src={maskUrl} className="mask-overlay" alt="sam mask" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} /> : null}
        {promptMarkers}
      </div>
      <div className="source-switch" role="group" aria-label={translate(language, "cameraSource")}>
        <button type="button" aria-pressed={cameraStatus?.mode !== "test"} onClick={onSelectLiveCamera}>
          {translate(language, "liveCamera")}
        </button>
        <label className="test-upload">
          {translate(language, "openImage")}
          <input type="file" accept="image/*" onChange={onUploadTestMode} />
        </label>
        <button type="button" onClick={resetView}>{translate(language, "fitView")}</button>
        {cameraStatus?.mode === "test" ? (
          <button type="button" onClick={onSelectLiveCamera}>
            {translate(language, "returnLive")}
          </button>
        ) : null}
      </div>
      {loadErr ? <div className="error-text">{loadErr}</div> : null}
      <div className="hint">{translate(language, "positiveHint")}</div>
    </div>
  );
}
