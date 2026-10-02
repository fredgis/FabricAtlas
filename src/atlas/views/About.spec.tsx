import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutView } from "./About";

describe("AboutView", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps runtime and sync mode visible with technical contracts collapsed", () => {
    const { container } = render(<AboutView />);
    expect(screen.getByRole("heading", { name: "About Fabric Atlas" }).closest("[data-slot='page-header']")).not.toBeNull();
    const runtime = within(screen.getByLabelText("Runtime"));
    expect(runtime.getByText("Rayfin SDK")).toBeVisible();
    expect(runtime.getByText("1.36.2")).toBeVisible();
    expect(runtime.getByText("Rayfin collectors + Python compatibility · browser-run")).toBeVisible();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Fabric Apps backend Functions" })).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical contracts"));
    expect(screen.getByText("Functions API")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Fabric Apps backend Functions",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Fabric Item Relations" }),
    ).toBeInTheDocument();
  });

  it("groups capabilities by state instead of a binary Enabled/Disabled list", () => {
    render(<AboutView />);

    expect(screen.queryByText("Enabled")).toBeNull();
    expect(screen.queryByText("Disabled")).toBeNull();

    const active = screen.getByRole("region", { name: "Active" });
    expect(active).toHaveTextContent("Fabric Apps backend Functions");
    expect(active).toHaveTextContent("Fabric IQ Ontology");
    expect(screen.getByRole("region", { name: "Optional / Off" })).toHaveTextContent("Fabric Item Relations");
    expect(screen.getByRole("region", { name: "Blocked / Deferred" })).toHaveTextContent("Spark");
    fireEvent.click(screen.getByText("Technical contracts"));
    expect(screen.getByText("VITE_ATLAS_FEATURE_ITEM_RELATIONS")).toBeVisible();
  });
  it("reports the explicit Python rollback instead of claiming Rayfin is active", () => {
    vi.stubEnv("VITE_ATLAS_COLLECTOR_ROLLBACK", "true");
    render(<AboutView />);
    expect(screen.getByText("Python rollback · browser-run")).toBeVisible();
  });
});
