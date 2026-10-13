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
      cameraStatus={{ camera_available: false, camera_connected: false, camera_name: "TEST", mode: "test", last_error: "" }}
      segmentationReady
      onAddPoint={onAddPoint}
      onOpenImage={vi.fn().mockResolvedValue(undefined)}
      onReturnToLive={vi.fn().mockResolvedValue(undefined)}
      language="en"
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

  it("does not handle wheel events or apply camera transforms", () => {
    const onAddPoint = vi.fn();
    const canvas = setup(onAddPoint);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });

    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(screen.queryByRole("button", { name: /fit to view/i })).not.toBeInTheDocument();
    expect(canvas.querySelector(".camera-image")).not.toHaveStyle({ transform: expect.any(String) });

    fireEvent.mouseDown(canvas, { button: 0, clientX: 280, clientY: 260 });

    expect(onAddPoint).toHaveBeenCalledTimes(1);
    const p = onAddPoint.mock.calls[0][0] as PromptPoint;
    expect(Math.round(p.x)).toBe(560);
    expect(Math.round(p.y)).toBe(270);
    expect(screen.getByText("Left click: positive. Right click: negative.")).toBeInTheDocument();
  });
});
