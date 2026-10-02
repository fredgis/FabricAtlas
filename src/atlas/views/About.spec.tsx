import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutView } from "./About";

describe("AboutView", () => {
  it("shows runtime versions and every gated capability", () => {
    render(<AboutView />);

    expect(
      screen.getByRole("heading", { name: "Deployment coverage" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rayfin SDK")).toBeInTheDocument();
    expect(screen.getByText("1.36.2")).toBeInTheDocument();
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
    const { container } = render(<AboutView />);

    expect(screen.queryByText("Enabled")).toBeNull();
    expect(screen.queryByText("Disabled")).toBeNull();

    const active = screen.getByRole("region", { name: /^Implemented · active/ });
    expect(
      within(active).getByRole("heading", { name: "Fabric Apps backend Functions" }),
    ).toBeInTheDocument();
    expect(within(active).getByRole("heading", { name: "Fabric IQ Ontology" })).toBeInTheDocument();

    const available = screen.getByRole("region", { name: /^Available · off/ });
    expect(
      within(available).getByRole("heading", { name: "Fabric Item Relations" }),
    ).toBeInTheDocument();
    expect(within(available).getByText("VITE_ATLAS_FEATURE_ITEM_RELATIONS")).toBeInTheDocument();
    expect(within(available).getByText(/^Beta · Fabric REST v1/)).toBeInTheDocument();

    const collapsed = [...container.querySelectorAll("details")];
    expect(collapsed.map((group) => group.querySelector("summary h3")?.textContent)).toEqual([
      "Portal only (1)",
      "Deferred · contract blocked (3)",
      "Private Preview · not collected (1)",
    ]);
    for (const group of collapsed) expect(group).not.toHaveAttribute("open");
  });
});
