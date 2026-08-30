import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAMPLE_DATA } from "../model";
import { AtlasProvider } from "../store";
import { MapView } from "./Map";

describe("MapView selection", () => {
  it("shows the full workspace by default without edge text overlays", () => {
    window.history.replaceState(null, "", "/#map");
    const { container } = render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(
      SAMPLE_DATA.items.length,
    );
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
  });

  it("supports keyboard navigation in the item inspector", async () => {
    window.history.replaceState(null, "", "/#map");
    render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    const summary = screen.getByRole("tab", { name: "Summary" });
    await act(async () => {
      summary.focus();
      fireEvent.keyDown(summary, { key: "ArrowRight" });
    });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Schema" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByText(/Deep lineage/)).toBeInTheDocument();
  });

  it("exposes selected lineage without relying on color alone", () => {
    window.history.replaceState(null, "", "/#map");
    const { container } = render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    expect(
      screen.getByRole("region", {
        name: "Selected lineage relationships",
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('path[stroke-dasharray="2 5"]').length,
    ).toBeGreaterThan(0);
  });

  it("keeps node coordinates stable when selection changes", () => {
    window.history.replaceState(null, "", "/#map");
    render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    const lakehouse = screen.getByLabelText(
      "alpinerent_lakehouse, Lakehouse, healthy",
    );
    const position = {
      left: lakehouse.style.left,
      top: lakehouse.style.top,
    };

    fireEvent.pointerDown(lakehouse, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerUp(lakehouse, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });

    const selectedLakehouse = screen.getByLabelText(
      "alpinerent_lakehouse, Lakehouse, healthy",
    );
    expect(selectedLakehouse).toHaveAttribute("aria-pressed", "true");
    expect(selectedLakehouse.style.left).toBe(position.left);
    expect(selectedLakehouse.style.top).toBe(position.top);
  });

  it("supports object selection, highlighting and drag", () => {
    window.history.replaceState(null, "", "/#map");
    const { container } = render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "objects" }));
    const table = screen.getByLabelText(
      /rentals_daily_summary, \d+ columns · \d+ measures/i,
    );
    const initialLeft = table.style.left;
    const initialTop = table.style.top;

    fireEvent.pointerDown(table, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 2,
    });
    fireEvent.pointerMove(table, {
      clientX: 150,
      clientY: 130,
      pointerId: 2,
    });
    fireEvent.pointerUp(table, {
      button: 0,
      clientX: 150,
      clientY: 130,
      pointerId: 2,
    });

    expect(table.style.left).not.toBe(initialLeft);
    expect(table.style.top).not.toBe(initialTop);

    fireEvent.pointerDown(table, {
      button: 0,
      clientX: 150,
      clientY: 130,
      pointerId: 3,
    });
    fireEvent.pointerUp(table, {
      button: 0,
      clientX: 150,
      clientY: 130,
      pointerId: 3,
    });

    expect(table).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".atlas-flow").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("region", {
        name: "Selected object lineage relationships",
      }),
    ).toBeInTheDocument();
  });

  it("moves a multi-selection together and fully resets positions", () => {
    window.history.replaceState(null, "", "/#map");
    render(
      <AtlasProvider isPreview>
        <MapView />
      </AtlasProvider>,
    );

    const model = screen.getByLabelText(
      "AlpineRent Sales Model, Semantic model, healthy",
    );
    const lakehouse = screen.getByLabelText(
      "alpinerent_lakehouse, Lakehouse, healthy",
    );
    const initial = {
      modelLeft: model.style.left,
      modelTop: model.style.top,
      lakehouseLeft: lakehouse.style.left,
      lakehouseTop: lakehouse.style.top,
    };

    fireEvent.click(lakehouse, { ctrlKey: true });
    fireEvent.pointerDown(lakehouse, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 4,
    });
    fireEvent.pointerMove(lakehouse, {
      clientX: 150,
      clientY: 140,
      pointerId: 4,
    });
    fireEvent.pointerUp(lakehouse, {
      button: 0,
      clientX: 150,
      clientY: 140,
      pointerId: 4,
    });

    expect(model.style.left).not.toBe(initial.modelLeft);
    expect(model.style.top).not.toBe(initial.modelTop);
    expect(lakehouse.style.left).not.toBe(initial.lakehouseLeft);
    expect(lakehouse.style.top).not.toBe(initial.lakehouseTop);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(model.style.left).toBe(initial.modelLeft);
    expect(model.style.top).toBe(initial.modelTop);
    expect(lakehouse.style.left).toBe(initial.lakehouseLeft);
    expect(lakehouse.style.top).toBe(initial.lakehouseTop);
  });
});
