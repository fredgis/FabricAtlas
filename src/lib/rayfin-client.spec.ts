import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@microsoft/rayfin-client", () => ({
  RayfinClient: class {
    constructor(config: Record<string, unknown>) {
      mocks.config = config;
    }
  },
}));

describe("Rayfin client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_RAYFIN_API_URL", "https://example.test/api");
    vi.stubEnv("VITE_RAYFIN_PUBLISHABLE_KEY", "pk-test");
    mocks.config = undefined;
  });

  it("bounds stalled Fabric GraphQL requests for responsive cancellation", async () => {
    const { getRayfinClient } = await import("./rayfin-client");

    getRayfinClient();

    expect(mocks.config).toMatchObject({ timeout: 30_000 });
  });
});
