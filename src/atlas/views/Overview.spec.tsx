import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "../store";
import { OverviewView } from "./Overview";

describe("OverviewView navigation", () => {
  it("opens governance and access signals with actionable filters", () => {
    const onOpen = vi.fn();
    render(
      <AtlasProvider isPreview>
        <OverviewView onOpen={onOpen} />
      </AtlasProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /External access:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tab: "access",
        focus: expect.objectContaining({
          filters: { risk: "external" },
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Needs attention:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tab: "governance",
        focus: expect.objectContaining({
          governanceSection: "findings",
          filters: { section: "findings", category: "operations" },
        }),
      }),
    );
  });
});
