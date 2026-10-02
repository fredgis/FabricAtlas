import { describe, expect, it, vi } from "vitest";
import {
  completeCoreCollectorShadow,
  startCoreCollectorShadow,
} from "./core-collector-shadow";
import {
  CORE_EXCLUDED_CAPABILITIES,
  CORE_EXCLUDED_SECTIONS,
  type CoreCollectorEnvelope,
} from "./core-collector-parity";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const CORRELATION = "33333333-3333-4333-8333-333333333333";

function envelope(): CoreCollectorEnvelope {
  const unsupported = {
    status: "unsupported",
    code: "collector-not-migrated",
  } as const;
  return {
    schemaVersion: 2,
    syncMode: "base",
    correlationId: CORRELATION,
    workspace: { id: WORKSPACE, displayName: "Workspace" },
    items: [{ id: ITEM, type: "Lakehouse", displayName: "Lake" }],
    roleAssignments: [
      {
        role: "Admin",
        principal: { id: "admin@example.invalid" },
      },
    ],
    jobs: [],
    sections: {
      workspace: { status: "complete" },
      items: { status: "complete" },
      roleAssignments: { status: "complete" },
      jobs: { status: "complete" },
      ...Object.fromEntries(
        CORE_EXCLUDED_SECTIONS.map((name) => [name, unsupported]),
      ),
    } as CoreCollectorEnvelope["sections"],
    capabilities: Object.fromEntries(
      CORE_EXCLUDED_CAPABILITIES.map((name) => [name, unsupported]),
    ) as CoreCollectorEnvelope["capabilities"],
    errors: [],
    syncedAt: "2026-10-02T10:00:00.000Z",
    lineage: [],
    access: [],
    config: [],
    objectEdges: [],
    schema: {},
    artifactMetadata: {},
    itemMetadata: {
      [ITEM]: { scannerMatched: false, ownerAvailable: false },
    },
  };
}

describe("Core collector shadow", () => {
  it("does nothing while the candidate-only flag is disabled", async () => {
    const invoke = vi.fn();
    await expect(
      startCoreCollectorShadow(WORKSPACE, CORRELATION, {
        enabled: false,
        client: {
          functions: { workspaceCollectCore: { invoke } },
        },
      }),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the typed Function without passing tokens or endpoints", async () => {
    const invoke = vi.fn(async () => envelope());
    await expect(
      startCoreCollectorShadow(WORKSPACE, CORRELATION, {
        enabled: true,
        client: {
          functions: { workspaceCollectCore: { invoke } },
        },
      }),
    ).resolves.toEqual(envelope());
    expect(invoke).toHaveBeenCalledWith(
      {
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        correlationId: CORRELATION,
      },
      { timeoutMs: 180_000 },
    );
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(
      /accessToken|publishableKey|endpoint/i,
    );
  });

  it("compares sanitized Core evidence without affecting snapshot publication", () => {
    const log = vi.fn();
    const python = {
      ...envelope(),
      workspace: {
        ...envelope().workspace,
        description: "Python-only description",
      },
      items: [
        {
          ...envelope().items[0],
          description: "Python-only item description",
        },
      ],
    };
    const report = completeCoreCollectorShadow(envelope(), python, { log });

    expect(report).toMatchObject({
      authoritative: false,
      coreEqual: true,
    });
    expect(log).toHaveBeenCalledWith(
      "[atlas] Rayfin Core parity",
      report,
    );
    expect(JSON.stringify(report)).not.toContain("Python-only");
  });

  it("surfaces only a bounded error type when invocation fails", async () => {
    const warn = vi.fn();
    const marker = "private upstream body";
    await expect(
      startCoreCollectorShadow(WORKSPACE, CORRELATION, {
        enabled: true,
        client: {
          functions: {
            workspaceCollectCore: {
              invoke: vi.fn(async () => {
                throw new Error(marker);
              }),
            },
          },
        },
        warn,
      }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
