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

  it("links a dataset by hand, unlinks it, then keeps another one external", async () => {
    renderView();
    upload("sas_pricing.ndjson", JSON.stringify(EVENT));
    await screen.findByText("sas_pricing.ndjson imported.");
    fireEvent.click(screen.getByRole("tab", { name: /Link to Fabric/ }));

    fireEvent.click(screen.getByRole("button", { name: "Link CRM.MEMBERS" }));
    const panel = screen.getByRole("region", { name: "Link CRM.MEMBERS" });
    fireEvent.change(within(panel).getByLabelText("Fabric item"), { target: { value: "alpinerent_dw" } });
    fireEvent.click(within(panel).getAllByRole("radio")[0]);
    fireEvent.click(within(panel).getByRole("button", { name: "Link" }));
    await waitFor(() => expect(screen.getByText(/^Picked by /)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Unlink CRM.MEMBERS" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlink CRM.MEMBERS" }));
    await waitFor(() => expect(screen.queryByText(/^Picked by /)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Link pricing.daily_rates" }));
    const next = screen.getByRole("region", { name: "Link pricing.daily_rates" });
    fireEvent.click(within(next).getByLabelText(/Not in Fabric/));
    fireEvent.click(within(next).getByRole("button", { name: "Link" }));
    await waitFor(() => expect(screen.getByText("Stays outside Fabric")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "External 1" })).toBeInTheDocument();
  });

  it("documents the accepted OpenLineage format", () => {
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: "File format" }));
    expect(screen.getByText("OpenLineage 2-0-x")).toBeInTheDocument();
    expect(screen.getByText(/Ignored and never stored/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: ".json (array)" }));
    expect(screen.getByTestId("openlineage-example").textContent?.startsWith("[")).toBe(true);
  });
});
