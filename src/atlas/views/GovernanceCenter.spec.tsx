import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "../store";
import { GovernanceCenterView } from "./GovernanceCenter";

function renderView() {
  const onNavigate = vi.fn();
  render(
    <AtlasProvider isPreview>
      <GovernanceCenterView onNavigate={onNavigate} />
    </AtlasProvider>,
  );
  return onNavigate;
}

describe("GovernanceCenterView", () => {
  it("groups findings, changes, history and coverage in one view", () => {
    renderView();

    expect(
      screen.getByRole("heading", { name: "Governance Center" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Findings/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Changes/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /History/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Coverage/ })).toBeVisible();
  });

  it("opens evidence from an actionable finding", () => {
    const onNavigate = renderView();
    const actions = screen.getAllByRole("button", { name: "Open evidence" });
    expect(actions.length).toBeGreaterThan(0);

    fireEvent.click(actions[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("shows the two-snapshot requirement in Change Center preview", async () => {
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));

    expect(
      await screen.findByRole("heading", {
        name: "A second snapshot is required",
      }),
    ).toBeInTheDocument();
  });

  it("saves a personal governance view in preview", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Saved views/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save current filters" }),
    );
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Priority findings" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("Priority findings")).toBeInTheDocument(),
    );
  });
});
