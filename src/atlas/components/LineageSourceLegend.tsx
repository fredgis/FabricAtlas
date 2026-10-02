import { AlertTriangle } from "lucide-react";
import { HealthDot } from "../ui";

export const PREVIEW_DATA_DASH = "8 5";
export const PREVIEW_CONTROL_DASH = "10 4 2 4";

function LegendLine({
  label,
  color,
  dash,
  className,
}: {
  label: string;
  color: string;
  dash?: string;
  className?: string;
}) {
  return (
    <span className={className ?? "flex items-center gap-xs"}>
      <svg width="24" height="6" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="3"
          x2="24"
          y2="3"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dash}
        />
      </svg>
      {label}
    </span>
  );
}

/**
 * Graph legend. Source entries say where an edge comes from; selection
 * entries keep the existing upstream/downstream highlighting.
 */
export function LineageSourceLegend({
  mode,
  previewIncluded,
}: {
  mode: "items" | "objects";
  previewIncluded: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Lineage legend"
      className="sticky bottom-[14px] left-[14px] z-20 ml-[14px] flex w-fit max-w-[calc(100%-28px)] flex-wrap items-center gap-x-m gap-y-xs rounded-lg border border-border bg-card px-m py-s text-200 text-muted-foreground shadow-fabric-4"
    >
      {mode === "items" && (
        <>
          <span className="font-semibold text-foreground">Sources</span>
          <LegendLine
            label="Atlas snapshot (verified)"
            color="var(--color-lineage-neutral)"
          />
          {previewIncluded && (
            <>
              <LegendLine
                label="Item Relations API (Beta, observed)"
                color="var(--color-lineage-upstream)"
                dash={PREVIEW_DATA_DASH}
                className="flex items-center gap-xs text-lineage-upstream"
              />
              <LegendLine
                label="Beta control or lifecycle"
                color="var(--color-lineage-upstream)"
                dash={PREVIEW_CONTROL_DASH}
                className="flex items-center gap-xs text-lineage-upstream"
              />
              <span className="flex items-center gap-xs text-status-warning">
                <AlertTriangle className="icon-size-100" aria-hidden="true" />
                Conflict (review needed)
              </span>
            </>
          )}
          <span aria-hidden="true" className="h-l w-px bg-border" />
        </>
      )}
      <span className="flex items-center gap-xs text-lineage-upstream">
        <span className="w-[18px] border-t-2 border-dashed border-lineage-upstream" />{" "}
        upstream
      </span>
      <span className="flex items-center gap-xs text-lineage-downstream">
        <span className="h-[2px] w-[18px] bg-lineage-downstream" /> downstream
      </span>
      <span className="flex items-center gap-xs">
        <HealthDot health="healthy" size={7} /> healthy
      </span>
      <span>
        {mode === "items"
          ? "Ctrl/Cmd+click to multi-select · drag selection"
          : "Ctrl/Cmd+click to multi-select · drag objects"}
      </span>
    </div>
  );
}
