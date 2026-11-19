import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Download, PieChart } from "lucide-react";
import { useAtlas } from "../store";
import type { AtlasNavigation, GovernanceSection, Tab } from "../navigation";
import {
  buildAtlasInsights,
  projectSeries,
  type AtlasInsights,
  type InsightPeriod,
  type InsightSlice,
} from "../insights";
import { RETIREMENT_SIGNAL_LABELS, RETIREMENT_SIGNAL_ORDER } from "../retirement-radar";
import { fileSlug } from "../download";
import { cn } from "../ui";

const PALETTE = ["#0078d4", "#117865", "#742774", "#ca5010", "#c19c00", "#b146c2", "#0e8376", "#8a8886"];
const SEVERITY = [
  ["critical", "Critical", "#a4262c"],
  ["high", "High", "#ca5010"],
  ["medium", "Medium", "#c19c00"],
  ["low", "Low", "#8fb8e6"],
] as const;
const GRID = "#e6e6e6";
const GHOST = "#d6d6d6";
const MUTED = "#8a8a8a";
const PILLAR_LABELS: Record<string, string> = {
  documentation: "Documentation", ownership: "Ownership", sensitivity: "Sensitivity",
  access: "Access", lineage: "Lineage", operations: "Operations",
};

type DataRow = [string, string | number];

