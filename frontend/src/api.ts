import type { CameraStatus, PromptPoint, SampleData } from "./types/models";

const BASE = (import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "")).replace(/\/+$/, "");
const OPERATOR_TOKEN_HEADER = "X-Operator-Token";

let operatorToken = "";
let heartbeatHandle: number | null = null;

function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

function withOperatorToken(headers?: HeadersInit): Headers {
  const out = new Headers(headers ?? {});
  if (operatorToken) {
    out.set(OPERATOR_TOKEN_HEADER, operatorToken);
  }
  return out;
}

async function operatorPost(path: string, init?: RequestInit): Promise<Response> {
  await ensureOperatorSession();
  return fetch(apiUrl(path), {
    ...init,
    headers: withOperatorToken(init?.headers),
  });
}

function startHeartbeat(): void {
  if (heartbeatHandle !== null || !operatorToken || typeof window === "undefined") {
    return;
  }
  heartbeatHandle = window.setInterval(() => {
    void heartbeatOperatorSession();
  }, 20000);
}

function stopHeartbeat(): void {
  if (heartbeatHandle !== null && typeof window !== "undefined") {
    window.clearInterval(heartbeatHandle);
  }
  heartbeatHandle = null;
}

export async function claimOperatorSession(operatorName = "operator"): Promise<{
  granted: boolean;
  token: string;
  active: { locked: boolean; operator_name: string; client_ip: string; expires_in_seconds: number };
}> {
  const res = await fetch(apiUrl("/api/session/claim"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_name: operatorName }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body = (await res.json()) as {
    granted: boolean;
    token: string;
    active: { locked: boolean; operator_name: string; client_ip: string; expires_in_seconds: number };
  };
  if (body.granted && body.token) {
    operatorToken = body.token;
    startHeartbeat();
  }
  return body;
}

export async function ensureOperatorSession(): Promise<void> {
  if (operatorToken) {
    return;
  }
  const claim = await claimOperatorSession();
  if (!claim.granted || !claim.token) {
    throw new Error(`Inspection is currently controlled by another operator (${claim.active.client_ip || "unknown"}).`);
  }
}

export async function heartbeatOperatorSession(): Promise<void> {
  if (!operatorToken) {
    return;
  }
  const res = await fetch(apiUrl("/api/session/heartbeat"), {
    method: "POST",
    headers: withOperatorToken(),
  });
  if (!res.ok) {
    return;
  }
  const body = (await res.json()) as { ok: boolean };
  if (!body.ok) {
    operatorToken = "";
    stopHeartbeat();
  }
}

export async function releaseOperatorSession(): Promise<void> {
  if (!operatorToken) {
    return;
  }
  await fetch(apiUrl("/api/session/release"), {
    method: "POST",
    headers: withOperatorToken(),
    keepalive: true,
  });
  operatorToken = "";
  stopHeartbeat();
}

function hexToBlob(hex: string, type: string): Blob {
  const bytes = Uint8Array.from((hex.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
  return new Blob([bytes], { type });
}

function sampleFileName(sampleId: string, kind: "capture" | "mask" | "contour_bw"): string {
  if (kind === "capture") {
    return `${sampleId}_capture.png`;
  }
  if (kind === "mask") {
    return `${sampleId}_mask.png`;
  }
  return `${sampleId}_contour_bw.png`;
}

export async function fileToHex(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const arr = new Uint8Array(ab);
  return Array.from(arr)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function fetchFileAsFile(url: string, fallbackName: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const blob = await res.blob();
  const type = blob.type || "image/png";
  return new File([blob], fallbackName, { type });
}

export async function getHealth(): Promise<unknown> {
  const res = await fetch(apiUrl("/api/health/"));
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function getCameraStatus(): Promise<CameraStatus> {
  const res = await fetch(apiUrl("/api/camera/status"));
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function frameUrl(): string {
  return apiUrl(`/api/camera/frame?ts=${Date.now()}`);
}

export async function uploadTestImage(file: File): Promise<CameraStatus> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await operatorPost("/api/camera/test-image", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function capture(): Promise<{ capture_id: string; width: number; height: number; mode: string; capture_png_hex: string }> {
  const res = await operatorPost("/api/camera/capture", { method: "POST" });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function prepareEmbedding(captureId: string): Promise<{ ok: boolean; state?: string; prepare_ms?: number }> {
  const res = await operatorPost("/api/sam/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function predictMask(
  captureId: string,
  points: PromptPoint[],
  requestId: number
): Promise<{ request_id: number; scores: number[]; best_index: number; masks: string[] }> {
  const res = await operatorPost("/api/sam/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      capture_id: captureId,
      points: points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
      request_id: requestId,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function acceptMask(
  captureId: string,
  requestId: number,
  candidateIndex: number
): Promise<{
  mask_png_hex: string;
  contour_bw_png_hex: string;
  contour_alpha_png_hex: string;
  outer_contours: number[][][];
  hole_contours: number[][][];
}> {
  const res = await operatorPost("/api/sam/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capture_id: captureId, request_id: requestId, candidate_index: candidateIndex }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function registerCaptureImage(imagePngHex: string): Promise<{ capture_id: string; width: number; height: number }> {
  const bytes = Uint8Array.from((imagePngHex.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
  return registerCaptureFile(new File([bytes], "capture.png", { type: "image/png" }));
}

export async function registerCaptureFile(file: File): Promise<{ capture_id: string; width: number; height: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await operatorPost("/api/sam/register-image", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function saveProject(
  projectId: string,
  payload: {
    project_id: string;
    selected_page: number;
    overlay_scale: number;
    samples: SampleData[];
  },
  sourcePdf?: File
): Promise<void> {
  const fd = new FormData();
  fd.append("project_id", projectId);

  const metadataSamples = payload.samples.map((s) => ({
    sample_id: s.sampleId,
    capture_id: s.captureId,
    page_number: s.pageNumber,
    width: s.width,
    height: s.height,
    prompts: s.prompts,
    contour_points: s.outerContours,
    hole_points: s.holeContours,
    transform: {
      tx: s.transform.tx,
      ty: s.transform.ty,
      rotation_deg: s.transform.rotationDeg,
      visible: s.transform.visible,
      color: s.transform.color,
    },
    files: {
      capture: "",
      mask: "",
      contour_bw: "",
    },
  }));

  for (let idx = 0; idx < payload.samples.length; idx += 1) {
    const s = payload.samples[idx];
    const meta = metadataSamples[idx];
    const capName = sampleFileName(s.sampleId, "capture");
    const maskName = sampleFileName(s.sampleId, "mask");
    const contourName = sampleFileName(s.sampleId, "contour_bw");

    if (s.capturePngHex) {
      fd.append("sample_capture", new File([hexToBlob(s.capturePngHex, "image/png")], capName, { type: "image/png" }), capName);
      meta.files.capture = capName;
    } else if (s.captureFile) {
      meta.files.capture = s.captureFile;
    }

    if (s.maskPngHex) {
      fd.append("sample_mask", new File([hexToBlob(s.maskPngHex, "image/png")], maskName, { type: "image/png" }), maskName);
      meta.files.mask = maskName;
    } else if (s.maskFile) {
      meta.files.mask = s.maskFile;
    }

    if (s.contourBwPngHex) {
      fd.append("sample_contour_bw", new File([hexToBlob(s.contourBwPngHex, "image/png")], contourName, { type: "image/png" }), contourName);
      meta.files.contour_bw = contourName;
    } else if (s.contourBwFile) {
      meta.files.contour_bw = s.contourBwFile;
    }
  }

  fd.append(
    "payload_json",
    JSON.stringify({
      project_id: payload.project_id,
      selected_page: payload.selected_page,
      overlay_scale: payload.overlay_scale,
      samples: metadataSamples,
    })
  );
  if (sourcePdf) {
    fd.append("source_pdf", sourcePdf);
  }
  const res = await operatorPost("/api/project/save", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function listProjects(): Promise<string[]> {
  const res = await fetch(apiUrl("/api/project/list"));
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body = (await res.json()) as { projects: string[] };
  return body.projects;
}

export async function loadProject(projectId: string): Promise<{
  project_id: string;
  selected_page: number;
  overlay_scale: number;
  source_pdf_url: string;
  samples: Array<{
    sample_id: string;
    capture_id: string;
    page_number?: number;
    width: number;
    height: number;
    prompts: PromptPoint[];
    contour_points: number[][][];
    hole_points: number[][][];
    files?: { capture?: string; mask?: string; contour_bw?: string };
    transform: { tx: number; ty: number; rotation_deg: number; visible: boolean; color: string };
  }>;
}> {
  const res = await fetch(apiUrl(`/api/project/load/${projectId}`));
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function resolvePdfUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return apiUrl(path.startsWith("/") ? path : `/${path}`);
}

export function resolveApiPath(path: string): string {
  return apiUrl(path.startsWith("/") ? path : `/${path}`);
}
