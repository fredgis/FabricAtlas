import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasData } from "../model";
import { SAMPLE_DATA } from "../model";

const mocks = vi.hoisted(() => ({
  collect: vi.fn(),
}));

vi.mock("../item-relations-beta", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../item-relations-beta")>();
  return {
    ...actual,
    collectItemRelationsBeta: mocks.collect,
  };
});

const workspaceId = "11111111-1111-4111-8111-111111111111";
const modelId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const externalWorkspaceId = "55555555-5555-4555-8555-555555555555";

const data: AtlasData = {
  ...SAMPLE_DATA,
  workspace: {
    ...SAMPLE_DATA.workspace,
    fabricId: workspaceId,
    displayName: "Current workspace",
  },
  items: [
    {
      fabricId: modelId,
      displayName: "Local model",
      itemType: "SemanticModel",
      health: "healthy",
      endorsement: "none",
      tags: [],
    },
    {
      fabricId: reportId,
      displayName: "Local report",
      itemType: "Report",
      health: "healthy",
      endorsement: "none",
      tags: [],
    },
  ],
  edges: [{ source: modelId, target: reportId, relation: "binds" }],
};

vi.mock("../store", () => ({
  useAtlas: () => ({
    data,
    currentUser: {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Atlas Admin",
      email: "atlas@example.com",
    },
    canSync: true,
    isPreview: false,
  }),
}));

import { MapBetaView } from "./MapBeta";

function collection() {
  return {
    correlationId: "77777777-7777-4777-8777-777777777777",
    workspaceId,
    requestedItemIds: [modelId, reportId],
    completedItemIds: [modelId, reportId],
    itemFailures: {},
    items: [
      {
        id: sourceId,
        workspaceId: externalWorkspaceId,
        type: "Lakehouse",
        displayName: "External source",
      },
      {
        id: reportId,
        workspaceId,
        type: "Report",
        displayName: "Local report",
      },
    ],
    relations: [
      {
        itemId: modelId,
        dependentOnItemId: sourceId,
        relationType: "Datasource",
      },
      {
        itemId: reportId,
        dependentOnItemId: modelId,
        relationType: "Association",
      },
    ],
    workspaces: [
      {
        id: externalWorkspaceId,
        displayName: "External workspace",
      },
    ],
    queries: [
      {
        itemId: modelId,
        direction: "upstream" as const,
        status: "complete" as const,
        itemCount: 1,
        relationCount: 1,
        workspaceCount: 1,
        durationMs: 10,
      },
      {
        itemId: modelId,
        direction: "downstream" as const,
        status: "complete" as const,
        itemCount: 0,
        relationCount: 0,
        workspaceCount: 0,
        durationMs: 10,
      },
    ],
    errors: [],
    requestCount: 4,
    sliceCount: 1,
    durationMs: 150,
    collectedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("MapBetaView", () => {
  beforeEach(() => {
    mocks.collect.mockReset();
  });

  it("collects, filters, and exposes raw relation evidence", async () => {
    mocks.collect.mockResolvedValue(collection());
    render(<MapBetaView />);

    expect(
      screen.getByRole("heading", {
        name: "No Beta relation evidence collected",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Collect API relations" }),
    );

    expect(
      await screen.findByLabelText(
        /Item Relations graph with 3 items and 2 relations/i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Local model/i }),
    );
    expect(
      screen.getByRole("heading", { name: "API relationships (2)" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Raw API fields")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Relation type"), {
      target: { value: "Association" },
    });
    expect(
      screen.getByLabelText(/Item Relations graph with 2 items and 1 relations/i),
    ).toBeInTheDocument();
  });

  it("keeps collection errors visible with a real retry action", async () => {
    mocks.collect.mockRejectedValue(new Error("Preview endpoint unavailable."));
    render(<MapBetaView />);

    fireEvent.click(
      screen.getByRole("button", { name: "Collect API relations" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Preview endpoint unavailable.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Collect API relations" }),
    ).toBeEnabled();
  });
});
