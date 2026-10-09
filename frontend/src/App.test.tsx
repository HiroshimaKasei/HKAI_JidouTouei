import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { PromptPoint } from "./types/models";

vi.mock("./components/PdfOverlayPanel", () => ({
  PdfOverlayPanel: () => <div data-testid="pdf-overlay" />,
  sampleColor: (index: number) => ["#ff5500", "#0099ff", "#17a05d", "#c83f7f", "#b68000", "#1e78b7"][index % 6],
}));

vi.mock("./components/CameraPanel", () => ({
  CameraPanel: ({ onAddPoint }: { onAddPoint: (p: PromptPoint) => void }) => (
    <div>
      <button onClick={() => onAddPoint({ x: 10, y: 10, label: 1 })}>Add Positive</button>
      <button onClick={() => onAddPoint({ x: 3, y: 3, label: 0 })}>Add Negative</button>
    </div>
  ),
}));

const apiMock = vi.hoisted(() => {
  const captureCalls: Array<{ capture_id: string; width: number; height: number; mode: string; capture_png_hex: string }> = [
    { capture_id: "cap-1", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
    { capture_id: "cap-2", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
    { capture_id: "cap-3", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
  ];

  return {
    ensureOperatorSession: vi.fn().mockResolvedValue(undefined),
    releaseOperatorSession: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn().mockResolvedValue({ gpu: { device_name: "GPU", capability: "8.9", model_loaded: true } }),
    getCameraStatus: vi.fn().mockResolvedValue({ camera_available: false, camera_name: "TEST", mode: "test" }),
    capture: vi.fn().mockImplementation(async () => captureCalls.shift() ?? { capture_id: "cap-x", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" }),
    prepareEmbedding: vi.fn().mockResolvedValue({ ok: true, prepare_ms: 12 }),
    predictMask: vi.fn().mockResolvedValue({ request_id: 1, scores: [0.95], best_index: 0, masks: ["ff"] }),
    acceptMask: vi.fn().mockResolvedValue({
      mask_png_hex: "aa",
      contour_bw_png_hex: "bb",
      contour_alpha_png_hex: "cc",
      outer_contours: [[[0, 0], [2, 0], [2, 2], [0, 2]]],
      hole_contours: [],
    }),
    registerCaptureFile: vi.fn().mockResolvedValue({ capture_id: "redo-1", width: 8, height: 8 }),
    fetchFileAsFile: vi.fn(),
    fileToHex: vi.fn(),
    saveProject: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockResolvedValue(["loaded-project"]),
    loadProject: vi.fn().mockResolvedValue({
      project_id: "loaded-project",
      selected_page: 1,
      overlay_scale: 1,
      source_pdf_url: "/api/project/loaded-project/source.pdf",
      samples: [
        {
          sample_id: "001",
          capture_id: "loaded-cap",
          page_number: 1,
          width: 4,
          height: 4,
          prompts: [],
          contour_points: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
          hole_points: [],
          files: { capture: "capture.png", mask: "mask.png", contour_bw: "contour_bw.png" },
          transform: { tx: 0, ty: 0, rotation_deg: 0, visible: true, color: "#ff5500" },
        },
      ],
    }),
    resolveApiPath: vi.fn((u: string) => u),
    resolvePdfUrl: vi.fn((u: string) => u),
  };
});

vi.mock("./api", () => apiMock);

function pdfFile(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

async function createSample(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  await waitFor(() => expect(apiMock.capture).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
  await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
  await waitFor(() => expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument());
}

describe("App reliability regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getHealth.mockResolvedValue({ gpu: { device_name: "GPU", capability: "8.9", model_loaded: true } });
    apiMock.getCameraStatus.mockResolvedValue({ camera_available: false, camera_name: "TEST", mode: "test" });
  });

  it("opens a new PDF as a clean inspection and new project id", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    const openInput = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
    fireEvent.change(openInput, { target: { files: [pdfFile("first.pdf")] } });
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(1));
    const firstProjectId = apiMock.saveProject.mock.calls[0][0] as string;

    fireEvent.change(openInput, { target: { files: [pdfFile("second.pdf")] } });

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(screen.queryByText("Sample 001 (P1)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(2));
    const secondProjectId = apiMock.saveProject.mock.calls[1][0] as string;

    expect(secondProjectId).not.toBe(firstProjectId);
  });

  it("new capture cancels redo replacement and appends a new sample", async () => {
    render(<App />);

    const openInput = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
    fireEvent.change(openInput, { target: { files: [pdfFile("first.pdf")] } });
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Redo Segmentation" }));
    await waitFor(() => expect(apiMock.registerCaptureFile).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));

    await waitFor(() => expect(screen.getByText("Sample 002 (P1)")).toBeInTheDocument());
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
  });

  it("preserves sample color when replacing via redo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    const openInput = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
    fireEvent.change(openInput, { target: { files: [pdfFile("first.pdf")] } });
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(1));
    const firstPayload = apiMock.saveProject.mock.calls[0][1] as { samples: Array<{ transform: { color: string } }> };
    const colorBefore = firstPayload.samples[0].transform.color;

    fireEvent.click(screen.getByRole("button", { name: "Redo Segmentation" }));
    await waitFor(() => expect(apiMock.registerCaptureFile).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(2));

    const secondPayload = apiMock.saveProject.mock.calls[1][1] as { samples: Array<{ transform: { color: string } }> };
    expect(secondPayload.samples[0].transform.color).toBe(colorBefore);
  });

  it("refines prediction with positive and negative points", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.capture).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Add Negative" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalledTimes(2));

    const lastCall = apiMock.predictMask.mock.calls.at(-1) as [string, PromptPoint[], number];
    expect(lastCall[1]).toEqual([
      { x: 10, y: 10, label: 1 },
      { x: 3, y: 3, label: 0 },
    ]);
  });

  it("disables accept while latest prediction is pending", async () => {
    apiMock.predictMask.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ request_id: 1, scores: [0.95], best_index: 0, masks: ["ff"] }), 40))
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.capture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));

    const acceptBtn = screen.getByRole("button", { name: "Accept Mask" });
    expect(acceptBtn).toBeDisabled();

    await waitFor(() => expect(acceptBtn).not.toBeDisabled());
  });
});
