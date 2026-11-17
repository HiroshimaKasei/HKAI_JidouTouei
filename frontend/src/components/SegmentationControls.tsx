import { translate, type Language } from "../i18n";

type Props = {
  language: Language;
  prompts: number;
  isPredicting: boolean;
  hasSegCandidates: boolean;
  hasLatestPrediction: boolean;
  candidateScores: number[];
  selectedCandidateIndex: number;
  selectedMaskDataUrl: string;
  onUndoPrompt: () => void;
  onResetPrompts: () => void;
  onRedoSegmentation: () => void;
  onAcceptMask: () => void;
  onCancelSegmentation: () => void;
  onSelectCandidate: (index: number) => void;
};

export function SegmentationControls({
  language, prompts, isPredicting, hasSegCandidates, hasLatestPrediction, candidateScores,
  selectedCandidateIndex, selectedMaskDataUrl, onUndoPrompt, onResetPrompts, onRedoSegmentation,
  onAcceptMask, onCancelSegmentation, onSelectCandidate,
}: Props) {
  return (
    <section className="segmentation-controls" aria-label={translate(language, "segmentation")}>
      <div className="section-heading">
        <strong>{translate(language, "segmentation")}</strong>
        <span aria-live="polite">{isPredicting ? translate(language, "processing") : `${translate(language, "promptCount")}: ${prompts}`}</span>
      </div>
      <div className="control-row">
        <button onClick={onUndoPrompt} disabled={prompts === 0 || isPredicting}>{translate(language, "undo")}</button>
        <button onClick={onResetPrompts} disabled={prompts === 0 || isPredicting}>{translate(language, "resetPrompts")}</button>
        <button onClick={onRedoSegmentation} disabled={isPredicting}>{translate(language, "redo")}</button>
      </div>
      <div className="control-row">
        <label htmlFor="mask-candidate">{translate(language, "candidateScore")}</label>
        <select id="mask-candidate" value={selectedCandidateIndex} onChange={(event) => onSelectCandidate(Number(event.target.value))} disabled={isPredicting || candidateScores.length === 0}>
          {candidateScores.length === 0 ? <option value={0}>—</option> : null}
          {candidateScores.map((score, index) => <option key={index} value={index}>{index + 1} ({score.toFixed(3)})</option>)}
        </select>
      </div>
      {selectedMaskDataUrl ? <img className="mini-mask-preview" src={selectedMaskDataUrl} alt={translate(language, "selectedMask")} /> : null}
      <div className="control-row">
        <button className="primary-action" onClick={onAcceptMask} disabled={!hasSegCandidates || isPredicting || !hasLatestPrediction}>{translate(language, "acceptMask")}</button>
        <button onClick={onCancelSegmentation}>{translate(language, "cancel")}</button>
      </div>
    </section>
  );
}
