import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutView } from "./About";

describe("AboutView", () => {
  it("shows runtime versions and every gated Preview capability", () => {
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
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });
});
