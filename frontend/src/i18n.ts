import { useEffect, useState } from "react";

export type Language = "ja" | "en";

const STORAGE_KEY = "hkai-language";

const messages = {
  ja: {
    openPdf: "PDFを開く", capture: "撮影", save: "保存", load: "読み込み", camera: "カメラ", segmentation: "セグメンテーション", samples: "サンプル一覧",
    liveCamera: "ライブカメラ", openImage: "画像を開く", returnLive: "ライブプレビューに戻す",
    undo: "操作を元に戻す", resetPrompts: "プロンプトをリセット", redo: "やり直す", acceptMask: "マスクを確定", cancel: "キャンセル", candidate: "候補",
    lineProperties: "輪郭線の設定", lineColor: "線の色", lineType: "線種", lineThickness: "線の太さ", solid: "実線", dashed: "破線", dashDot: "一点鎖線",
    applyAll: "全てに適用", restoreDefaults: "初期設定に戻す", hide: "非表示", show: "表示", delete: "削除", redoSegmentation: "セグメンテーションをやり直す", overlayScale: "倍率",
    pdfOverlay: "PDF・輪郭オーバーレイ", previous: "前へ", next: "次へ", page: "ページ", zoom: "ズーム", recenterContour: "輪郭を中央表示", noPdf: "PDFが選択されていません",
    cameraSource: "カメラソース", cameraUnavailable: "カメラの状態を取得できません", openImageMode: "画像ファイル", reconnecting: "再接続中",
    positiveHint: "左クリック: 正のプロンプト。右クリック: 負のプロンプト。",
    pdfHint: "中ボタンドラッグ: 表示移動。ホイール: カーソル位置で拡大縮小。左ドラッグ: サンプル移動。右ドラッグ: サンプル回転。",
    ready: "準備完了", initializing: "初期化中", runningSam: "SAM推論を実行中...", segmentationUpdated: "セグメンテーションを更新しました", captureFrozen: "撮影を固定しました。SAMプロンプトを追加してください。",
    settings: "設定", sample: "サンプル", language: "言語", samReady: "準備完了", loading: "読み込み中", processing: "処理中", error: "エラー",
    inspector: "編集パネル", overlaySettings: "オーバーレイ設定", selectSample: "サンプルを選択してください", resetLayout: "レイアウトをリセット",
    showInspector: "編集パネルを開く", hideInspector: "編集パネルを閉じる", resizeCamera: "カメラパネルの幅を変更", resizePdf: "PDFパネルの幅を変更",
    promptCount: "プロンプト数", candidateScore: "候補（モデルスコア）", selectedMask: "選択中のマスク", frozenCapture: "撮影画像", liveSource: "ライブカメラ", loadedSource: "読み込み画像",
    chooseProject: "プロジェクトを選択", noProjects: "保存済みプロジェクトはありません", loadFailed: "読み込みに失敗しました",
    searchProjects: "プロジェクトを検索", noMatchingProjects: "一致するプロジェクトはありません",
    unsaved: "未保存の変更あり", saved: "変更なし", fitPage: "ページ全体", fitWidth: "幅に合わせる", resetView: "表示をリセット",
    pdfLoading: "PDFを読み込み中", pdfError: "PDFを表示できません", transform: "配置", positionPixels: "位置（表示ピクセル）", rotationDegrees: "回転（度）",
    positionX: "X（表示ピクセル）", positionY: "Y（表示ピクセル）", undoEdit: "編集を元に戻す", redoEdit: "編集をやり直す",
    scaleMeaning: "輪郭の表示倍率（物理校正ではありません）", hexColor: "HEX色", setColor: "色を設定", lineWidthMm: "線の太さ（mm）",
    noSamples: "サンプルはまだありません", cameraImage: "カメラ画像", resizeValue: "幅（ピクセル）",
    saveExportWarning: "プロジェクトは保存されましたが、PDF出力に失敗しました",
    saving: "保存中...", saveFailed: "保存に失敗しました。内容を確認して再試行してください",
    savedWithoutPdf: "プロジェクトは保存されましたが、元のPDFがないため出力PDFは作成されませんでした",
    olderRevisionSaved: "以前の状態を保存しました。新しい変更は未保存です",
    temporaryCapture: "撮影・セグメンテーションは一時作業であり、プロジェクトに保存されません",
    importArchive: "プロジェクトをインポート", importSucceeded: "インポート完了", importFailed: "インポートに失敗しました",
    downloadPdf: "PDFをダウンロード", downloadArchive: "プロジェクトをダウンロード", dismiss: "閉じる",
    newInspection: "新規検査を開始", loadAnother: "別のプロジェクトを読み込み",
  },
  en: {
    openPdf: "Open PDF", capture: "Capture", save: "Save", load: "Load", camera: "Camera", segmentation: "Segmentation", samples: "Sample List",
    liveCamera: "Live Camera", openImage: "Open Image", returnLive: "Return to Live Preview",
    undo: "Undo", resetPrompts: "Reset Prompts", redo: "Redo", acceptMask: "Accept Mask", cancel: "Cancel", candidate: "Candidate",
    lineProperties: "Line Properties", lineColor: "Line Color", lineType: "Line Type", lineThickness: "Line Thickness", solid: "Solid", dashed: "Dashed", dashDot: "Dash-dot",
    applyAll: "Apply to All", restoreDefaults: "Restore Defaults", hide: "Hide", show: "Show", delete: "Delete", redoSegmentation: "Redo Segmentation", overlayScale: "Overlay Scale",
    pdfOverlay: "PDF + Contour Overlay", previous: "Previous", next: "Next", page: "Page", zoom: "Zoom", recenterContour: "Recenter Contour", noPdf: "No PDF selected",
    cameraSource: "Camera source", cameraUnavailable: "Camera status unavailable", openImageMode: "OPEN IMAGE", reconnecting: "RECONNECTING",
    positiveHint: "Left click: positive. Right click: negative.",
    pdfHint: "Middle drag: pan viewport. Wheel: zoom around cursor. Left drag sample: move. Right drag sample: rotate.",
    ready: "Ready", initializing: "Initializing", runningSam: "Running SAM inference...", segmentationUpdated: "Segmentation updated", captureFrozen: "Capture frozen. Add SAM prompts.",
    settings: "Settings", sample: "Sample", language: "Language", samReady: "Ready", loading: "Loading", processing: "Processing", error: "Error",
    inspector: "Inspector", overlaySettings: "Overlay Settings", selectSample: "Select a sample to edit its properties", resetLayout: "Reset Layout",
    showInspector: "Open Inspector", hideInspector: "Close Inspector", resizeCamera: "Resize camera panel", resizePdf: "Resize PDF workspace",
    promptCount: "Prompts", candidateScore: "Candidate (model score)", selectedMask: "Selected mask", frozenCapture: "Frozen capture", liveSource: "Live camera", loadedSource: "Loaded image",
    chooseProject: "Select a project", noProjects: "No saved projects", loadFailed: "Load failed",
    searchProjects: "Search projects", noMatchingProjects: "No matching projects",
    unsaved: "Unsaved changes", saved: "No unsaved changes", fitPage: "Fit Page", fitWidth: "Fit Width", resetView: "Reset View",
    pdfLoading: "Loading PDF", pdfError: "Unable to display PDF", transform: "Transform", positionPixels: "Position (display pixels)", rotationDegrees: "Rotation (degrees)",
    positionX: "X (display pixels)", positionY: "Y (display pixels)", undoEdit: "Undo edit", redoEdit: "Redo edit",
    scaleMeaning: "Contour display scale (not physical calibration)", hexColor: "HEX color", setColor: "Set color", lineWidthMm: "Line width (mm)",
    noSamples: "No samples yet", cameraImage: "Camera image", resizeValue: "Width (pixels)",
    saveExportWarning: "Project saved, but PDF export failed",
    saving: "Saving...", saveFailed: "Save failed. Check the details and retry",
    savedWithoutPdf: "Project saved, but no result PDF was created because the source PDF is missing",
    olderRevisionSaved: "Earlier revision saved; newer changes remain unsaved",
    temporaryCapture: "Temporary capture and segmentation are not saved in the project",
    importArchive: "Import project", importSucceeded: "Import complete", importFailed: "Import failed",
    downloadPdf: "Download PDF", downloadArchive: "Download project", dismiss: "Dismiss",
    newInspection: "start a new inspection", loadAnother: "load another project",
  },
} as const;

