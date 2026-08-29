import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_DATA } from "../model";
import { ImpactReportDialog } from "./ImpactReportDialog";

describe("ImpactReportDialog", () => {
  it("shows verified item impact", () => {
    const model = SAMPLE_DATA.items.find(
      (item) => item.itemType === "SemanticModel",
    );
    expect(model).toBeTruthy();

    render(
      <ImpactReportDialog
        data={SAMPLE_DATA}
        itemId={model!.fabricId}
        open
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "AlpineRent Sales Model" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Upstream dependencies")).toBeInTheDocument();
    expect(screen.getByText("Downstream consumers")).toBeInTheDocument();
  });

  it("labels schema-object impact as item-level", () => {
    const model = SAMPLE_DATA.items.find(
      (item) => item.itemType === "SemanticModel",
    );
    render(
      <ImpactReportDialog
        data={SAMPLE_DATA}
        itemId={model!.fabricId}
        object={{
          itemId: model!.fabricId,
          kind: "measure",
          name: "Total Revenue",
          tableName: "rentals_daily_summary",
        }}
        open
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByText(/Fabric exposes verified lineage at item level/),
    ).toBeInTheDocument();
  });

  it("falls back to manual copy when clipboard access is unavailable", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const model = SAMPLE_DATA.items.find(
      (item) => item.itemType === "SemanticModel",
    )!;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    render(
      <ImpactReportDialog
        data={SAMPLE_DATA}
        itemId={model.fabricId}
        open
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(prompt).toHaveBeenCalledWith(
      "Copy this impact report",
      expect.stringContaining("# Fabric Atlas impact report"),
    );
    prompt.mockRestore();
  });
});
