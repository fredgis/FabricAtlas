import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { clearInsightSnapshotCache, useInsightSnapshots } from "./insight-snapshots";
import type { InsightWorkspaceSnapshot } from "./insights";

const snapshot = { data: { items: [] }, trend: [] } as unknown as InsightWorkspaceSnapshot;

describe("useInsightSnapshots", () => {
  afterEach(() => clearInsightSnapshotCache());

  it("loads each synchronized workspace once per snapshot id", async () => {
    const load = vi.fn(async () => snapshot);
    const statuses = { "WS-A": { snapshotId: "s1" }, "ws-b": {} };
    const { result, rerender } = renderHook(
      (props: { statuses: Record<string, { snapshotId?: string }> }) =>
        useInsightSnapshots({ isPreview: false, workspaceIds: ["ws-a", "ws-b"], statuses: props.statuses, load }),
      { initialProps: { statuses } },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshots).toEqual({ "ws-a": snapshot });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(false, "ws-a");

    rerender({ statuses: { ...statuses } });
    expect(load).toHaveBeenCalledTimes(1);

    rerender({ statuses: { "WS-A": { snapshotId: "s2" }, "ws-b": {} } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("reads nothing in preview", () => {
    const load = vi.fn(async () => snapshot);
    const { result } = renderHook(() =>
      useInsightSnapshots({ isPreview: true, workspaceIds: ["ws-a"], statuses: { "ws-a": { snapshotId: "s1" } }, load }));
    expect(result.current).toEqual({ snapshots: {}, loading: false });
    expect(load).not.toHaveBeenCalled();
  });
});
