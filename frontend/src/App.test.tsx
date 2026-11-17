import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { translate, translateStatus, translationKeys } from "./i18n";
import type { PromptPoint, SampleData } from "./types/models";

vi.mock("./components/PdfOverlayPanel", () => ({
  PdfOverlayPanel: ({ selectedSampleId, onUpdateSample }: { selectedSampleId: string | null; onUpdateSample: (id: string, patch: Partial<SampleData["transform"]>) => void }) => (
    <div data-testid="pdf-overlay">
      {selectedSampleId ? <button onClick={() => onUpdateSample(selectedSampleId, { tx: 123, ty: 456, rotationDeg: 37 })}>Move selected sample</button> : null}
    </div>
  ),
  sampleColor: (index: number) => ["#ff5500", "#0099ff", "#17a05d", "#c83f7f", "#b68000", "#1e78b7"][index % 6],
}));

vi.mock("./components/CameraPanel", () => ({
  CameraPanel: ({
    onAddPoint,
    onOpenImage,
    onReturnToLive,
    children,
  }: {
    onAddPoint: (p: PromptPoint) => void;
    onOpenImage: (file: File) => Promise<void>;
    onReturnToLive: () => Promise<void>;
    children: React.ReactNode;
  }) => (
    <div>
      <button onClick={() => onAddPoint({ x: 10, y: 10, label: 1 })}>Add Positive</button>
      <button onClick={() => onAddPoint({ x: 3, y: 3, label: 0 })}>Add Negative</button>
      <button onClick={() => void onOpenImage(new File(["image"], "fixture.png", { type: "image/png" }))}>Open Image</button>
      <button onClick={() => void onReturnToLive()}>Return to Live Preview</button>
      {children}
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
    uploadTestImage: vi.fn().mockResolvedValue({ camera_available: false, camera_connected: false, camera_name: "TEST MODE: fixture.png", mode: "test", last_error: "" }),
    clearTestImage: vi.fn().mockResolvedValue({ camera_available: true, camera_connected: false, camera_name: "IC4 available", mode: "camera", last_error: "" }),
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
    importProject: vi.fn().mockResolvedValue({ project_id: "imported-project" }),
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
  await waitFor(() => expect(apiMock.prepareEmbedding).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
  await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
  await waitFor(() => expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument());
}

describe("App reliability regression", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    window.localStorage.clear();
    window.localStorage.setItem("hkai-language", "en");
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.getHealth.mockResolvedValue({ gpu: { device_name: "GPU", capability: "8.9", model_loaded: true } });
    apiMock.getCameraStatus.mockResolvedValue({ camera_available: false, camera_name: "TEST", mode: "test" });
    const captureCalls = [
      { capture_id: "cap-1", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
      { capture_id: "cap-2", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
      { capture_id: "cap-3", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" },
    ];
    apiMock.capture.mockImplementation(async () => captureCalls.shift() ?? { capture_id: "cap-x", width: 8, height: 8, mode: "test", capture_png_hex: "89504e47" });
    apiMock.predictMask.mockResolvedValue({ request_id: 1, scores: [0.95], best_index: 0, masks: ["ff"] });
    apiMock.listProjects.mockResolvedValue(["loaded-project"]);
    apiMock.saveProject.mockResolvedValue({});
  });

  it("opens a new PDF as a clean inspection and new project id", async () => {
    render(<App />);

    const openInput = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
    fireEvent.change(openInput, { target: { files: [pdfFile("first.pdf")] } });
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(1));
    const firstProjectId = apiMock.saveProject.mock.calls[0][0] as string;

    fireEvent.change(openInput, { target: { files: [pdfFile("second.pdf")] } });

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

    fireEvent.click(screen.getByRole("button", { name: "Move selected sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo Segmentation" }));
    await waitFor(() => expect(apiMock.registerCaptureFile).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.prepareEmbedding).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));

    await waitFor(() => expect(screen.getByText("Sample 002 (P1)")).toBeInTheDocument());
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sample 002 (P1)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sample 001 (P1)" }));
    expect(screen.getByRole("button", { name: "Sample 001 (P1)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalled());
    const saved = apiMock.saveProject.mock.calls[0][1] as { samples: SampleData[] };
    expect(saved.samples[1].transform).toMatchObject({ tx: 123, ty: 456, rotationDeg: 37 });
  });

  it("preserves sample color when replacing via redo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    const openInput = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
    fireEvent.change(openInput, { target: { files: [pdfFile("first.pdf")] } });
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Move selected sample" }));
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

    const secondPayload = apiMock.saveProject.mock.calls[1][1] as { samples: SampleData[] };
    expect(secondPayload.samples[0].transform.color).toBe(colorBefore);
    expect(secondPayload.samples[0].transform).toMatchObject({ tx: 123, ty: 456, rotationDeg: 37 });
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

  it("returns from an image source to live preview without removing accepted samples", async () => {
    render(<App />);
    await createSample();

    fireEvent.click(screen.getByRole("button", { name: "Open Image" }));
    await waitFor(() => expect(apiMock.uploadTestImage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Return to Live Preview" }));

    await waitFor(() => expect(apiMock.clearTestImage).toHaveBeenCalled());
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Mask" })).toBeDisabled();
  });

  it("loads a selected project from the dialog and restores focus", async () => {
    render(<App />);
    const open = screen.getByRole("button", { name: "Load" });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Select a project" });
    expect(dialog).toHaveFocus();
    expect(await screen.findByLabelText("loaded-project")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("loaded-project"));
    fireEvent.click(screen.getAllByRole("button", { name: "Load" })[1]);
    await waitFor(() => expect(apiMock.loadProject).toHaveBeenCalledWith("loaded-project"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
  });

  it("shows picker errors and closes with Escape", async () => {
    apiMock.listProjects.mockRejectedValueOnce(new Error("network unavailable"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network unavailable");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an empty project list without enabling Load", async () => {
    apiMock.listProjects.mockResolvedValueOnce([]);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("No saved projects")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Load" })[1]).toBeDisabled();
  });

  it("preserves unsaved changes when project loading is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await createSample();
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    fireEvent.click(await screen.findByLabelText("loaded-project"));
    fireEvent.click(screen.getAllByRole("button", { name: "Load" })[1]);
    expect(apiMock.loadProject).not.toHaveBeenCalled();
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
  });

  it("does not apply incomplete HEX colors and preserves visibility changes", async () => {
    render(<App />);
    await createSample();
    const hex = screen.getByLabelText("HEX color");
    fireEvent.change(hex, { target: { value: "#123" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide Sample 001" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalled());
    const payload = apiMock.saveProject.mock.calls[0][1] as { samples: Array<{ style: { color: string }; transform: { visible: boolean } }> };
    expect(payload.samples[0].style.color).toBe("#ff5500");
    expect(payload.samples[0].transform.visible).toBe(false);
  });

  it("reports PDF export errors without claiming a successful export", async () => {
    apiMock.saveProject.mockResolvedValueOnce({ export_error: "export failed" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Project saved, but PDF export failed: export failed/)).toBeInTheDocument();
  });

  it("reports a saved project without a source PDF as not PDF-exported", async () => {
    apiMock.saveProject.mockResolvedValueOnce({
      artifacts: {
        project: { status: "saved", error: "" },
        result_pdf: { status: "missing", error: "" },
        archive: { status: "ready", error: "" },
      },
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no result PDF was created");
    expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
  });

  it("keeps edits and image buffers made during a pending save", async () => {
    let finish!: (value: { result_pdf_url: string; archive_url: string }) => void;
    apiMock.saveProject.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await createSample();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move selected sample" }));
    finish({ result_pdf_url: "/result.pdf", archive_url: "/project.hkai" });
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(2));
    const first = apiMock.saveProject.mock.calls[0][1] as { samples: SampleData[] };
    const second = apiMock.saveProject.mock.calls[1][1] as { samples: SampleData[] };
    expect(first.samples[0].transform.tx).toBe(0);
    expect(second.samples[0].transform.tx).toBe(123);
    expect(second.samples[0].capturePngHex).toBe("89504e47");
    expect(second.samples[0].maskPngHex).toBe("aa");
  });

  it("does not discard a replacement mask accepted while saving", async () => {
    let finish!: (value: object) => void;
    apiMock.saveProject.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await createSample();
    apiMock.acceptMask.mockResolvedValueOnce({
      mask_png_hex: "dd", contour_bw_png_hex: "ee", contour_alpha_png_hex: "ff",
      outer_contours: [[[0, 0], [3, 0], [3, 3]]], hole_contours: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo Segmentation" }));
    await waitFor(() => expect(apiMock.registerCaptureFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept Mask" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));
    await act(async () => finish({}));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(2));
    const saved = apiMock.saveProject.mock.calls[1][1] as { samples: SampleData[] };
    expect(saved.samples[0].maskPngHex).toBe("dd");
    expect(saved.samples[0].contourBwPngHex).toBe("ee");
  });

  it("keeps a temporary capture after saving and warns before discarding it", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(screen.getAllByText(/temporary.*not.*saved/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalled());
    expect(screen.getAllByText(/temporary.*not.*saved/i).length).toBeGreaterThan(0);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect(apiMock.capture).toHaveBeenCalledTimes(1);
  });

  it("preserves project data for retry when saving fails", async () => {
    apiMock.saveProject.mockRejectedValueOnce(new Error("disk full"));
    render(<App />);
    await createSample();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.saveProject).toHaveBeenCalledTimes(2));
    const retried = apiMock.saveProject.mock.calls[1][1] as { samples: SampleData[] };
    expect(retried.samples[0].capturePngHex).toBe("89504e47");
    expect(retried.samples[0].maskPngHex).toBe("aa");
  });

  it("ignores an accepted mask response from a discarded capture", async () => {
    let finish!: (value: { mask_png_hex: string; contour_bw_png_hex: string; contour_alpha_png_hex: string; outer_contours: number[][][]; hole_contours: number[][][] }) => void;
    apiMock.acceptMask.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.prepareEmbedding).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept Mask" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => finish({ mask_png_hex: "aa", contour_bw_png_hex: "bb", contour_alpha_png_hex: "cc", outer_contours: [[[0, 0], [1, 0], [1, 1]]], hole_contours: [] }));
    expect(screen.getByText("No samples yet")).toBeInTheDocument();
  });

  it("undoes deletion, redoes it, and does not reuse an id in the current project", async () => {
    render(<App />);
    await createSample();
    fireEvent.click(screen.getByRole("button", { name: "Delete Sample 001" }));
    expect(screen.queryByText("Sample 001 (P1)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo edit" }));
    expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Redo edit" }));
    expect(screen.queryByText("Sample 001 (P1)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.prepareEmbedding).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(apiMock.predictMask).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
    expect(await screen.findByText("Sample 002 (P1)")).toBeInTheDocument();
  });

  it("offers only returned artifacts and surfaces import failures", async () => {
    apiMock.saveProject.mockResolvedValueOnce({ result_pdf_url: "/result.pdf", archive_url: "/project.hkai" });
    apiMock.importProject.mockRejectedValueOnce(new Error("invalid archive"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/result.pdf");
    expect(screen.getByRole("link", { name: "Download project" })).toHaveAttribute("href", "/project.hkai");
    const input = document.querySelector('input[type="file"][accept=".hkai"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["bad"], "bad.hkai")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid archive");
  });

  it("opens the project picker after a successful archive import", async () => {
    apiMock.importProject.mockResolvedValueOnce({ project_id: "imported-project" });
    render(<App />);
    const input = document.querySelector('input[type="file"][accept=".hkai"]') as HTMLInputElement;
    const archive = new File(["archive"], "inspection.hkai");
    fireEvent.change(input, { target: { files: [archive] } });
    await waitFor(() => expect(apiMock.importProject).toHaveBeenCalledWith(archive));
    expect(await screen.findByRole("dialog", { name: "Select a project" })).toBeInTheDocument();
    expect(screen.getByText("Import complete: imported-project")).toBeInTheDocument();
  });

  it("does not reuse sample ids reserved by a loaded project", async () => {
    const loaded = await apiMock.loadProject();
    apiMock.loadProject.mockClear();
    apiMock.loadProject.mockResolvedValueOnce({ ...loaded, reserved_sample_ids: ["001", "002"] });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    fireEvent.click(await screen.findByLabelText("loaded-project"));
    fireEvent.click(screen.getAllByRole("button", { name: "Load" })[1]);
    await waitFor(() => expect(screen.getByText("Sample 001 (P1)")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(apiMock.prepareEmbedding).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Add Positive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept Mask" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Accept Mask" }));
    expect(await screen.findByText("Sample 003 (P1)")).toBeInTheDocument();
  });
});

describe("localization", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to Japanese, switches to English, and persists the selection", async () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "撮影" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ja");

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("hkai-language")).toBe("en");
  });

  it("has a Japanese and English value for every translation key", () => {
    for (const key of translationKeys) {
      expect(translate("ja", key)).not.toBe("");
      expect(translate("en", key)).not.toBe("");
    }
  });

  it("translates dynamic ready and inference statuses at render time", () => {
    expect(translateStatus("ja", "Ready")).toBe("準備完了");
    expect(translateStatus("ja", "Running SAM inference...")).toBe("SAM推論を実行中...");
    expect(translateStatus("en", "Ready")).toBe("Ready");
  });
});

describe("three-panel workspace layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
  });

  it("renders three workspace panels and persists clamped keyboard resizing", () => {
    render(<App />);

    const workspace = document.querySelector(".layout-grid") as HTMLElement;
    expect(workspace).toHaveStyle({ "--camera-pane-width": "380px", "--pdf-pane-width": "1090px" });
    expect(document.querySelector(".camera-pane")).toBeInTheDocument();
    expect(document.querySelector(".pdf-pane")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "編集パネル" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("separator", { name: "カメラパネルの幅を変更" }), { key: "ArrowLeft" });
    expect(workspace).toHaveStyle({ "--camera-pane-width": "360px" });
    expect(window.localStorage.getItem("hkai-camera-pane-width")).toBe("360");

    fireEvent.keyDown(screen.getByRole("separator", { name: "カメラパネルの幅を変更" }), { key: "ArrowLeft", repeat: true });
    expect(Number.parseInt(workspace.style.getPropertyValue("--camera-pane-width"), 10)).toBeGreaterThanOrEqual(300);
  });

  it("restores default panel widths", () => {
    window.localStorage.setItem("hkai-camera-pane-width", "600");
    window.localStorage.setItem("hkai-pdf-pane-width", "900");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "レイアウトをリセット" }));
    const workspace = document.querySelector(".layout-grid") as HTMLElement;
    expect(workspace).toHaveStyle({ "--camera-pane-width": "380px", "--pdf-pane-width": "1090px" });
  });

  it("clamps persisted dimensions on resize and exposes the compact inspector", () => {
    window.localStorage.setItem("hkai-camera-pane-width", "900");
    window.localStorage.setItem("hkai-pdf-pane-width", "2000");
    render(<App />);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    fireEvent(window, new Event("resize"));
    const workspace = document.querySelector(".layout-grid") as HTMLElement;
    expect(Number(window.localStorage.getItem("hkai-camera-pane-width"))).toBeLessThanOrEqual(768);
    expect(workspace).toHaveClass("compact-layout");
    expect(screen.queryByRole("complementary", { name: "編集パネル" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "編集パネルを開く" });
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "編集パネル" })).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "編集パネル" })).not.toBeInTheDocument();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    fireEvent(window, new Event("resize"));
    expect(Number.parseInt(workspace.style.getPropertyValue("--pdf-pane-width"), 10)).toBeGreaterThan(480);
  });
});
