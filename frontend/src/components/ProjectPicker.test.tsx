import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listProjects } from "../api";
import { ProjectPicker } from "./ProjectPicker";

vi.mock("../api", () => ({ listProjects: vi.fn() }));

describe("ProjectPicker", () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReset();
  });

  it("sorts and filters IDs without loading a hidden selection", async () => {
    const projects = ["zeta", "alpha", "Beta", "ALPHA-2"];
    vi.mocked(listProjects).mockResolvedValue(projects);
    const onLoad = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<ProjectPicker language="en" onClose={onClose} onLoad={onLoad} />);
    const search = await screen.findByRole("searchbox", { name: "Search projects" });
    const group = screen.getByRole("radiogroup", { name: "Select a project" });
    expect(within(group).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["ALPHA-2", "Beta", "alpha", "zeta"]);
    expect(projects).toEqual(["zeta", "alpha", "Beta", "ALPHA-2"]);
    fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
    search.focus();
    fireEvent.change(search, { target: { value: " ALpHa " } });
    expect(search).toHaveFocus();
    expect(within(group).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["ALPHA-2", "alpha"]);
    expect(screen.getByRole("button", { name: "Load" })).toBeDisabled();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching projects");
    fireEvent.change(search, { target: { value: "beta" } });
    expect(screen.getByRole("radio", { name: "Beta" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith("Beta"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps dialog focus trapping and restores focus on Escape", async () => {
    vi.mocked(listProjects).mockResolvedValue(["project"]);
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<ProjectPicker language="ja" onClose={vi.fn()} onLoad={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    const search = await screen.findByRole("searchbox", { name: "プロジェクトを検索" });
    search.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus();
    const close = vi.fn();
    unmount();
    expect(trigger).toHaveFocus();
    const second = render(<ProjectPicker language="ja" onClose={close} onLoad={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    second.unmount();
    trigger.remove();
  });
});
