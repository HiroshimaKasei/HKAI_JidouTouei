import type { CameraStatus, PromptPoint, SampleData } from "./types/models";

const BASE = "http://127.0.0.1:8000";

export async function getHealth(): Promise<unknown> {
  const res = await fetch(`${BASE}/api/health/`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function getCameraStatus(): Promise<CameraStatus> {
  const res = await fetch(`${BASE}/api/camera/status`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function frameUrl(): string {
  return `${BASE}/api/camera/frame?ts=${Date.now()}`;
}

export async function uploadTestImage(file: File): Promise<CameraStatus> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/api/camera/test-image`, { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function capture(): Promise<{ capture_id: string; width: number; height: number; mode: string; capture_png_hex: string }> {
  const res = await fetch(`${BASE}/api/camera/capture`, { method: "POST" });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function prepareEmbedding(captureId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sam/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function predictMask(
  captureId: string,
  points: PromptPoint[],
  requestId: number
): Promise<{ request_id: number; scores: number[]; best_index: number; masks: string[] }> {
  const res = await fetch(`${BASE}/api/sam/predict`, {
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
  const res = await fetch(`${BASE}/api/sam/accept`, {
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
  const res = await fetch(`${BASE}/api/sam/register-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_png_hex: imagePngHex }),
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
  fd.append(
    "payload_json",
    JSON.stringify({
      ...payload,
      samples: payload.samples.map((s) => ({
        sample_id: s.sampleId,
        capture_id: s.captureId,
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
        capture_png_hex: s.capturePngHex,
        mask_png_hex: s.maskPngHex,
        contour_bw_png_hex: s.contourBwPngHex,
      })),
    })
  );
  if (sourcePdf) {
    fd.append("source_pdf", sourcePdf);
  }
  const res = await fetch(`${BASE}/api/project/save`, { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function listProjects(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/project/list`);
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
    width: number;
    height: number;
    prompts: PromptPoint[];
    contour_points: number[][][];
    hole_points: number[][][];
    transform: { tx: number; ty: number; rotation_deg: number; visible: boolean; color: string };
  }>;
}> {
  const res = await fetch(`${BASE}/api/project/load/${projectId}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function resolvePdfUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${BASE}${path}`;
}
