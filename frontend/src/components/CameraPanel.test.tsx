import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CameraPanel } from "./CameraPanel";
import type { PromptPoint } from "../types/models";

vi.mock("../api", () => ({
  frameUrl: () => "http://127.0.0.1:8000/api/camera/frame",
  uploadTestImage: vi.fn(),
}));

function setup(onAddPoint: (p: PromptPoint) => void) {
  render(
    <CameraPanel
      frozenImageHex={"89504e47"}
      frozenSize={{ width: 1000, height: 500 }}
      promptPoints={[]}
      maskHex={""}
      cameraStatus={{ camera_available: false, camera_name: "TEST", mode: "test" }}
      segmentationReady
      onAddPoint={onAddPoint}
    />
  );

  const canvas = document.querySelector(".camera-canvas") as HTMLDivElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 500,
    bottom: 500,
    width: 500,
    height: 500,
    toJSON: () => ({}),
  } as DOMRect);
  return canvas;
}

describe("CameraPanel coordinate mapping", () => {
  it("maps click coordinates through object-fit contain letterboxing", () => {
    const onAddPoint = vi.fn();
    const canvas = setup(onAddPoint);

    fireEvent.mouseDown(canvas, { button: 0, clientX: 250, clientY: 250 });

    expect(onAddPoint).toHaveBeenCalledTimes(1);
    const p = onAddPoint.mock.calls[0][0] as PromptPoint;
    expect(p.label).toBe(1);
    expect(Math.round(p.x)).toBe(500);
    expect(Math.round(p.y)).toBe(250);
  });

  it("adds negative prompt on right click with image coordinates", () => {
    const onAddPoint = vi.fn();
    const canvas = setup(onAddPoint);

    fireEvent.contextMenu(canvas);
    fireEvent.mouseDown(canvas, { button: 2, clientX: 300, clientY: 260 });

    expect(onAddPoint).toHaveBeenCalledTimes(1);
    const p = onAddPoint.mock.calls[0][0] as PromptPoint;
    expect(p.label).toBe(0);
    expect(Math.round(p.x)).toBe(600);
    expect(Math.round(p.y)).toBe(270);
  });

  it("keeps mapping stable after zoom and middle-pan", () => {
    const onAddPoint = vi.fn();
    const canvas = setup(onAddPoint);

    fireEvent.wheel(canvas, { deltaY: -100 });
    fireEvent.mouseDown(canvas, { button: 1, clientX: 200, clientY: 200 });
    fireEvent.mouseMove(canvas, { clientX: 220, clientY: 215 });
    fireEvent.mouseUp(canvas);

    fireEvent.mouseDown(canvas, { button: 0, clientX: 280, clientY: 260 });

    expect(onAddPoint).toHaveBeenCalledTimes(1);
    const p = onAddPoint.mock.calls[0][0] as PromptPoint;
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(1000);
    expect(p.y).toBeLessThan(500);

    expect(screen.getByText(/Middle drag: pan/i)).toBeInTheDocument();
  });
});
