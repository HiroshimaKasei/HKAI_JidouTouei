import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfOverlayPanel, transformedContourBounds } from "./PdfOverlayPanel";
import type { SampleData } from "../types/models";

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Page: ({ onRenderSuccess }: { onRenderSuccess: (page: { width: number; height: number }) => void }) => {
    useEffect(() => {
      onRenderSuccess({ width: 1000, height: 1300 });
    }, []);
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

  it("moves the selected contour to the PDF page center without changing its rotation or scale", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));

    await waitFor(() => expect(onUpdateSample).toHaveBeenCalledWith(selected.sampleId, { tx: 490, ty: 645 }));
    expect(selected.transform).toEqual({ tx: 500, ty: 600, rotationDeg: 0, visible: true, color: "#ff5500" });
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
