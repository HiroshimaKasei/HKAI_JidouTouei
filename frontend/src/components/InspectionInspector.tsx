import { useEffect, useMemo, useState } from "react";

import { translate, type Language } from "../i18n";
import type { SampleData, SampleStyle } from "../types/models";

type Props = {
  language: Language;
  isPredicting: boolean;
  samples: SampleData[];
  selectedSampleId: string | null;
  overlayScale: number;
  styleColors: string[];
  defaultStyle: SampleStyle;
  onSelectSample: (sampleId: string) => void;
  onUpdateSample: (sampleId: string, patch: Partial<SampleData["transform"]>) => void;
  onUpdateSampleStyle: (sampleId: string, patch: Partial<SampleStyle>) => void;
  onApplyStyleToAll: (style: SampleStyle) => void;
  onDeleteSample: (sampleId: string) => void;
  onRedoSelectedSample: () => void;
  onSetOverlayScale: (scale: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

function TransformInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((current) => current !== "" && Number(current) === value ? current : String(value));
  }, [value]);

  return <label>{label}<input type="number" step="any" value={draft} onChange={(event) => {
    setDraft(event.target.value);
    const next = event.target.valueAsNumber;
    if (Number.isFinite(next)) onChange(next);
  }} onBlur={() => setDraft(String(value))} /></label>;
}

function HexColorInput({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} className="hex-input" value={draft} aria-invalid={!/^#[0-9a-f]{6}$/i.test(draft)} onChange={(event) => {
    const next = event.target.value;
    setDraft(next);
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next);
  }} onBlur={() => setDraft(value)} />;
}

