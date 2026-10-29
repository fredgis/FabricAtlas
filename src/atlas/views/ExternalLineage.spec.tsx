import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "../store";
import { createMemoryRepo } from "../external-lineage";
import { ExternalLineageProvider } from "../external-lineage-store";
import { ExternalLineageView } from "./ExternalLineage";

const EVENT = {
  eventType: "COMPLETE",
  eventTime: "2026-10-28T06:12:00Z",
  producer: "https://example.com/sas",
  schemaURL: "https://openlineage.io/spec/2-0-2/OpenLineage.json#/definitions/RunEvent",
  run: { runId: "0190a1b2-0000-7000-8000-000000000001" },
  job: { namespace: "sas://prod", name: "pricing.daily" },
  inputs: [{ namespace: "oracle://crm:1521", name: "CRM.MEMBERS" }],
  outputs: [{ namespace: "postgres://pricing:5432", name: "pricing.daily_rates" }],
};

function renderView() {
  render(
    <AtlasProvider isPreview>
      <ExternalLineageProvider repo={createMemoryRepo()}>
        <ExternalLineageView />
      </ExternalLineageProvider>
    </AtlasProvider>,
  );
}

function upload(name: string, text: string) {
  const file = new File([text], name, { type: "application/json" });
  fireEvent.change(screen.getByTestId("external-file-input"), { target: { files: [file] } });
}

afterEach(() => vi.restoreAllMocks());

describe("ExternalLineageView", () => {
  it("imports an OpenLineage file and lists it with its datasets", async () => {
    renderView();
    expect(await screen.findByText(/No OpenLineage file imported yet/i)).toBeInTheDocument();
    upload("sas_pricing.ndjson", JSON.stringify(EVENT));
    await waitFor(() => expect(screen.getByText("sas_pricing.ndjson imported.")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getByText("sas_pricing.ndjson")).toBeInTheDocument();
    expect(within(table).getByText("SAS")).toBeInTheDocument();
  });

  it("records a rejected file without storing edges", async () => {
    renderView();
    upload("export.json", JSON.stringify({ hello: "world" }));
    await waitFor(() => expect(screen.getByText(/export\.json rejected/)).toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("export.json")).toBeInTheDocument();
  });

  it("deletes an accepted import after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();
    upload("sas_pricing.ndjson", JSON.stringify(EVENT));
    const del = await screen.findByRole("button", { name: "Delete sas_pricing.ndjson" });
    fireEvent.click(del);
    await waitFor(() =>
      expect(screen.getByText("sas_pricing.ndjson deleted · its edges were removed.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Delete sas_pricing.ndjson" })).not.toBeInTheDocument();
  });
});
