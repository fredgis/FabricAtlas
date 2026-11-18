import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SyncBrief } from "../sync-brief";
import { SyncBriefPanel } from "./SyncBriefPanel";

const base: SyncBrief = {
  state: "changes",
  currentSnapshotId: "new",
  previousSnapshotId: "old",
  sections: [
    {
      id: "items",
      title: "Items added or removed",
      status: "available",
      entries: [{ id: "i", title: "Sales", detail: "Added", link: { kind: "item", itemId: "sales" } }],
    },
    { id: "schema", title: "Measures and schema objects changed", status: "unavailable", reason: "Schema metadata was not collected in both snapshots.", entries: [] },
  ],
  totalEntries: 1,
  preExistingHighFindings: 2,
  tenantSettings: "unavailable",
};

describe("SyncBriefPanel", () => {
  it("renders unavailable sections and opens entry targets", () => {
    const onOpen = vi.fn();
    render(<SyncBriefPanel brief={base} loading={false} onCopy={async () => {}} onDownload={() => {}} onOpen={onOpen} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Schema metadata was not collected in both snapshots.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Sales" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "item", itemId: "sales" });
  });

  it("shows the empty and baseline states", () => {
    const { rerender } = render(
      <SyncBriefPanel brief={{ ...base, state: "no-changes", totalEntries: 0 }} loading={false} onCopy={async () => {}} onDownload={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByText("No monitored changes")).toBeTruthy();
    rerender(
      <SyncBriefPanel brief={{ ...base, state: "first-snapshot", sections: [] }} loading={false} onCopy={async () => {}} onDownload={() => {}} onOpen={() => {}} />,
    );
    expect(screen.getByText(/first validated snapshot/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).toBeNull();
  });

  it.each([
    ["sent", "Sync Brief sent to Teams."],
    ["not-configured", "Teams webhook not configured. Set the ATLAS_TEAMS_WEBHOOK_URL secret."],
    ["invalid-webhook", "The configured webhook is not a valid https URL."],
    ["failed", "Teams did not accept the card."],
  ] as const)("sends the brief to Teams and reports %s", async (status, label) => {
    let resolve!: (value: { status: typeof status }) => void;
    const onSendTeams = vi.fn(() => new Promise<{ status: typeof status }>((done) => (resolve = done)));
    render(
      <SyncBriefPanel brief={base} loading={false} onCopy={async () => {}} onDownload={() => {}} onOpen={() => {}} onSendTeams={onSendTeams} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to Teams" }));
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ status });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(label));
    expect(onSendTeams).toHaveBeenCalledTimes(1);
  });

  it("hides Send to Teams without comparable snapshots", () => {
    render(
      <SyncBriefPanel brief={{ ...base, state: "first-snapshot", sections: [] }} loading={false} onCopy={async () => {}} onDownload={() => {}} onOpen={() => {}} onSendTeams={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Send to Teams" })).toBeNull();
  });
});
