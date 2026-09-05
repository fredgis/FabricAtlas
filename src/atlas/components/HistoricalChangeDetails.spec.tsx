import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  compareSnapshots,
  snapshotFromData,
  type HistoricalSnapshot,
} from "../history";
import { SAMPLE_DATA } from "../model";
import { HistoricalChangeDetails } from "./HistoricalChangeDetails";

function snapshots(): {
  previous: HistoricalSnapshot;
  current: HistoricalSnapshot;
} {
  const previousData = structuredClone(SAMPLE_DATA);
  const model = previousData.items.find(
    (item) => item.itemType === "SemanticModel",
  )!;
  previousData.items = [
    model,
    {
      ...model,
      fabricId: "consumer-report",
      displayName: "Consumer report",
      itemType: "Report",
    },
  ];
  previousData.edges = [
    {
      source: model.fabricId,
      target: "consumer-report",
      relation: "report",
    },
  ];
  previousData.schema = {
    [model.fabricId]: [
      {
        name: "Measures",
        columns: [{ name: "Amount", dataType: "decimal" }],
        measures: [
          {
            name: "Revenue",
            expr: "SUMX(FILTER(Sales, Sales[Region] = \"<West>\"), Sales[Amount])",
          },
        ],
      },
    ],
  };
  const currentData = structuredClone(previousData);
  currentData.schema = { [model.fabricId]: [] };
  return {
    previous: snapshotFromData(
      previousData,
      "old",
      "2026-09-04T12:00:00.000Z",
    ),
    current: snapshotFromData(
      currentData,
      "new",
      "2026-09-05T12:00:00.000Z",
    ),
  };
}

describe("HistoricalChangeDetails", () => {
  it("uses old snapshot evidence for a deleted schema object", () => {
    const { previous, current } = snapshots();
    const change = compareSnapshots(previous, current).find(
      (candidate) =>
        candidate.type === "schema-object-removed" &&
        candidate.objectName === "Revenue",
    )!;

    render(
      <HistoricalChangeDetails
        change={change}
        previousSnapshotId="old"
        currentSnapshotId="new"
        snapshots={[previous, current]}
        historyLoading={false}
        failedSnapshotIds={new Set()}
        loadHistorySnapshot={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect change" }));
    expect(screen.getByText(/SUMX\(FILTER/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open before impact report" }),
    );
    expect(
      screen.getByRole("heading", { name: "Revenue" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Consumer report")).toBeInTheDocument();
  });

  it("does not treat unavailable history as empty impact", () => {
    const { previous, current } = snapshots();
    const change = compareSnapshots(previous, current).find(
      (candidate) =>
        candidate.type === "schema-object-removed" &&
        candidate.objectName === "Revenue",
    )!;
    const loadHistorySnapshot = vi.fn(async () => undefined);

    render(
      <HistoricalChangeDetails
        change={change}
        previousSnapshotId="old"
        currentSnapshotId="new"
        snapshots={[current]}
        historyLoading={false}
        historyError="snapshot unavailable"
        failedSnapshotIds={new Set(["old"])}
        loadHistorySnapshot={loadHistorySnapshot}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect change" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Historical impact is unavailable",
    );
    expect(
      screen.queryByText("No downstream consumer was returned."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
    expect(loadHistorySnapshot).toHaveBeenCalledWith("old");
  });
});