export function InspectionInspector({
  language, isPredicting,
  samples, selectedSampleId, overlayScale, styleColors, defaultStyle,
  onSelectSample,
  onUpdateSample, onUpdateSampleStyle, onApplyStyleToAll, onDeleteSample, onRedoSelectedSample, onSetOverlayScale,
  canUndo, canRedo, onUndo, onRedo,
}: Props) {
  const selectedSample = useMemo(
    () => samples.find((sample) => sample.sampleId === selectedSampleId) ?? null,
    [samples, selectedSampleId]
  );

  return (
    <aside className="panel inspector-panel" aria-label={translate(language, "inspector")}>
      <div className="panel-title">{translate(language, "inspector")}</div>
      <div className="inspector-content">
        <div className="control-row">
          <button onClick={onUndo} disabled={!canUndo}>{translate(language, "undoEdit")}</button>
          <button onClick={onRedo} disabled={!canRedo}>{translate(language, "redoEdit")}</button>
        </div>
        <details className="inspector-section" open>
          <summary>{translate(language, "samples")}</summary>
          <div className="sample-list">
            {samples.map((sample) => (
              <div key={sample.sampleId} className={selectedSampleId === sample.sampleId ? "sample-item active" : "sample-item"}>
                <button className="sample-label" aria-pressed={selectedSampleId === sample.sampleId} style={{ "--sample-color": sample.style.color } as React.CSSProperties} onClick={() => onSelectSample(sample.sampleId)}>{translate(language, "sample")} {sample.sampleId} (P{sample.pageNumber})</button>
                <button aria-label={`${sample.transform.visible ? translate(language, "hide") : translate(language, "show")} ${translate(language, "sample")} ${sample.sampleId}`} onClick={() => onUpdateSample(sample.sampleId, { visible: !sample.transform.visible })}>{sample.transform.visible ? translate(language, "hide") : translate(language, "show")}</button>
                <button className="danger-action" aria-label={`${translate(language, "delete")} ${translate(language, "sample")} ${sample.sampleId}`} onClick={() => onDeleteSample(sample.sampleId)}>{translate(language, "delete")}</button>
              </div>
            ))}
          </div>
          {samples.length === 0 ? <p className="empty-state">{translate(language, "noSamples")}</p> : null}
          <div className="control-row"><button onClick={onRedoSelectedSample} disabled={!selectedSampleId || isPredicting}>{translate(language, "redoSegmentation")}</button></div>
        </details>

        <details className="inspector-section">
          <summary>{translate(language, "transform")}</summary>
          {selectedSample ? <div className="transform-readout control-row" key={selectedSample.sampleId}>
            <TransformInput label={translate(language, "positionX")} value={selectedSample.transform.tx} onChange={(tx) => onUpdateSample(selectedSample.sampleId, { tx })} />
            <TransformInput label={translate(language, "positionY")} value={selectedSample.transform.ty} onChange={(ty) => onUpdateSample(selectedSample.sampleId, { ty })} />
            <TransformInput label={translate(language, "rotationDegrees")} value={selectedSample.transform.rotationDeg} onChange={(rotationDeg) => onUpdateSample(selectedSample.sampleId, { rotationDeg })} />
          </div> : <p className="empty-state">{translate(language, "selectSample")}</p>}
        </details>

        <details className="inspector-section" open>
          <summary>{translate(language, "lineProperties")}</summary>
          {selectedSample ? <>
            <div className="control-row">
              <input aria-label={translate(language, "lineColor")} type="color" value={selectedSample.style.color} onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { color: event.target.value })} />
              {styleColors.map((color) => <button key={color} className="color-swatch" aria-label={`${translate(language, "setColor")} ${color}`} title={color} style={{ backgroundColor: color }} onClick={() => onUpdateSampleStyle(selectedSample.sampleId, { color })} />)}
              <HexColorInput key={selectedSample.sampleId} label={translate(language, "hexColor")} value={selectedSample.style.color} onChange={(color) => onUpdateSampleStyle(selectedSample.sampleId, { color })} />
            </div>
            <div className="control-row">
              <select aria-label={translate(language, "lineType")} value={selectedSample.style.lineType} onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { lineType: event.target.value as SampleStyle["lineType"] })}>
                <option value="solid">{translate(language, "solid")}</option><option value="dashed">{translate(language, "dashed")}</option><option value="dash_dot">{translate(language, "dashDot")}</option>
              </select>
              <label>{translate(language, "lineThickness")} (mm)<input aria-label={translate(language, "lineWidthMm")} type="number" min="0.01" max="10" step="0.01" value={selectedSample.style.widthMm} onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0.01 && value <= 10) onUpdateSampleStyle(selectedSample.sampleId, { widthMm: value }); }} /></label>
              <svg className="line-preview" viewBox="0 0 56 12" aria-hidden="true">
                <line x1="0" y1="6" x2="56" y2="6" stroke={selectedSample.style.color} strokeWidth={Math.min(10, Math.max(1, selectedSample.style.widthMm * 3))} strokeDasharray={selectedSample.style.lineType === "dashed" ? "10 6" : selectedSample.style.lineType === "dash_dot" ? "12 5 2 5" : undefined} />
              </svg>
            </div>
            <div className="control-row"><button onClick={() => onApplyStyleToAll(selectedSample.style)}>{translate(language, "applyAll")}</button><button onClick={() => onUpdateSampleStyle(selectedSample.sampleId, { ...defaultStyle, color: styleColors[samples.indexOf(selectedSample) % styleColors.length] })}>{translate(language, "restoreDefaults")}</button></div>
          </> : <p className="empty-state">{translate(language, "selectSample")}</p>}
        </details>

        <details className="inspector-section" open>
          <summary>{translate(language, "overlaySettings")}</summary>
          <div className="control-row"><label>{translate(language, "overlayScale")}<input type="number" step="0.01" min="0.01" value={overlayScale} onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= 0.01) onSetOverlayScale(value); }} /></label></div>
          <div className="hint">{translate(language, "scaleMeaning")}</div>
          {selectedSample ? <div className="hint">#{selectedSample.sampleId} / P{selectedSample.pageNumber}</div> : null}
        </details>
      </div>
    </aside>
  );
}