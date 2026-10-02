import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemCoveragePanel } from "./ItemCoveragePanel";

describe("ItemCoveragePanel", () => {
  it("states every coverage dimension with an explicit state and reason", () => {
    render(<ItemCoveragePanel itemType="MirroredDatabase" />);
    const panel = screen.getByRole("region", { name: "Atlas coverage" });
    const terms = within(panel).getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Catalog", "Objects", "Lineage", "Access", "Operations"]);
    expect(within(panel).getAllByText("Adapter only")).toHaveLength(2);
    expect(within(panel).getByText(/Selected source tables from the documented mirroring.json/)).toBeVisible();
    expect(within(panel).getByText(/Not yet part of published snapshots/)).toBeVisible();
  });

  it("keeps unknown Workload Hub types visible without inventing coverage", () => {
    render(<ItemCoveragePanel itemType="Microsoft.WaaS.BusinessProcessSolutions" />);
    const panel = screen.getByRole("region", { name: "Atlas coverage" });
    expect(within(panel).getByText(/Workload item/)).toBeVisible();
    expect(within(panel).getByText(/no Fabric-documented structural contract/)).toBeVisible();
    expect(within(panel).queryByText(/Adapter only/)).not.toBeInTheDocument();
  });

  it("notes MLV refresh jobs on a Lakehouse without treating views as items", () => {
    render(
      <ItemCoveragePanel
        itemType="Lakehouse"
        jobs={[{ jobType: "RefreshMaterializedLakeViews" }, { jobType: "TableMaintenance" }]}
      />,
    );
    expect(screen.getByText(/1 refresh job recorded on this Lakehouse/)).toBeVisible();
    expect(screen.getByText(/Views are not separate Fabric items/)).toBeVisible();
  });
});
