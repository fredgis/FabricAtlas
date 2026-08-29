import { fireEvent, render, screen } from "@testing-library/react";
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
});
