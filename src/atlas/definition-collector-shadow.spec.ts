import { describe, expect, it, vi } from "vitest";
import type { CoreCollectorEnvelope } from "./core-collector-parity";
import {
  runDefinitionCollectorShadow,
} from "./definition-collector-shadow";
import type { DefinitionStageEnvelope } from "../../rayfin/functions/src/workspace-definitions";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ONTOLOGY = "22222222-2222-4222-8222-222222222222";
const GRAPH = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";
const CORRELATION = "55555555-5555-4555-8555-555555555555";

function coreEnvelope(): CoreCollectorEnvelope {
  return {
    schemaVersion: 2,
    syncMode: "base",
    workspace: { id: WORKSPACE },
    items: [
      { id: ONTOLOGY, type: "Ontology" },
      { id: GRAPH, type: "GraphModel" },
      { id: REPORT, type: "Report" },
    ],
    roleAssignments: [],
    jobs: [],
    sections: {} as CoreCollectorEnvelope["sections"],
    capabilities: {} as CoreCollectorEnvelope["capabilities"],
    errors: [],
    syncedAt: "2026-10-02T10:00:00.000Z",
    lineage: [],
    access: [],
    config: [],
    objectEdges: [],
    schema: {},
    artifactMetadata: {},
    itemMetadata: {
      [ONTOLOGY]: { scannerMatched: false, ownerAvailable: false },
      [GRAPH]: { scannerMatched: false, ownerAvailable: false },
      [REPORT]: { scannerMatched: false, ownerAvailable: false },
    },
  };
}

function definitionEnvelope(): DefinitionStageEnvelope {
  return {
    contractVersion: 1,
    stage: "definitions",
    authoritative: false,
    workspaceId: WORKSPACE,
    items: [
      { id: ONTOLOGY, type: "Ontology", status: "complete" },
      {
        id: GRAPH,
        type: "GraphModel",
        status: "unsupported",
        code: "read-write-permission-required",
      },
    ],
    artifactMetadata: {
      [ONTOLOGY]: {
        kind: "ontology",
        entities: [],
        relationships: [],
        bindings: [],
        contextualizations: [],
      },
    },
    config: [],
    sections: {
      definitions: {
        status: "complete",
        code: "partial-unsupported",
      },
    },
    capabilities: {
      definitionEnrichment: {
        status: "complete",
        code: "partial-unsupported",
      },
    },
    errors: [],
    syncedAt: "2026-10-02T10:01:00.000Z",
  };
}

describe("definition collector shadow", () => {
  it("does nothing while the candidate-only flag is disabled", async () => {
    const invoke = vi.fn();
    await expect(
      runDefinitionCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: false,
          client: {
            functions: {
              workspaceCollectDefinitions: { invoke },
            },
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes only supported definition item types and returns a bounded summary", async () => {
    const invoke = vi.fn(async () => definitionEnvelope());
    await expect(
      runDefinitionCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: {
              workspaceCollectDefinitions: { invoke },
            },
          },
        },
      ),
    ).resolves.toBe(
      "Definitions shadow complete=1; unsupported=1; failed=0; metadata=1; codes=read-write-permission-required",
    );
    expect(invoke).toHaveBeenCalledWith(
      {
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        items: [
          { id: ONTOLOGY, type: "Ontology" },
          { id: GRAPH, type: "GraphModel" },
        ],
        correlationId: CORRELATION,
      },
      { timeoutMs: 180_000 },
    );
  });

  it("fails closed on a foreign item without exposing the response", async () => {
    const warn = vi.fn();
    const envelope = definitionEnvelope();
    envelope.items[0].id = REPORT;
    const marker = "private definition body";
    envelope.config.push({
      itemId: REPORT,
      section: marker,
      label: marker,
      value: marker,
    });

    await expect(
      runDefinitionCollectorShadow(
        WORKSPACE,
        CORRELATION,
        coreEnvelope(),
        {
          enabled: true,
          client: {
            functions: {
              workspaceCollectDefinitions: {
                invoke: vi.fn(async () => envelope),
              },
            },
          },
          warn,
        },
      ),
    ).resolves.toBe("Definitions shadow unavailable");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
