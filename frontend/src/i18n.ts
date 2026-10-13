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