import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeContext } from "@/hooks/theme.context";
import { AtlasProvider } from "../store";
import { FirstSyncView } from "./FirstSync";

describe("FirstSyncView", () => {
  it("shows an accessible donut driven by synchronization progress", () => {
    render(
      <ThemeContext.Provider
        value={{ isDark: false, toggleTheme: () => undefined }}
      >
        <AtlasProvider isPreview>
          <FirstSyncView />
        </AtlasProvider>
      </ThemeContext.Provider>,
    );

    expect(
      screen.getByRole("progressbar", {
        name: "Workspace synchronization donut",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.queryByLabelText(/Animated preview of Fabric lineage/),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("progressbar", {
          name: "Workspace synchronization donut",
        })
        .querySelector("svg"),
    ).toHaveClass("h-full", "w-full");
  });
});
