import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfOverlayPanel, transformedContourBounds } from "./PdfOverlayPanel";
import type { SampleData } from "../types/models";

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Page: ({ onRenderSuccess, pageNumber }: { onRenderSuccess: (page: { width: number; height: number }) => void; pageNumber: number }) => {
    useEffect(() => {
      onRenderSuccess({ width: 1000, height: 1300 });
    }, [pageNumber]);
    return <div />;
  },
  pdfjs: { GlobalWorkerOptions: {} },
}));

vi.mock("react-konva", () => ({
  Group: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Layer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Line: () => null,
  Stage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function sample(patch: Partial<SampleData> = {}): SampleData {
  return {
    sampleId: "001",
    captureId: "capture-1",
    pageNumber: 2,
    width: 20,
    height: 10,
    prompts: [],
    outerContours: [[[0, 0], [20, 0], [20, 10], [0, 10]]],
    holeContours: [],
    transform: { tx: 100, ty: 200, rotationDeg: 90, visible: true, color: "#ff5500" },
    style: { color: "#ff5500", lineType: "solid", widthMm: 0.35 },
    ...patch,
  };
}

describe("PdfOverlayPanel recentering", () => {
  it("calculates the transformed contour center with translation, rotation, and scale", () => {
    expect(transformedContourBounds(sample(), 2)).toEqual({ centerX: 110, centerY: 205 });
  });

  it("pans to the selected contour without changing persisted geometry or zoom", async () => {
    const selected = sample({ pageNumber: 1, transform: { tx: 500, ty: 600, rotationDeg: 0, visible: true, color: "#ff5500" } });
    const onUpdateSample = vi.fn();
    render(
      <PdfOverlayPanel
        pdfSource={new File(["%PDF-1.4"], "fixture.pdf", { type: "application/pdf" })}
        selectedPage={1}
        setSelectedPage={vi.fn()}
        samples={[selected]}
        selectedSampleId={selected.sampleId}
        setSelectedSampleId={vi.fn()}
        overlayScale={2}
        onUpdateSample={onUpdateSample}
        language="en"
      />
    );

    await waitFor(() => expect(document.querySelector(".pdf-layer-stack")).toBeInTheDocument());
    const viewport = document.querySelector(".pdf-viewport") as HTMLElement;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, left: 0, top: 0 } as DOMRect);
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));

    expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(-161px, -365.5px) scale(1.1)" });
    expect(onUpdateSample).not.toHaveBeenCalled();
    expect(selected.transform).toEqual({ tx: 500, ty: 600, rotationDeg: 0, visible: true, color: "#ff5500" });
  });

  it("pans after the selected sample's page is rendered", async () => {
    const selected = sample();
    const onUpdateSample = vi.fn();
    const pdf = new File(["pdf"], "fixture.pdf");
    function Wrapper() {
      const [page, setPage] = useState(1);
      return <PdfOverlayPanel pdfSource={pdf} selectedPage={page} setSelectedPage={setPage}
        samples={[selected]} selectedSampleId={selected.sampleId} setSelectedSampleId={vi.fn()} overlayScale={1}
        onUpdateSample={onUpdateSample} language="en" />;
    }
    render(<Wrapper />);
    const viewport = document.querySelector(".pdf-viewport") as HTMLElement;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, left: 0, top: 0 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));
    await waitFor(() => expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(290px, 95px) scale(1)" }));
    expect(onUpdateSample).not.toHaveBeenCalled();
  });

  it("switches to the selected contour page before centering it", () => {
    const selected = sample();
    const setSelectedPage = vi.fn();
    render(
      <PdfOverlayPanel
        pdfSource={null}
        selectedPage={1}
        setSelectedPage={setSelectedPage}
        samples={[selected]}
        selectedSampleId={selected.sampleId}
        setSelectedSampleId={vi.fn()}
        overlayScale={1}
        onUpdateSample={vi.fn()}
        language="en"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));

    expect(setSelectedPage).toHaveBeenCalledWith(2);
  });

  it("disables recentering when no valid sample is selected", () => {
    render(
      <PdfOverlayPanel
        pdfSource={null}
        selectedPage={1}
        setSelectedPage={vi.fn()}
        samples={[sample()]}
        selectedSampleId={null}
        setSelectedSampleId={vi.fn()}
        overlayScale={1}
        onUpdateSample={vi.fn()}
        language="en"
      />
    );

    expect(screen.getByRole("button", { name: "Recenter Contour" })).toBeDisabled();
  });
});
