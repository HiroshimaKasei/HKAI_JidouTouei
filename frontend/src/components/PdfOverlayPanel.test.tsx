import { createContext, useContext, useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfOverlayPanel, transformedContourBounds } from "./PdfOverlayPanel";
import type { SampleData } from "../types/models";

const pdfMock = vi.hoisted(() => ({
  manual: false,
  documents: [] as Array<{ file: string | File; load: (info: { numPages: number }) => void }>,
  pages: [] as Array<{ file: string | File; pageNumber: number; render: (page: { getViewport: () => { width: number; height: number } }) => void }>,
}));

vi.mock("react-pdf", () => {
  const Source = createContext<string | File>("");
  return {
    Document: ({ children, file, onLoadSuccess }: { children: React.ReactNode; file: string | File; onLoadSuccess: (info: { numPages: number }) => void }) => {
      useEffect(() => {
        pdfMock.documents.push({ file, load: onLoadSuccess });
      }, [file]);
      return <Source.Provider value={file}>{children}</Source.Provider>;
    },
    Page: ({ onRenderSuccess, pageNumber }: { onRenderSuccess: (page: { getViewport: () => { width: number; height: number } }) => void; pageNumber: number }) => {
      const file = useContext(Source);
      useEffect(() => {
        pdfMock.pages.push({ file, pageNumber, render: onRenderSuccess });
        if (!pdfMock.manual) onRenderSuccess({ getViewport: () => ({ width: 1000, height: 1300 }) });
      }, [file, pageNumber]);
      return <div />;
    },
    pdfjs: { GlobalWorkerOptions: {} },
  };
});

vi.mock("react-konva", () => ({
  Group: ({ children, onMouseDown }: { children: React.ReactNode; onMouseDown: (event: { evt: MouseEvent }) => void }) =>
    <div data-testid="sample" onMouseDown={(event) => onMouseDown({ evt: event.nativeEvent })}>{children}</div>,
  Layer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Line: ({ strokeWidth, dash }: { strokeWidth: number; dash: number[] }) =>
    <div data-testid="line" data-stroke-width={strokeWidth} data-dash={dash.join(",")} />,
  Stage: ({ children, width, height, onMouseMove, onMouseUp }: { children: React.ReactNode; width: number; height: number; onMouseMove: (event: { evt: MouseEvent }) => void; onMouseUp: () => void }) =>
    <div data-testid="stage" data-width={width} data-height={height} onMouseMove={(event) => onMouseMove({ evt: event.nativeEvent })} onMouseUp={onMouseUp}>{children}</div>,
}));

beforeEach(() => {
  pdfMock.manual = false;
  pdfMock.documents.length = 0;
  pdfMock.pages.length = 0;
});

function renderPage(index: number, width: number, height: number) {
  act(() => pdfMock.pages[index].render({ getViewport: () => ({ width, height }) }));
}