export type TranslationKey = keyof typeof messages.ja;
export const translationKeys = Object.keys(messages.ja) as TranslationKey[];

export function translate(language: Language, key: TranslationKey): string {
  return messages[language][key] ?? messages.ja[key];
}

export function translateStatus(language: Language, value: string): string {
  const exact: Record<string, TranslationKey> = {
    Initializing: "initializing", Ready: "ready", "Running SAM inference...": "runningSam", "Segmentation updated": "segmentationUpdated",
    "Capture frozen. Add SAM prompts.": "captureFrozen",
  };
  if (exact[value]) {
    return translate(language, exact[value]);
  }
  if (language === "ja") {
    const prefixes: Array<[string, string]> = [
      ["Startup error:", "起動エラー:"], ["Image source selected:", "画像を選択:"],
      ["Live camera preview restored", "ライブ表示に戻りました"], ["Live camera reconnecting...", "カメラ再接続中..."],
      ["Segmentation updated", "セグメンテーションを更新しました"], ["SAM error:", "SAMエラー:"],
      ["Loaded PDF:", "PDFを読み込みました:"], [" (new inspection)", "（新規検査）"],
      ["Capturing frame...", "撮影中..."], ["Capture frozen. Add SAM prompts. Embedding:", "撮影画像を固定しました。プロンプトを追加してください。埋め込み:"],
      ["Capture error:", "撮影エラー:"], ["Segmentation restarted on frozen image", "撮影画像のセグメンテーションを再開しました"],
      ["Wait for inference to finish", "推論の完了をお待ちください"], ["Wait for a successful latest prediction", "最新の推論結果をお待ちください"],
      ["No mask candidate selected", "マスク候補が選択されていません"], ["Replace cancelled", "置き換えをキャンセルしました"],
      ["Accepted mask as Sample ", "マスクをサンプルとして確定: "], ["Accept error:", "マスク確定エラー:"],
      ["Redo segmentation prepared for Sample ", "サンプルの再セグメンテーションを準備: "], ["Redo setup failed:", "再セグメンテーションの準備に失敗:"],
      ["Redo replacement cancelled; original sample kept", "置き換えをキャンセルしました。元のサンプルは保持されています"],
      ["Capture/segmentation cancelled", "撮影・セグメンテーションをキャンセルしました"],
      ["Project saved, but PDF export failed:", "プロジェクトは保存されましたが、PDF出力に失敗しました:"],
      ["Project saved:", "プロジェクトを保存しました:"], ["Save failed:", "保存に失敗:"], ["Loaded project ", "プロジェクトを読み込みました: "],
    ];
    for (const [prefix, replacement] of prefixes) {
      if (value.startsWith(prefix)) return replacement + value.slice(prefix.length).replace(" (new inspection)", "（新規検査）");
    }
    if (value.startsWith("SAM: ")) {
      return value.replace("Checking", "確認中").replace("Loading", "読み込み中").replace("Processing", "処理中")
        .replace("Ready", "準備完了").replace("Idle", "待機中").replace("Error", "エラー");
    }
  }
  return value;
}

function storedLanguage(): Language {
  return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ja";
}

export function useLocale() {
  const [language, setLanguageState] = useState<Language>(storedLanguage);
  const setLanguage = (next: Language) => setLanguageState(next);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  return { language, setLanguage, t: (key: TranslationKey) => translate(language, key) };
}