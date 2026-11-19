import { describe, expect, it } from "vitest";
import { MINIMAP_H, MINIMAP_PAD, MINIMAP_W, minimapViewportStyle } from "./minimap";

const graph = { width: 2000, height: 1000 };

describe("minimap viewport", () => {
  it("shrinks when zooming in and grows when zooming out", () => {
    const viewport = { left: 0, top: 0, width: 800, height: 400 };
    const zoomedOut = minimapViewportStyle(viewport, 0.5, graph);
    const zoomedIn = minimapViewportStyle(viewport, 1, graph);
    expect(zoomedOut.width).toBeCloseTo(112);
    expect(zoomedIn.width).toBeCloseTo(56);
    expect(zoomedIn.height).toBeCloseTo(30.4);
  });

  it("follows scrolling and stays inside the minimap", () => {
    const moved = minimapViewportStyle({ left: 1000, top: 500, width: 800, height: 400 }, 1, graph);
    expect(moved.left).toBeCloseTo(MINIMAP_PAD + 70);
    expect(moved.top).toBeCloseTo(MINIMAP_PAD + 38);
    const edge = minimapViewportStyle({ left: 1800, top: 900, width: 800, height: 400 }, 1, graph);
    expect(edge.left + edge.width).toBeLessThanOrEqual(MINIMAP_PAD + MINIMAP_W + 0.01);
    expect(edge.top + edge.height).toBeLessThanOrEqual(MINIMAP_PAD + MINIMAP_H + 0.01);
  });
});
