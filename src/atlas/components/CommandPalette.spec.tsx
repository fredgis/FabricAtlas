import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_DATA } from "../model";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("searches schema objects and opens the selected result", () => {
    const onSelect = vi.fn();
    render(
      <CommandPalette
        data={SAMPLE_DATA}
        open
        onClose={() => undefined}
        onSelect={onSelect}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search workspace metadata" }),
      { target: { value: "Total Revenue" } },
    );
    fireEvent.click(
      screen.getAllByRole("option", { name: /Total Revenue/ })[0],
    );

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "measure",
        target: expect.objectContaining({
          itemId: expect.any(String),
          tableName: "rentals_daily_summary",
        }),
      }),
    );
  });

  it("supports keyboard navigation and selection", () => {
    const onSelect = vi.fn();
    render(
      <CommandPalette
        data={SAMPLE_DATA}
        open
        onClose={() => undefined}
        onSelect={onSelect}
      />,
    );

    const input = screen.getByRole("combobox", {
      name: "Search workspace metadata",
    });
    fireEvent.change(input, { target: { value: "report" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
