import { useMemo } from "react";

import { translate, type Language } from "../i18n";
import type { SampleData, SampleStyle } from "../types/models";

type Props = {
  language: Language;
  prompts: number;
  isPredicting: boolean;
  hasSegCandidates: boolean;
  hasLatestPrediction: boolean;
  candidateScores: number[];
  selectedCandidateIndex: number;
  selectedMaskDataUrl: string;
  samples: SampleData[];
  selectedSampleId: string | null;
  overlayScale: number;
  styleColors: string[];
  defaultStyle: SampleStyle;
  onUndoPrompt: () => void;
  onResetPrompts: () => void;
  onRedoSegmentation: () => void;
  onAcceptMask: () => void;
  onCancelSegmentation: () => void;
  onSelectCandidate: (index: number) => void;
  onSelectSample: (sampleId: string) => void;
  onUpdateSample: (sampleId: string, patch: Partial<SampleData["transform"]>) => void;
  onUpdateSampleStyle: (sampleId: string, patch: Partial<SampleStyle>) => void;
  onApplyStyleToAll: (style: SampleStyle) => void;
  onDeleteSample: (sampleId: string) => void;
  onRedoSelectedSample: () => void;
  onSetOverlayScale: (scale: number) => void;
};

export function InspectionInspector({
  language, prompts, isPredicting, hasSegCandidates, hasLatestPrediction, candidateScores, selectedCandidateIndex, selectedMaskDataUrl,
  samples, selectedSampleId, overlayScale, styleColors, defaultStyle,
  onUndoPrompt, onResetPrompts, onRedoSegmentation, onAcceptMask, onCancelSegmentation, onSelectCandidate, onSelectSample,
  onUpdateSample, onUpdateSampleStyle, onApplyStyleToAll, onDeleteSample, onRedoSelectedSample, onSetOverlayScale,
}: Props) {
  const selectedSample = useMemo(
    () => samples.find((sample) => sample.sampleId === selectedSampleId) ?? null,
    [samples, selectedSampleId]
  );

  return (
    <aside className="panel inspector-panel" aria-label={translate(language, "inspector")}>
      <div className="panel-title">{translate(language, "inspector")}</div>
      <div className="inspector-content">
        <details className="inspector-section" open>
          <summary>{translate(language, "segmentation")}</summary>
          <div className="control-row">
            <button onClick={onUndoPrompt} disabled={prompts === 0 || isPredicting}>{translate(language, "undo")}</button>
            <button onClick={onResetPrompts} disabled={isPredicting}>{translate(language, "resetPrompts")}</button>
            <button onClick={onRedoSegmentation} disabled={isPredicting}>{translate(language, "redo")}</button>
          </div>
          <div className="control-row inspector-primary-actions">
            <button className="primary-action" onClick={onAcceptMask} disabled={!hasSegCandidates || isPredicting || !hasLatestPrediction}>{translate(language, "acceptMask")}</button>
            <button onClick={onCancelSegmentation}>{translate(language, "cancel")}</button>
          </div>
          <div className="control-row">
            <label>{translate(language, "candidate")}</label>
            <select value={selectedCandidateIndex} onChange={(event) => onSelectCandidate(Number(event.target.value))} disabled={isPredicting || candidateScores.length === 0}>
              {candidateScores.map((score, index) => <option key={index} value={index}>{index + 1} ({score.toFixed(3)})</option>)}
            </select>
          </div>
          {selectedMaskDataUrl ? <img className="mini-mask-preview" src={selectedMaskDataUrl} alt="selected mask" /> : null}
        </details>

        <details className="inspector-section" open>
          <summary>{translate(language, "samples")}</summary>
          <div className="sample-list">
            {samples.map((sample) => (
              <div key={sample.sampleId} className={selectedSampleId === sample.sampleId ? "sample-item active" : "sample-item"}>
                <button className="sample-label" style={{ "--sample-color": sample.style.color } as React.CSSProperties} onClick={() => onSelectSample(sample.sampleId)}>{translate(language, "sample")} {sample.sampleId} (P{sample.pageNumber})</button>
                <button onClick={() => onUpdateSample(sample.sampleId, { visible: !sample.transform.visible })}>{sample.transform.visible ? translate(language, "hide") : translate(language, "show")}</button>
                <button onClick={() => onDeleteSample(sample.sampleId)}>{translate(language, "delete")}</button>
              </div>
            ))}
          </div>
          <div className="control-row"><button onClick={onRedoSelectedSample} disabled={!selectedSampleId || isPredicting}>{translate(language, "redoSegmentation")}</button></div>
        </details>

        <details className="inspector-section" open>
          <summary>{translate(language, "lineProperties")}</summary>
          {selectedSample ? <>
            <div className="control-row">
              <input aria-label={translate(language, "lineColor")} type="color" value={selectedSample.style.color} onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { color: event.target.value })} />
              {styleColors.map((color) => <button key={color} className="color-swatch" aria-label={`Set color ${color}`} title={color} style={{ backgroundColor: color }} onClick={() => onUpdateSampleStyle(selectedSample.sampleId, { color })} />)}
              <input aria-label="HEX color" className="hex-input" value={selectedSample.style.color} pattern="^#[0-9a-fA-F]{6}$" onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { color: event.target.value })} />
            </div>
            <div className="control-row">
              <select aria-label={translate(language, "lineType")} value={selectedSample.style.lineType} onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { lineType: event.target.value as SampleStyle["lineType"] })}>
                <option value="solid">{translate(language, "solid")}</option><option value="dashed">{translate(language, "dashed")}</option><option value="dash_dot">{translate(language, "dashDot")}</option>
              </select>
              <label>{translate(language, "lineThickness")} (mm)<input aria-label="Line width in millimetres" type="number" min="0.01" max="10" step="0.01" value={selectedSample.style.widthMm} onChange={(event) => onUpdateSampleStyle(selectedSample.sampleId, { widthMm: Math.max(0.01, Number(event.target.value) || 0.35) })} /></label>
              <span className={`line-preview ${selectedSample.style.lineType}`} style={{ borderColor: selectedSample.style.color, borderWidth: `${Math.max(1, selectedSample.style.widthMm * 3)}px` }} />
            </div>
            <div className="control-row"><button onClick={() => onApplyStyleToAll(selectedSample.style)}>{translate(language, "applyAll")}</button><button onClick={() => onUpdateSampleStyle(selectedSample.sampleId, { ...defaultStyle, color: styleColors[samples.indexOf(selectedSample) % styleColors.length] })}>{translate(language, "restoreDefaults")}</button></div>
          </> : <p className="empty-state">{translate(language, "selectSample")}</p>}
        </details>

        <details className="inspector-section" open>
          <summary>{translate(language, "overlaySettings")}</summary>
          <div className="control-row"><label>{translate(language, "overlayScale")}<input type="number" step="0.01" min="0.01" value={overlayScale} onChange={(event) => onSetOverlayScale(Number(event.target.value) || 1)} /></label></div>
          {selectedSample ? <div className="hint">#{selectedSample.sampleId} / P{selectedSample.pageNumber}</div> : null}
        </details>
      </div>
    </aside>
  );
}