function setViewportSize() {
  const viewport = document.querySelector(".pdf-viewport") as HTMLElement;
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600, left: 0, top: 0 } as DOMRect);
  return viewport;
}

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
  it("uses the PDF page width to match exported line widths and dashes", () => {
    pdfMock.manual = true;
    const styled = sample({ pageNumber: 1, style: { color: "#ff5500", lineType: "dashed", widthMm: 0.5 } });
    render(<PdfOverlayPanel pdfSource="drawing.pdf" selectedPage={1} setSelectedPage={vi.fn()} samples={[styled]}
      selectedSampleId={null} setSelectedSampleId={vi.fn()} overlayScale={2} onUpdateSample={vi.fn()} language="en" />);
    renderPage(0, 500, 700);
    const line = screen.getByTestId("line");
    expect(Number(line.getAttribute("data-stroke-width")) * 2 * 500 / 1000).toBeCloseTo(0.5 * 72 / 25.4);
    expect(line.getAttribute("data-dash")).toBe("8,5");
  });

  it("calculates the transformed contour center with translation, rotation, and scale", () => {
    expect(transformedContourBounds(sample(), 2)).toEqual({ centerX: 110, centerY: 205 });
  });

  describe("PDF viewport and asynchronous rendering", () => {
    it("resets and fits each new document using its rendered page dimensions, without modifying samples", () => {
      pdfMock.manual = true;
      const selected = sample({ pageNumber: 1 });
      const onUpdateSample = vi.fn();
      const props = {
        selectedPage: 1, setSelectedPage: vi.fn(), samples: [selected], selectedSampleId: selected.sampleId,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample, language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} pdfSource="portrait.pdf" />);
      const viewport = setViewportSize();
      renderPage(0, 1000, 1500);
      expect(screen.getByTestId("stage")).toHaveAttribute("data-height", "1500");
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(200px, 0px) scale(0.4)" });
      fireEvent.wheel(viewport, { deltaY: -100, clientX: 400, clientY: 300 });
      fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));

      rerender(<PdfOverlayPanel {...props} pdfSource="landscape.pdf" />);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
      expect(screen.getByRole("button", { name: "Fit Page" })).toBeDisabled();
      renderPage(0, 1000, 1500);
      expect(screen.getByRole("button", { name: "Fit Page" })).toBeDisabled();
      renderPage(1, 1500, 750);
      expect(screen.getByTestId("stage")).toHaveAttribute("data-height", "500");
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(0px, 100px) scale(0.8)" });
      fireEvent.click(screen.getByRole("button", { name: "Fit Width" }));
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(0px, 0px) scale(0.8)" });
      expect(onUpdateSample).not.toHaveBeenCalled();
      expect(selected.transform).toEqual(sample().transform);
    });

    it("ignores stale document and page callbacks, including after returning to a page", () => {
      pdfMock.manual = true;
      const setSelectedPage = vi.fn();
      const props = {
        pdfSource: "a.pdf", selectedPage: 1, setSelectedPage, samples: [] as SampleData[], selectedSampleId: null,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} />);
      setViewportSize();
      act(() => pdfMock.documents[0].load({ numPages: 3 }));
      renderPage(0, 1000, 1000);
      fireEvent.wheel(document.querySelector(".pdf-viewport") as HTMLElement, { deltaY: -100, clientX: 0, clientY: 0 });
      const transform = (document.querySelector(".pdf-layer-stack") as HTMLElement).style.transform;
      rerender(<PdfOverlayPanel {...props} selectedPage={2} />);
      rerender(<PdfOverlayPanel {...props} selectedPage={1} />);
      renderPage(0, 1000, 3000);
      renderPage(1, 1000, 2000);
      expect(screen.getByRole("button", { name: "Fit Page" })).toBeDisabled();
      renderPage(2, 1000, 500);
      expect(screen.getByTestId("stage")).toHaveAttribute("data-height", "500");
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform });

      rerender(<PdfOverlayPanel {...props} pdfSource="b.pdf" selectedPage={3} />);
      act(() => pdfMock.documents[0].load({ numPages: 1 }));
      expect(setSelectedPage).not.toHaveBeenCalled();
      act(() => pdfMock.documents[1].load({ numPages: 2 }));
      expect(setSelectedPage).toHaveBeenCalledWith(2);
    });

    it("uses the current page when a document finishes loading", () => {
      pdfMock.manual = true;
      const setSelectedPage = vi.fn();
      const props = {
        pdfSource: "a.pdf", selectedPage: 1, setSelectedPage, samples: [] as SampleData[], selectedSampleId: null,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} />);
      rerender(<PdfOverlayPanel {...props} selectedPage={3} />);
      act(() => pdfMock.documents[0].load({ numPages: 2 }));
      expect(setSelectedPage).toHaveBeenCalledWith(2);
    });

    it("waits for the latest render when recentering a previously visited page", () => {
      pdfMock.manual = true;
      const selected = sample({ pageNumber: 1 });
      const props = {
        pdfSource: "a.pdf", selectedPage: 1, setSelectedPage: vi.fn(), samples: [selected], selectedSampleId: selected.sampleId,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} />);
      setViewportSize();
      renderPage(0, 1000, 1000);
      rerender(<PdfOverlayPanel {...props} selectedPage={2} />);
      rerender(<PdfOverlayPanel {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));
      renderPage(0, 1000, 1000);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(100px, 0px) scale(0.6)" });
      renderPage(2, 1000, 1000);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(334px, 177px) scale(0.6)" });
      expect(props.onUpdateSample).not.toHaveBeenCalled();
    });

    it("preserves deliberate zoom before a new document finishes rendering", () => {
      pdfMock.manual = true;
      render(<PdfOverlayPanel pdfSource="a.pdf" selectedPage={1} setSelectedPage={vi.fn()} samples={[]}
        selectedSampleId={null} setSelectedSampleId={vi.fn()} overlayScale={1} onUpdateSample={vi.fn()} language="en" />);
      const viewport = setViewportSize();
      fireEvent.wheel(viewport, { deltaY: -100, clientX: 0, clientY: 0 });
      renderPage(0, 1000, 1500);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(0px, 0px) scale(1.1)" });
    });

    it("clears the old viewport when the source is removed", () => {
      pdfMock.manual = true;
      const props = {
        selectedPage: 1, setSelectedPage: vi.fn(), samples: [] as SampleData[], selectedSampleId: null,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} pdfSource="a.pdf" />);
      setViewportSize();
      renderPage(0, 1000, 1000);
      rerender(<PdfOverlayPanel {...props} pdfSource={null} />);
      renderPage(0, 1000, 3000);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
      expect(screen.getByTestId("stage")).toHaveAttribute("data-height", "1300");
    });

    it("cancels a pending cross-page recenter when the document changes", () => {
      pdfMock.manual = true;
      const selected = sample();
      const props = {
        selectedPage: 1, setSelectedPage: vi.fn(), samples: [selected], selectedSampleId: selected.sampleId,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), language: "en" as const,
      };
      const { rerender } = render(<PdfOverlayPanel {...props} pdfSource="a.pdf" />);
      setViewportSize();
      renderPage(0, 1000, 1000);
      fireEvent.click(screen.getByRole("button", { name: "Recenter Contour" }));
      rerender(<PdfOverlayPanel {...props} selectedPage={2} pdfSource="b.pdf" />);
      renderPage(1, 1000, 1000);
      expect(document.querySelector(".pdf-layer-stack")).toHaveStyle({ transform: "translate(100px, 0px) scale(0.6)" });
      expect(props.onUpdateSample).not.toHaveBeenCalled();
    });
  });

  describe("sample edit gestures", () => {
    it("brackets drag and rotate exactly once, including cancellation and leaving the viewport", () => {
      const selected = sample({ pageNumber: 1 });
      const start = vi.fn();
      const end = vi.fn();
      const update = vi.fn();
      render(<PdfOverlayPanel pdfSource="a.pdf" selectedPage={1} setSelectedPage={vi.fn()} samples={[selected]}
        selectedSampleId={selected.sampleId} setSelectedSampleId={vi.fn()} overlayScale={1} onUpdateSample={update}
        onSampleEditStart={start} onSampleEditEnd={end} language="en" />);
      const viewport = setViewportSize();
      const group = screen.getByTestId("sample");
      fireEvent.mouseDown(viewport, { button: 1, clientX: 10, clientY: 10 });
      fireEvent.mouseUp(window);
      expect(start).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();

      fireEvent.mouseDown(group, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(screen.getByTestId("stage"), { clientX: 20, clientY: 30 });
      expect(update).toHaveBeenCalledWith(selected.sampleId, { tx: 110, ty: 220 });
      fireEvent.mouseUp(screen.getByTestId("stage"));
      fireEvent.mouseUp(window);
      expect(start).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith(selected.sampleId);
      expect(end).toHaveBeenCalledWith(selected.sampleId);

      fireEvent.mouseDown(group, { button: 2, clientX: 120, clientY: 205 });
      fireEvent.mouseMove(screen.getByTestId("stage"), { clientX: 110, clientY: 215 });
      expect(update).toHaveBeenCalledWith(selected.sampleId, { rotationDeg: 180 });
      fireEvent.pointerCancel(viewport);
      fireEvent.mouseLeave(viewport);
      expect(start).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(2);

      fireEvent.mouseDown(group, { button: 0 });
      fireEvent.mouseLeave(viewport);
      expect(end).toHaveBeenCalledTimes(3);

      fireEvent.mouseDown(group, { button: 0 });
      fireEvent.blur(window);
      expect(end).toHaveBeenCalledTimes(4);
    });

    it("ends an active gesture on page changes and unmount", () => {
      const selected = sample({ pageNumber: 1 });
      const start = vi.fn();
      const end = vi.fn();
      const props = {
        pdfSource: "a.pdf", selectedPage: 1, setSelectedPage: vi.fn(), samples: [selected], selectedSampleId: selected.sampleId,
        setSelectedSampleId: vi.fn(), overlayScale: 1, onUpdateSample: vi.fn(), onSampleEditStart: start,
        onSampleEditEnd: end, language: "en" as const,
      };
      const { rerender, unmount } = render(<PdfOverlayPanel {...props} />);
      fireEvent.mouseDown(screen.getByTestId("sample"), { button: 0 });
      rerender(<PdfOverlayPanel {...props} selectedPage={2} />);
      expect(end).toHaveBeenCalledTimes(1);
      rerender(<PdfOverlayPanel {...props} />);
      fireEvent.mouseDown(screen.getByTestId("sample"), { button: 2 });
      unmount();
      expect(start).toHaveBeenCalledTimes(2);
      expect(end).toHaveBeenCalledTimes(2);
    });
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