/** Saves the first chart drawing of a card as a PNG. */
async function downloadChartPng(container: HTMLElement | null, title: string): Promise<void> {
  const svg = container?.querySelector("svg[data-chart]");
  if (!(svg instanceof SVGSVGElement)) return;
  const box = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(box.width));
  clone.setAttribute("height", String(box.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // The Unknown hatch is defined once per page; carry it into the standalone image.
  const hatch = document.getElementById("insights-hatch");
  if (hatch && clone.innerHTML.includes("insights-hatch")) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.appendChild(hatch.cloneNode(true));
    clone.insertBefore(defs, clone.firstChild);
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Chart image could not be rendered."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(box.width * 2);
    canvas.height = Math.ceil(box.height * 2);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(2, 2);
    context.drawImage(image, 0, 0, box.width, box.height);
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `atlas-insights-${fileSlug(title)}.png`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ChartCard({
  title, subtitle, children, rows, open, className, empty,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  rows: DataRow[];
  open?: { label: string; onClick: () => void };
  className?: string;
  /** Message shown over a ghost chart when there is nothing to draw. */
  empty?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} aria-label={title}
      className={cn("relative flex min-w-0 flex-col rounded-lg border border-border bg-card p-m shadow-sm", className)}>
      <header className="mb-s flex min-w-0 items-center gap-s">
        <h2 className="min-w-0 truncate text-300 font-semibold">{title}</h2>
        {subtitle && <span className="truncate text-100 text-muted-foreground">{subtitle}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-xxs">
          {!empty && (
            <button type="button" onClick={() => void downloadChartPng(ref.current, title)}
              aria-label={`Download ${title} as PNG`} title="Download PNG"
              className="inline-flex size-[1.75rem] items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
              <Download className="icon-size-200" aria-hidden="true" />
            </button>
          )}
          {open && (
            <button type="button" onClick={open.onClick}
              className="inline-flex h-[1.75rem] items-center gap-xxs rounded-md px-xs text-100 font-semibold text-primary hover:bg-accent">
              {open.label}<ArrowRight className="icon-size-100" aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
      <div className="relative min-w-0 flex-1">
        <div className={cn(empty && "opacity-60")} aria-hidden={empty ? true : undefined}>{children}</div>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center p-m text-center text-200 font-semibold text-muted-foreground">
            <span className="rounded-md bg-card/90 px-s py-xs">{empty}</span>
          </p>
        )}
      </div>
      {!empty && rows.length > 0 && (
        <details className="mt-s text-100">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View data</summary>
          <table className="mt-xs w-full text-left">
            <tbody className="divide-y divide-border">
              {rows.map(([label, value]) => (
                <tr key={label}><th scope="row" className="py-xxs pr-s font-normal">{label}</th><td className="py-xxs text-right font-numeric">{value}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string; value?: number | string }> }) {
  return (
    <ul className="mt-xs flex flex-wrap gap-x-m gap-y-xxs text-100 text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-xxs">
          <span className="inline-block size-[0.6rem] rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}{item.value != null && <b className="font-numeric text-foreground">&nbsp;{item.value}</b>}
        </li>
      ))}
    </ul>
  );
}

function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const size = 76;
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const known = value != null;
  return (
    <svg data-chart width={size} height={size} role="img" aria-label={`${label}: ${known ? `${value}%` : "Unknown"}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={GRID} strokeWidth={9} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={known ? color : GHOST} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (known ? value : 35) / 100)}
        strokeOpacity={known ? 1 : 0.6} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill={known ? "#242424" : MUTED}>
        {known ? value : "?"}
      </text>
    </svg>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 112;
  const height = 44;
  const series = values.length >= 2 ? values : [3, 5, 4, 6, 5, 7, 6, 8];
  const ghost = values.length < 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const points = series.map((value, index) => [
    (index / (series.length - 1)) * width,
    height - 4 - ((value - min) / (max - min || 1)) * (height - 8),
  ]);
  const path = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const stroke = ghost ? GHOST : color;
  return (
    <svg data-chart width={width} height={height} role="img"
      aria-label={ghost ? "Trend: not enough snapshots yet" : `Trend over ${values.length} snapshots, latest ${values.at(-1)}`}>
      <polygon points={`0,${height} ${path} ${width},${height}`} fill={stroke} opacity={0.12} />
      <polyline points={path} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray={ghost ? "4 3" : undefined} />
      {!ghost && <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r={3} fill={color} />}
    </svg>
  );
}

function Kpi({ title, value, detail, chart, onOpen }: {
  title: string; value: string; detail: string; chart: ReactNode; onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen}
      className="flex min-w-0 items-center justify-between gap-s rounded-lg border border-border bg-card p-m text-left shadow-sm hover:bg-accent">
      <span className="min-w-0">
        <span className="block truncate text-200 font-semibold">{title}</span>
        <span className="block font-numeric text-600 font-semibold leading-none">{value}</span>
        <span className="mt-xxs block truncate text-100 text-muted-foreground">{detail}</span>
      </span>
      <span className="shrink-0">{chart}</span>
    </button>
  );
}

function Donut({ slices, total, unit, colors = PALETTE }: { slices: InsightSlice[]; total: number; unit: string; colors?: string[] }) {
  const size = 132;
  const outer = 58;
  const inner = 36;
  const center = size / 2;
  const ghost = total === 0;
  const parts = ghost ? [{ key: "a", label: "", value: 5 }, { key: "b", label: "", value: 3 }, { key: "c", label: "", value: 2 }] : slices;
  const sum = parts.reduce((acc, slice) => acc + slice.value, 0);
  const starts = parts.map((_, index) =>
    -Math.PI / 2 + (parts.slice(0, index).reduce((acc, slice) => acc + slice.value, 0) / sum) * Math.PI * 2);
  const arcs = parts.map((slice, index) => {
    const start = starts[index];
    const end = start + (slice.value / sum) * Math.PI * 2 - (parts.length > 1 ? 0.0001 : 0);
    const large = end - start > Math.PI ? 1 : 0;
    const point = (radius: number, at: number) => `${center + radius * Math.cos(at)},${center + radius * Math.sin(at)}`;
    const d = `M${point(outer, start)} A${outer},${outer} 0 ${large} 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
    return <path key={slice.key} d={d} fill={ghost ? [GHOST, "#e3e3e3", "#ececec"][index] : colors[index % colors.length]} stroke="#fff" strokeWidth={1.5} />;
  });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-m">
      <svg data-chart width={size} height={size} role="img"
        aria-label={ghost ? `No ${unit} yet` : slices.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}>
        {arcs}
        <text x={center} y={center} textAnchor="middle" fontSize={20} fontWeight={700} fill={ghost ? MUTED : "#242424"}>{ghost ? "–" : total}</text>
        <text x={center} y={center + 16} textAnchor="middle" fontSize={10} fill={MUTED}>{unit}</text>
      </svg>
      {!ghost && <Legend items={slices.map((slice, index) => ({ label: slice.label, value: slice.value, color: colors[index % colors.length] }))} />}
    </div>
  );
}

function PillarBars({ insights }: { insights: AtlasInsights }) {
  const rowHeight = 26;
  const width = 360;
  const left = 96;
  const pillars = insights.pillars;
  return (
    <svg data-chart viewBox={`0 0 ${width} ${pillars.length * rowHeight + 6}`} width="100%" role="img"
      aria-label={pillars.map((pillar) => `${PILLAR_LABELS[pillar.pillar]}: ${pillar.score ?? "Unknown"} of target ${pillar.target}`).join(", ")}>
      {pillars.map((pillar, index) => {
        const y = index * rowHeight + 4;
        const span = width - left - 36;
        const known = pillar.score != null;
        const color = !known ? "url(#insights-hatch)" : pillar.score! >= pillar.target ? "#0e700e" : pillar.score! >= pillar.target - 15 ? "#c19c00" : "#a4262c";
        return (
          <g key={pillar.pillar}>
            <text x={left - 8} y={y + 13} textAnchor="end" fontSize={11} fill="#424242">{PILLAR_LABELS[pillar.pillar]}</text>
            <rect x={left} y={y + 3} width={span} height={12} rx={6} fill="#f0f0f0" />
            <rect x={left} y={y + 3} width={span * ((known ? pillar.score! : 100) / 100)} height={12} rx={6} fill={color} />
            <line x1={left + span * (pillar.target / 100)} x2={left + span * (pillar.target / 100)} y1={y} y2={y + 18} stroke="#242424" strokeWidth={1.5} />
            <text x={left + span + 6} y={y + 13} fontSize={11} fontWeight={700} fill={known ? "#242424" : MUTED}>{known ? pillar.score : "?"}</text>
          </g>
        );
      })}
    </svg>
  );
}

const TREND_SERIES = [
  ["items", "Items", "#0078d4"],
  ["labels", "Labeled", "#742774"],
  ["failing", "Failing", "#a4262c"],
  ["failedJobs", "Failed jobs", "#ca5010"],
  ["brokenEdges", "Broken lineage", "#c19c00"],
] as const;

function TrendChart({ insights }: { insights: AtlasInsights }) {
  const width = 560;
  const height = 190;
  const left = 34;
  const ghost = insights.trend.length < 2;
  const projectionSteps = ghost ? 0 : 2;
  const points = ghost
    ? Array.from({ length: 8 }, (_, index) => ({ items: 40 + index * 6, labels: 10 + index * 3, failing: 8 - (index % 3), failedJobs: 5, brokenEdges: 2 }))
    : insights.trend;
  const slots = points.length + projectionSteps;
  const max = Math.max(1, ...points.flatMap((point) => TREND_SERIES.map(([key]) => Number(point[key]) || 0)));
  const x = (index: number) => left + (index / Math.max(1, slots - 1)) * (width - left - 12);
  const y = (value: number) => 10 + (1 - value / max) * (height - 34);
  return (
    <>
      <svg data-chart viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
        aria-label={ghost ? "Snapshot trend: needs at least two validated snapshots" :
          TREND_SERIES.map(([key, label]) => `${label}: ${Number(insights.trend.at(-1)?.[key]) || 0}`).join(", ")}>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <g key={step}>
            <line x1={left} x2={width - 12} y1={y(max * step)} y2={y(max * step)} stroke={GRID} />
            <text x={left - 6} y={y(max * step) + 3} fontSize={9} fill={MUTED} textAnchor="end">{Math.round(max * step)}</text>
          </g>
        ))}
        {projectionSteps > 0 && (
          <rect x={x(points.length - 1)} y={6} width={x(slots - 1) - x(points.length - 1)} height={height - 30} fill="#f5f5f5" />
        )}
        {TREND_SERIES.map(([key, , color]) => {
          const values = points.map((point) => Number(point[key]) || 0);
          const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
          const projection = projectSeries(values, projectionSteps);
          const projected = [values.at(-1)!, ...projection]
            .map((value, index) => `${x(points.length - 1 + index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
          return (
            <g key={key}>
              <polyline points={line} fill="none" stroke={ghost ? GHOST : color} strokeWidth={2.2} strokeLinejoin="round"
                strokeDasharray={ghost ? "5 4" : undefined} />
              {projection.length > 0 && <polyline points={projected} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="4 4" opacity={0.7} />}
            </g>
          );
        })}
        {projectionSteps > 0 && (
          <text x={x(slots - 1)} y={18} fontSize={9.5} fill={MUTED} textAnchor="end" fontStyle="italic">Projection</text>
        )}
        {!ghost && insights.trend.map((point, index) => (index % Math.ceil(insights.trend.length / 8) === 0 || index === insights.trend.length - 1) && (
          <text key={point.snapshotId} x={x(index)} y={height - 6} fontSize={9} fill={MUTED} textAnchor="middle">
            {new Date(point.syncedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
          </text>
        ))}
      </svg>
      <Legend items={[
        ...TREND_SERIES.map(([, label, color]) => ({ label, color: ghost ? GHOST : color })),
        ...(projectionSteps ? [{ label: "Projection (linear, not a measure)", color: "#d0d0d0" }] : []),
      ]} />
    </>
  );
}

function WorkspaceFindings({ insights }: { insights: AtlasInsights }) {
  const rows = insights.workspaces;
  const width = 420;
  const rowHeight = 28;
  const left = 110;
  const max = Math.max(1, ...rows.map((row) => row.findings ? SEVERITY.reduce((sum, [key]) => sum + row.findings![key], 0) : 0));
  return (
    <>
      <svg data-chart viewBox={`0 0 ${width} ${rows.length * rowHeight + 4}`} width="100%" role="img"
        aria-label={rows.map((row) => `${row.name}: ${row.findings ? SEVERITY.map(([key, label]) => `${row.findings![key]} ${label}`).join(", ") : "Unknown"}`).join("; ")}>
        {rows.map((row, index) => {
          const y = index * rowHeight + 4;
          const span = width - left - 40;
          const total = row.findings ? SEVERITY.reduce((sum, [key]) => sum + row.findings![key], 0) : 0;
          const widths = SEVERITY.map(([key]) => (row.findings ? (row.findings[key] / max) * span : 0));
          const x = left + widths.reduce((sum, w) => sum + w, 0);
          return (
            <g key={row.id}>
              <text x={left - 8} y={y + 14} textAnchor="end" fontSize={11} fontWeight={row.active ? 700 : 400} fill="#424242">{row.name.length > 16 ? `${row.name.slice(0, 15)}…` : row.name}</text>
              {row.findings ? SEVERITY.map(([key, , color], index) => (
                <rect key={key} x={left + widths.slice(0, index).reduce((sum, w) => sum + w, 0)} y={y + 3} width={widths[index]} height={16} fill={color} />
              )) : <rect x={left} y={y + 3} width={span * 0.6} height={16} fill="url(#insights-hatch)" stroke={GHOST} />}
              <text x={row.findings ? x + 6 : left + span * 0.6 + 6} y={y + 15} fontSize={10.5} fontWeight={700} fill={row.findings ? "#242424" : MUTED}>
                {row.findings ? total : "Unknown"}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend items={SEVERITY.map(([, label, color]) => ({ label, color }))} />
    </>
  );
}

function DomainHeatmap({ insights }: { insights: AtlasInsights }) {
  const ghost = insights.domains.length === 0;
  const rows = ghost
    ? [["Domain A", 70, 40, 55], ["Domain B", 50, 65, 30], ["Domain C", 80, 45, 60]] as const
    : insights.domains.map((row) => [row.domain.label, row.pillars.health, row.pillars.protect, row.pillars.trust] as const);
  const cell = 58;
  const rowHeight = 26;
  const left = 110;
  const color = (value: number | null) =>
    ghost ? GHOST : value == null ? "url(#insights-hatch)" : value >= 75 ? "#0e700e" : value >= 55 ? "#6bb36b" : value >= 40 ? "#c19c00" : "#a4262c";
  return (
    <svg data-chart viewBox={`0 0 ${left + cell * 3 + 4} ${rows.length * rowHeight + 22}`} width="100%" role="img"
      aria-label={ghost ? "No domain posture yet" : rows.map(([name, health, protect, trust]) => `${name}: Health ${health ?? "Unknown"}, Protect ${protect ?? "Unknown"}, Trust ${trust ?? "Unknown"}`).join("; ")}>
      {["Health", "Protect", "Trust"].map((label, index) => (
        <text key={label} x={left + index * cell + cell / 2} y={12} textAnchor="middle" fontSize={10} fontWeight={600} fill="#616161">{label}</text>
      ))}
      {rows.map(([name, ...values], rowIndex) => (
        <g key={`${name}-${rowIndex}`}>
          <text x={left - 8} y={22 + rowIndex * rowHeight + 15} textAnchor="end" fontSize={10.5} fill="#424242">{String(name).length > 16 ? `${String(name).slice(0, 15)}…` : name}</text>
          {values.map((value, index) => (
            <g key={index}>
              <rect x={left + index * cell + 1} y={22 + rowIndex * rowHeight + 1} width={cell - 2} height={rowHeight - 2} rx={3} fill={color(value)} opacity={ghost ? 0.7 : 0.85} />
              {!ghost && <text x={left + index * cell + cell / 2} y={22 + rowIndex * rowHeight + 16} textAnchor="middle" fontSize={10} fontWeight={700} fill={value == null ? MUTED : "#fff"}>{value ?? "?"}</text>}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

function LabelCoverage({ insights }: { insights: AtlasInsights }) {
  const width = 360;
  const rowHeight = 28;
  const left = 100;
  const span = width - left - 44;
  const rows = insights.workspaces;
  return (
    <>
      <svg data-chart viewBox={`0 0 ${width} ${rows.length * rowHeight + 4}`} width="100%" role="img"
        aria-label={rows.map((row) => `${row.name}: ${row.labeled && row.labeled.total ? `${row.labeled.labeled} of ${row.labeled.total} labeled` : "Unknown"}`).join("; ")}>
        {rows.map((row, index) => {
          const y = index * rowHeight + 4;
          const total = row.labeled?.total ?? 0;
          const share = total ? row.labeled!.labeled / total : 0;
          const unknown = total ? row.labeled!.unknown / total : 0;
          return (
            <g key={row.id}>
              <text x={left - 8} y={y + 14} textAnchor="end" fontSize={11} fontWeight={row.active ? 700 : 400} fill="#424242">{row.name.length > 14 ? `${row.name.slice(0, 13)}…` : row.name}</text>
              {total ? (
                <>
                  <rect x={left} y={y + 3} width={span} height={16} fill="#e9e9e9" />
                  <rect x={left} y={y + 3} width={span * share} height={16} fill="#742774" />
                  <rect x={left + span * share} y={y + 3} width={span * unknown} height={16} fill="url(#insights-hatch)" />
                  <text x={left + span + 6} y={y + 15} fontSize={10.5} fontWeight={700} fill="#242424">{Math.round(share * 100)}%</text>
                </>
              ) : (
                <>
                  <rect x={left} y={y + 3} width={span} height={16} fill="url(#insights-hatch)" stroke={GHOST} />
                  <text x={left + span + 6} y={y + 15} fontSize={10.5} fill={MUTED}>?</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <Legend items={[{ label: "Labeled", color: "#742774" }, { label: "No label", color: "#e9e9e9" }, { label: "Unknown", color: GHOST }]} />
    </>
  );
}

function Gauge({ value, label, color }: { value: number | null; label: string; color: string }) {
  const radius = 52;
  const cx = 66;
  const cy = 62;
  const known = value != null;
  const angle = Math.PI * (1 - (known ? value : 50) / 100);
  return (
    <figure className="m-0 text-center">
      <svg data-chart width={132} height={74} role="img" aria-label={`${label}: ${known ? `${value}%` : "Unknown"}`}>
        <path d={`M${cx - radius},${cy} A${radius},${radius} 0 0 1 ${cx + radius},${cy}`} fill="none" stroke={GRID} strokeWidth={11} strokeLinecap="round" />
        <path d={`M${cx - radius},${cy} A${radius},${radius} 0 0 1 ${cx + radius * Math.cos(angle)},${cy - radius * Math.sin(angle)}`}
          fill="none" stroke={known ? color : GHOST} strokeWidth={11} strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={17} fontWeight={700} fill={known ? "#242424" : MUTED}>{known ? `${value}%` : "?"}</text>
      </svg>
      <figcaption className="text-100 text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function SignalRadar({ insights }: { insights: AtlasInsights }) {
  const ghost = insights.retirement.candidates === 0;
  const width = 220;
  const height = 150;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 50;
  const point = (index: number, scale: number) => {
    const angle = (Math.PI * 2 * index) / RETIREMENT_SIGNAL_ORDER.length - Math.PI / 2;
    return [cx + radius * scale * Math.cos(angle), cy + radius * scale * Math.sin(angle)] as const;
  };
  const values = RETIREMENT_SIGNAL_ORDER.map((id, index) =>
    ghost ? [0.6, 0.4, 0.3, 0.5, 0.7, 0.2][index] : insights.retirement.profile[id] / insights.retirement.candidates);
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
      aria-label={ghost ? "No retirement candidate" : RETIREMENT_SIGNAL_ORDER.map((id) => `${RETIREMENT_SIGNAL_LABELS[id]}: ${insights.retirement.profile[id]}`).join(", ")}>
      {[1 / 3, 2 / 3, 1].map((scale) => (
        <polygon key={scale} points={RETIREMENT_SIGNAL_ORDER.map((_, index) => point(index, scale).join(",")).join(" ")} fill="none" stroke={GRID} />
      ))}
      {RETIREMENT_SIGNAL_ORDER.map((id, index) => {
        const [lx, ly] = point(index, 1.24);
        return (
          <text key={id} x={lx} y={ly + 3} fontSize={9} fontWeight={600} fill="#616161"
            textAnchor={Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end"}>
            {RETIREMENT_SIGNAL_LABELS[id].replace("No downstream consumer", "Consumers").replace("No trust metadata", "Trust").replace("Duplicate name", "Duplicate").replace("Failing runs", "Runs").replace("No owner", "Owner")}
          </text>
        );
      })}
      <polygon points={values.map((value, index) => point(index, value).join(",")).join(" ")}
        fill={ghost ? "rgba(200,200,200,.25)" : "rgba(164,38,44,.18)"} stroke={ghost ? GHOST : "#a4262c"} strokeWidth={1.6}
        strokeDasharray={ghost ? "4 3" : undefined} />
    </svg>
  );
}

function JobCalendar({ insights }: { insights: AtlasInsights }) {
  const ghost = insights.jobs.runs === 0;
  const size = 14;
  const gap = 3;
  const weeks = Math.ceil(insights.jobCalendar.length / 7);
  const color = (runs: number, failed: number) =>
    !runs ? "#eeeeee" : failed === 0 ? "#0e700e" : failed / runs < 0.5 ? "#c19c00" : "#a4262c";
  return (
    <>
      <svg data-chart viewBox={`0 0 ${weeks * (size + gap)} ${7 * (size + gap)}`} width="100%" role="img"
        aria-label={ghost ? "No job runs collected" : `${insights.jobs.runs} collected runs over 14 weeks, ${insights.jobs.failed} failed`}>
        {insights.jobCalendar.map((day, index) => (
          <rect key={day.date} x={Math.floor(index / 7) * (size + gap)} y={(index % 7) * (size + gap)} width={size} height={size} rx={3}
            fill={ghost ? (index % 5 === 0 ? "#dcdcdc" : "#efefef") : color(day.runs, day.failed)}>
            <title>{`${day.date}: ${day.runs} runs, ${day.failed} failed`}</title>
          </rect>
        ))}
      </svg>
      <Legend items={[{ label: "All succeeded", color: "#0e700e" }, { label: "Some failed", color: "#c19c00" }, { label: "Mostly failed", color: "#a4262c" }, { label: "No run collected", color: "#eeeeee" }]} />
    </>
  );
}

function OwnerBars({ insights }: { insights: AtlasInsights }) {
  const rows = insights.owners;
  const ghost = rows.length === 0;
  const width = 420;
  const rowHeight = 22;
  const left = 130;
  const data = ghost ? [{ key: "a", label: "", value: 8 }, { key: "b", label: "", value: 5 }, { key: "c", label: "", value: 3 }] : rows;
  const max = Math.max(1, ...data.map((row) => row.value));
  return (
    <svg data-chart viewBox={`0 0 ${width} ${data.length * rowHeight + 4}`} width="100%" role="img"
      aria-label={ghost ? "No items yet" : rows.map((row) => `${row.label}: ${row.value}`).join(", ")}>
      {data.map((row, index) => {
        const y = index * rowHeight + 2;
        const w = (row.value / max) * (width - left - 40);
        const noOwner = row.label === "No owner";
        return (
          <g key={row.key}>
            <text x={left - 8} y={y + 14} textAnchor="end" fontSize={11} fill="#424242">{row.label.length > 20 ? `${row.label.slice(0, 19)}…` : row.label}</text>
            <rect x={left} y={y + 4} width={w} height={13} rx={3} fill={ghost ? GHOST : noOwner ? "#a4262c" : "#117865"} opacity={0.85} />
            {!ghost && <text x={left + w + 5} y={y + 14} fontSize={10.5} fontWeight={700} fill="#242424">{row.value}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Treemap({ slices }: { slices?: InsightSlice[] }) {
  const width = 420;
  const height = 130;
  const ghost = !slices?.length;
  const data = ghost ? [{ key: "a", label: "", value: 6 }, { key: "b", label: "", value: 4 }, { key: "c", label: "", value: 3 }, { key: "d", label: "", value: 2 }] : slices!;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const [first, ...rest] = data;
  const firstWidth = Math.max(width * 0.3, (first.value / total) * width);
  const restTotal = rest.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const columns = [rest.slice(0, Math.ceil(rest.length / 2)), rest.slice(Math.ceil(rest.length / 2))].filter((column) => column.length);
  let x = firstWidth + 3;
  const restWidth = width - x;
  const cells: Array<{ slice: InsightSlice; x: number; y: number; w: number; h: number; index: number }> = [
    { slice: first, x: 0, y: 0, w: firstWidth, h: height, index: 0 },
  ];
  let index = 1;
  for (const column of columns) {
    const columnTotal = column.reduce((sum, slice) => sum + slice.value, 0);
    const w = (columnTotal / restTotal) * restWidth - (columns.length > 1 ? 1.5 : 0);
    let y = 0;
    for (const slice of column) {
      const h = (slice.value / columnTotal) * height - 2;
      cells.push({ slice, x, y, w, h, index: index++ });
      y += h + 2;
    }
    x += w + 3;
  }
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
      aria-label={ghost ? "Connection inventory not collected" : data.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}>
      {cells.map((cell) => (
        <g key={cell.slice.key}>
          <rect x={cell.x} y={cell.y} width={Math.max(0, cell.w)} height={Math.max(0, cell.h)} rx={4}
            fill={ghost ? [GHOST, "#e2e2e2", "#ececec", "#f2f2f2"][cell.index] : PALETTE[cell.index % PALETTE.length]} />
          {!ghost && cell.w > 44 && cell.h > 18 && (
            <text x={cell.x + 7} y={cell.y + 16} fontSize={cell.index === 0 ? 11.5 : 10} fontWeight={700} fill="#fff">
              {cell.slice.label.length > Math.floor(cell.w / 7) ? `${cell.slice.label.slice(0, Math.max(3, Math.floor(cell.w / 7) - 3))}…` : cell.slice.label} · {cell.slice.value}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((total, value) => total + value, 0);
}

export function InsightsView({ onNavigate }: { onNavigate: (navigation: AtlasNavigation) => void }) {
  const { data, history, workspaceSyncStatuses, governanceTargets, connectionInventory } = useAtlas();
  const [period, setPeriod] = useState<InsightPeriod>(12);
  const insights = useMemo(() => buildAtlasInsights({
    data,
    trend: history.trend,
    statuses: workspaceSyncStatuses,
    targets: governanceTargets,
    connections: connectionInventory.inventory,
    period,
  }), [connectionInventory.inventory, data, governanceTargets, history.trend, period, workspaceSyncStatuses]);

  const open = (tab: Tab, governanceSection?: GovernanceSection) => () =>
    onNavigate({ tab, focus: { requestId: crypto.randomUUID(), ...(governanceSection ? { governanceSection } : {}) } });
  const findings = sum(insights.findings);
  const hasItems = insights.items > 0;
  const trendValues = (key: "items" | "labels" | "failing") => insights.trend.map((point) => Number(point[key]) || 0);
  const lineagePct = insights.lineage.lineageKnown && insights.lineage.edges
    ? Math.round((insights.lineage.resolved / insights.lineage.edges) * 100) : null;
  const linkedPct = insights.lineage.lineageKnown && insights.items
    ? Math.round((insights.lineage.itemsWithLineage / insights.items) * 100) : null;
  const accessTotal = insights.access.reduce((total, slice) => total + slice.value, 0);
  const noData = "No data yet. It appears after the next synchronization.";

  return (
    <div className="grid min-w-0 gap-m p-l" data-testid="atlas-insights">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="insights-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#f3f3f3" /><line x1="0" y1="0" x2="0" y2="6" stroke={GHOST} strokeWidth="2" />
          </pattern>
        </defs>
      </svg>
      <header className="flex flex-wrap items-center gap-m">
        <div className="min-w-0">
          <h1 className="flex items-center gap-s text-500 font-semibold"><PieChart className="icon-size-300 text-primary" aria-hidden="true" />Atlas Insights</h1>
          <p className="text-200 text-muted-foreground">
            {data.workspace.displayName} · charts from validated snapshots. Unknown evidence is hatched, never shown as healthy.
          </p>
        </div>
        <div role="group" aria-label="Snapshot period" className="ml-auto flex gap-xs">
          {([3, 6, 12] as const).map((months) => (
            <button key={months} type="button" aria-pressed={period === months} onClick={() => setPeriod(months)}
              className={cn("h-[1.875rem] rounded-full border px-m text-200",
                period === months ? "border-primary bg-primary/10 font-semibold text-primary" : "border-input bg-card hover:bg-accent")}>
              Last {months} months
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-m sm:grid-cols-2 xl:grid-cols-5">
        <Kpi title="Governance posture" value={insights.posture == null ? "?" : String(insights.posture)} detail="score / 100"
          chart={<Ring value={insights.posture} color="#117865" label="Governance posture" />} onOpen={open("governance", "posture")} />
        <Kpi title="Open findings" value={String(findings)} detail={`${insights.findings.critical} critical · ${insights.findings.high} high`}
          chart={<Sparkline values={trendValues("failing")} color="#a4262c" />} onOpen={open("governance", "findings")} />
        <Kpi title="Fabric items" value={String(insights.items)} detail={`${insights.trend.length} snapshots in period`}
          chart={<Sparkline values={trendValues("items")} color="#0078d4" />} onOpen={open("catalog")} />
        <Kpi title="Job success rate" value={insights.jobs.rate == null ? "?" : `${insights.jobs.rate}%`} detail={`${insights.jobs.runs} collected runs`}
          chart={<Ring value={insights.jobs.rate} color="#0e700e" label="Job success rate" />} onOpen={open("jobs")} />
        <Kpi title="Sensitivity coverage" value={insights.labeled.rate == null ? "?" : `${insights.labeled.rate}%`} detail={`${insights.labeled.labeled} of ${insights.labeled.total} labeled`}
          chart={<Ring value={insights.labeled.rate} color="#742774" label="Sensitivity coverage" />} onOpen={open("governance", "coverage")} />
      </div>

      <div className="grid gap-m xl:grid-cols-[1.35fr_1fr]">
        <ChartCard title="Snapshot trend" subtitle={`last ${period} months`}
          rows={insights.trend.map((point) => [new Date(point.syncedAt).toLocaleDateString(), `${point.items} items · ${point.labels} labeled · ${point.failing} failing · ${point.failedJobs} failed jobs · ${point.brokenEdges} broken`])}
          empty={insights.trend.length < 2 ? "Needs at least two validated snapshots in this period." : undefined}
          open={{ label: "History", onClick: open("governance", "history") }}>
          <TrendChart insights={insights} />
        </ChartCard>
        <ChartCard title="Posture by pillar" subtitle="score and target"
          rows={insights.pillars.map((pillar) => [PILLAR_LABELS[pillar.pillar], `${pillar.score ?? "Unknown"} / target ${pillar.target}`])}
          empty={hasItems ? undefined : noData} open={{ label: "Posture", onClick: open("governance", "posture") }}>
          <PillarBars insights={insights} />
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Findings by workspace" subtitle="by severity"
          rows={insights.workspaces.map((row) => [row.name, row.findings ? SEVERITY.map(([key, label]) => `${row.findings![key]} ${label}`).join(", ") : "Unknown"])}
          open={{ label: "Findings", onClick: open("governance", "findings") }}>
          <WorkspaceFindings insights={insights} />
        </ChartCard>
        <ChartCard title="Domain × pillar" subtitle="OneLake catalog pillars"
          rows={insights.domains.map((row) => [row.domain.label, `Health ${row.pillars.health ?? "Unknown"}, Protect ${row.pillars.protect ?? "Unknown"}, Trust ${row.pillars.trust ?? "Unknown"}`])}
          empty={insights.domains.length ? undefined : "No domain posture yet."}>
          <DomainHeatmap insights={insights} />
        </ChartCard>
        <ChartCard title="Sensitivity labels by workspace"
          rows={insights.workspaces.map((row) => [row.name, row.labeled ? `${row.labeled.labeled} of ${row.labeled.total}` : "Unknown"])}
          open={{ label: "Coverage", onClick: open("governance", "coverage") }}>
          <LabelCoverage insights={insights} />
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Items by type" rows={insights.itemTypes.map((slice) => [slice.label, slice.value])}
          empty={hasItems ? undefined : noData} open={{ label: "Catalog", onClick: open("catalog") }}>
          <Donut slices={insights.itemTypes} total={insights.items} unit="items" />
        </ChartCard>
        <ChartCard title="Access by level" subtitle={insights.externalPrincipals ? `${insights.externalPrincipals} external principals` : undefined}
          rows={insights.access.map((slice) => [slice.label, slice.value])}
          empty={accessTotal ? undefined : "No access grant collected yet."} open={{ label: "Access", onClick: open("access") }}>
          <Donut slices={insights.access} total={accessTotal} unit="grants" colors={["#a4262c", "#ca5010", "#8fb8e6", "#c8c8c8"]} />
        </ChartCard>
        <ChartCard title="Lineage health"
          rows={[["Resolved edges", `${insights.lineage.resolved} / ${insights.lineage.edges}`], ["Items with lineage", `${insights.lineage.itemsWithLineage} / ${insights.items}`]]}
          empty={insights.lineage.lineageKnown ? (hasItems ? undefined : noData) : "Lineage collection was incomplete: Unknown."}
          open={{ label: "Map", onClick: open("map") }}>
          <div className="flex flex-wrap items-end justify-around gap-s">
            <Gauge value={lineagePct} label="Edges resolved" color="#0e700e" />
            <Gauge value={linkedPct} label="Items with lineage" color="#0078d4" />
          </div>
        </ChartCard>
        <ChartCard title="Retirement signals" subtitle={`${insights.retirement.candidates} candidates`}
          rows={RETIREMENT_SIGNAL_ORDER.map((id) => [RETIREMENT_SIGNAL_LABELS[id], insights.retirement.profile[id]])}
          empty={insights.retirement.candidates ? undefined : "No retirement candidate in this snapshot."}
          open={{ label: "Radar", onClick: open("governance", "retirement") }}>
          <SignalRadar insights={insights} />
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-3">
        <ChartCard title="Job runs, last 14 weeks" subtitle="recent runs kept per item"
          rows={insights.jobCalendar.filter((day) => day.runs).map((day) => [day.date, `${day.runs} runs, ${day.failed} failed`])}
          empty={insights.jobs.runs ? undefined : "No job run collected yet."} open={{ label: "Jobs", onClick: open("jobs") }}>
          <JobCalendar insights={insights} />
        </ChartCard>
        <ChartCard title="Items per owner" rows={insights.owners.map((slice) => [slice.label, slice.value])}
          empty={hasItems ? undefined : noData} open={{ label: "Catalog", onClick: open("catalog") }}>
          <OwnerBars insights={insights} />
        </ChartCard>
        <ChartCard title="Connections by connector" subtitle="tenant inventory"
          rows={(insights.connectors ?? []).map((slice) => [slice.label, slice.value])}
          empty={insights.connectors?.length ? undefined : "Connection inventory not collected yet."}
          open={{ label: "Connections", onClick: open("connections") }}>
          <Treemap slices={insights.connectors} />
        </ChartCard>
      </div>
    </div>
  );
}
