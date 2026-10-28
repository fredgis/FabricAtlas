import { Layers3 } from "lucide-react";
import {
  coverageRatio,
  type CoverageCount,
  type DomainGovernanceRow,
} from "../domain-governance";
import { MICROSOFT_PILLAR_LABEL } from "../ms-pillars";
import { Card, cn } from "../ui";
import { scoreBand } from "./score-style";

const EMPTY_REASON: Record<NonNullable<DomainGovernanceRow["emptyReason"]>, string> = {
  "empty-in-fabric": "Empty in Fabric",
  "not-synchronized": "No workspace synchronized by this Atlas deployment",
  unknown: "Not synchronized here; Fabric assignment unknown",
};

function Score({ value }: { value: number | null }) {
  return (
    <span className="atlas-score font-numeric font-semibold" data-score-band={scoreBand(value)}>
      {value == null ? "N/A" : `${value}%`}
    </span>
  );
}

function Ratio({ value }: { value: CoverageCount }) {
  const ratio = coverageRatio(value);
  return (
    <span className="flex flex-col">
      <Score value={ratio} />
      <span className="text-100 text-muted-foreground">
        {value.numerator}/{value.denominator}
        {value.unknown > 0 && ` · ${value.unknown} unknown`}
      </span>
    </span>
  );
}

function DomainName({ row, labelName }: { row: DomainGovernanceRow; labelName?: (id: string) => string | undefined }) {
  const defaultLabel = row.defaultSensitivityLabelId
    ? labelName?.(row.defaultSensitivityLabelId) ?? `label ${row.defaultSensitivityLabelId.slice(0, 8)}… (name not observed)`
    : undefined;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("truncate font-semibold", row.domain.kind !== "named" && "text-muted-foreground")}>
        {row.domain.label}
      </span>
      <span className="flex flex-wrap items-center gap-xs text-100 text-muted-foreground">
        {row.empty ? (
          <span
            className="rounded-full border border-border bg-muted px-s font-semibold"
            title={row.emptyReason ? EMPTY_REASON[row.emptyReason] : undefined}
          >
            Empty · {row.emptyReason ? EMPTY_REASON[row.emptyReason] : "No synchronized workspace"}
          </span>
        ) : (
          <span>
            {row.workspaces.length} workspace{row.workspaces.length === 1 ? "" : "s"}
            {row.fabricWorkspaceCount != null && ` of ${row.fabricWorkspaceCount} in Fabric`}
            {row.workspacesWithoutSummary > 0 && ` · ${row.workspacesWithoutSummary} without summary`}
          </span>
        )}
        {defaultLabel && <span title="Default sensitivity label of the domain">Default label: {defaultLabel}</span>}
      </span>
    </span>
  );
}

export function DomainGovernanceTable({
  rows,
  mode,
  activeKey,
  labelName,
  onSelect,
}: {
  rows: DomainGovernanceRow[];
  mode: "posture" | "coverage";
  activeKey?: string;
  labelName?: (id: string) => string | undefined;
  onSelect?: (row: DomainGovernanceRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-s border-b border-border bg-secondary/55 px-l py-m">
        <Layers3 className="mt-xxs icon-size-200 text-brand-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-300 font-semibold">{mode === "posture" ? "By domain" : "Trust coverage by domain"}</h3>
          <p className="text-200 text-muted-foreground">
            Aggregated from the workspaces synchronized by this Atlas deployment.
            {mode === "coverage" && " Unknown values are excluded from ratios and shown separately."}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-200">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" className="px-l py-s font-semibold">Domain</th>
              <th scope="col" className="px-m py-s text-right font-semibold">Items</th>
              {mode === "posture" ? (
                <>
                  <th scope="col" className="px-m py-s text-right font-semibold">Critical / high</th>
                  <th scope="col" className="px-m py-s text-right font-semibold">{MICROSOFT_PILLAR_LABEL.health}</th>
                  <th scope="col" className="px-m py-s text-right font-semibold">{MICROSOFT_PILLAR_LABEL.protect}</th>
                  <th scope="col" className="px-m py-s text-right font-semibold">{MICROSOFT_PILLAR_LABEL.trust}</th>
                </>
              ) : (
                <>
                  <th scope="col" className="px-m py-s font-semibold">Endorsed</th>
                  <th scope="col" className="px-m py-s font-semibold">Certified</th>
                  <th scope="col" className="px-m py-s font-semibold">Described</th>
                  <th scope="col" className="px-m py-s font-semibold">Labeled</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selectable = Boolean(onSelect) && !row.empty;
              return (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    selectable && "cursor-pointer hover:bg-accent",
                    activeKey === row.key && "bg-primary/5",
                  )}
                  onClick={selectable ? () => onSelect?.(row) : undefined}
                >
                  <td className="max-w-[320px] px-l py-s">
                    {selectable ? (
                      <button
                        type="button"
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Show findings for domain ${row.domain.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect?.(row);
                        }}
                      >
                        <DomainName row={row} labelName={labelName} />
                      </button>
                    ) : (
                      <DomainName row={row} labelName={labelName} />
                    )}
                  </td>
                  <td className="px-m py-s text-right font-numeric">{row.empty ? "—" : row.items}</td>
                  {mode === "posture" ? (
                    <>
                      <td className="px-m py-s text-right font-numeric">
                        {row.empty ? "—" : `${row.findings.critical} / ${row.findings.high}`}
                      </td>
                      <td className="px-m py-s text-right"><Score value={row.empty ? null : row.pillars.health} /></td>
                      <td className="px-m py-s text-right"><Score value={row.empty ? null : row.pillars.protect} /></td>
                      <td className="px-m py-s text-right"><Score value={row.empty ? null : row.pillars.trust} /></td>
                    </>
                  ) : row.empty ? (
                    <td colSpan={4} className="px-m py-s text-muted-foreground">No synchronized item</td>
                  ) : (
                    <>
                      <td className="px-m py-s"><Ratio value={row.coverage.endorsed} /></td>
                      <td className="px-m py-s"><Ratio value={row.coverage.certified} /></td>
                      <td className="px-m py-s"><Ratio value={row.coverage.described} /></td>
                      <td className="px-m py-s"><Ratio value={row.coverage.labeled} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
