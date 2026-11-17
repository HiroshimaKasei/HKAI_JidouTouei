import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InspectionInspector } from "./InspectionInspector";
import type { SampleData } from "../types/models";

const sample: SampleData = {
  sampleId: "001", captureId: "capture", pageNumber: 1, width: 10, height: 10,
  prompts: [], outerContours: [], holeContours: [],
  transform: { tx: 12.345, ty: -5, rotationDeg: 90, visible: true, color: "#ff5500" },
  style: { color: "#ff5500", lineType: "solid", widthMm: 0.35 },
};

function inspectorProps() {
  return {
    language: "en" as const, isPredicting: false, samples: [sample], selectedSampleId: sample.sampleId,
    overlayScale: 1, styleColors: ["#ff5500"], defaultStyle: sample.style,
    onSelectSample: vi.fn(), onUpdateSample: vi.fn(), onUpdateSampleStyle: vi.fn(),
    onApplyStyleToAll: vi.fn(), onDeleteSample: vi.fn(), onRedoSelectedSample: vi.fn(), onSetOverlayScale: vi.fn(),
    canUndo: false, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn(),
  };
}

describe("InspectionInspector", () => {
  it("edits finite transform values without changing other geometry and restores invalid drafts", () => {
    const props = inspectorProps();
    function Wrapper() {
      const [current, setCurrent] = useState(sample);
      return <InspectionInspector {...props} samples={[current]} onUpdateSample={(id, patch) => {
        props.onUpdateSample(id, patch);
        setCurrent((previous) => ({ ...previous, transform: { ...previous.transform, ...patch } }));
      }} />;
    }
    render(<Wrapper />);
    fireEvent.click(screen.getByText("Transform"));
    const x = screen.getByRole("spinbutton", { name: "X (display pixels)" });
    const y = screen.getByRole("spinbutton", { name: "Y (display pixels)" });
    const rotation = screen.getByRole("spinbutton", { name: "Rotation (degrees)" });
    expect(x).toHaveValue(12.345);
    fireEvent.change(x, { target: { value: "-2.25" } });
    fireEvent.change(y, { target: { value: "0" } });
    fireEvent.change(rotation, { target: { value: "450.5" } });
    expect(props.onUpdateSample.mock.calls).toEqual([
      ["001", { tx: -2.25 }], ["001", { ty: 0 }], ["001", { rotationDeg: 450.5 }],
    ]);
    fireEvent.change(x, { target: { value: "" } });
    fireEvent.change(x, { target: { value: "1e999" } });
    expect(props.onUpdateSample).toHaveBeenCalledTimes(3);
    fireEvent.blur(x);
    expect(x).toHaveValue(-2.25);
  });

  it("syncs external changes and sample selection, including while editing", () => {
    const props = inspectorProps();
    const { rerender } = render(<InspectionInspector {...props} />);
    fireEvent.click(screen.getByText("Transform"));
    const x = screen.getByRole("spinbutton", { name: "X (display pixels)" });
    fireEvent.change(x, { target: { value: "" } });
    const changed = { ...sample, transform: { ...sample.transform, tx: 47 } };
    rerender(<InspectionInspector {...props} samples={[changed]} />);
    expect(x).toHaveValue(47);
    const second = { ...changed, sampleId: "002", transform: { ...changed.transform, tx: -8 } };
    rerender(<InspectionInspector {...props} samples={[changed, second]} selectedSampleId="002" />);
    expect(screen.getByRole("spinbutton", { name: "X (display pixels)" })).toHaveValue(-8);
  });

  it("uses independent history callbacks and disabled states", () => {
    const props = inspectorProps();
    const { rerender } = render(<InspectionInspector {...props} />);
    expect(screen.getByRole("button", { name: "Undo edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo edit" })).toBeDisabled();
    rerender(<InspectionInspector {...props} canUndo canRedo />);
    fireEvent.click(screen.getByRole("button", { name: "Undo edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo edit" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
    expect(props.onRedoSelectedSample).not.toHaveBeenCalled();
  });
});
