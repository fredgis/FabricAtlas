export const MINIMAP_PAD = 7;
export const MINIMAP_W = 140;
export const MINIMAP_H = 76;

/**
 * Minimap rectangle of the visible part of the graph: it shrinks when zooming
 * in, grows when zooming out and follows scrolling.
 */
export function minimapViewportStyle(
  viewport: { left: number; top: number; width: number; height: number },
  zoom: number,
  graph: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const scaleX = MINIMAP_W / Math.max(graph.width, 1) / Math.max(zoom, 0.01);
  const scaleY = MINIMAP_H / Math.max(graph.height, 1) / Math.max(zoom, 0.01);
  const clamp = (start: number, size: number, max: number) => {
    const from = Math.min(Math.max(start, 0), max);
    return [from, Math.max(4, Math.min(size, max - from))] as const;
  };
  const [left, width] = clamp(viewport.left * scaleX, (viewport.width || MINIMAP_W / scaleX) * scaleX, MINIMAP_W);
  const [top, height] = clamp(viewport.top * scaleY, (viewport.height || MINIMAP_H / scaleY) * scaleY, MINIMAP_H);
  return { left: MINIMAP_PAD + left, top: MINIMAP_PAD + top, width, height };
}
