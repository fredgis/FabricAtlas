import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/* Uniform chart typography and palette. */
const FONT = 11;
const FONT_SMALL = 10;
const INK = "#323130";
const MUTED = "#8a8886";
const GRID = "#edebe9";
const GHOST = "#d2d0ce";
const TRACK = "#f3f2f1";
const PALETTE = ["#0078d4", "#117865", "#742774", "#ca5010", "#c19c00", "#b146c2", "#0e8376", "#8a8886"];
const SEVERITY = [
  ["critical", "Critical", "#a4262c"],
  ["high", "High", "#ca5010"],
  ["medium", "Medium", "#c19c00"],
  ["low", "Low", "#8fb8e6"],
] as const;
const PILLARS = [["health", "Health"], ["protect", "Protect"], ["trust", "Trust"]] as const;
const POSTURE_TARGET = 70;
const HATCH = "url(#insights-hatch)";

type DataRow = [string, string | number];

function scoreColor(value: number): string {
  return value >= 75 ? "#107c10" : value >= 55 ? "#5ba55b" : value >= 40 ? "#c19c00" : "#a4262c";
}

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

/** Width of an element, kept in sync with resizes, so charts draw at native size. */
function useWidth<T extends HTMLElement>(fallback = 360) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(160, Math.floor(element.clientWidth)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Saves the first chart drawing of a card as a PNG, with the Unknown hatch inlined. */
async function downloadChartPng(container: HTMLElement | null, title: string): Promise<void> {
  const svg = container?.querySelector("svg[data-chart]");
  if (!(svg instanceof SVGSVGElement)) return;
  const box = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(box.width));
  clone.setAttribute("height", String(box.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
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
  children: (width: number) => ReactNode;
  rows: DataRow[];
  open?: { label: string; onClick: () => void };
  className?: string;
  /** Reason shown over a ghost chart when there is nothing to draw. */
  empty?: string;
}) {
  const card = useRef<HTMLElement>(null);
  const [body, width] = useWidth<HTMLDivElement>();
  return (
    <section ref={card} aria-label={title}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card px-m pb-s pt-m", className)}>
      <header className="mb-s flex min-h-[1.75rem] min-w-0 items-center gap-s">
        <div className="min-w-0">
          <h2 className="truncate text-300 font-semibold leading-300">{title}</h2>
          {subtitle && <p className="truncate text-100 leading-200 text-muted-foreground">{subtitle}</p>}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-xxs">
          {!empty && (
            <button type="button" onClick={() => void downloadChartPng(card.current, title)}
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
      <div ref={body} className="relative min-w-0 flex-1">
        <div className={cn(empty && "opacity-50")} aria-hidden={empty ? true : undefined}>{children(width)}</div>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center p-m text-center text-200 text-muted-foreground">
            <span className="rounded-md border border-border bg-card px-s py-xs shadow-sm">{empty}</span>
          </p>
        )}
      </div>
      {!empty && rows.length > 0 && (
        <details className="mt-xs border-t border-border pt-xs text-100">
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
        <li key={item.label} className="flex items-center gap-xxs whitespace-nowrap">
          <span className="inline-block size-[0.55rem] rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}{item.value != null && <span className="font-numeric font-semibold text-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const size = 56;
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const known = value != null;
  return (
    <svg data-chart width={size} height={size} role="img" aria-label={`${label}: ${known ? `${value}%` : "Unknown"}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TRACK} strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={known ? color : GHOST} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(known ? value : 35, 0.5) / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 96;
  const height = 36;
  const ghost = values.length < 2;
  const series = ghost ? [3, 5, 4, 6, 5, 7, 6, 8] : values;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const points = series.map((value, index) => [
    (index / (series.length - 1)) * (width - 4) + 2,
    height - 4 - ((value - min) / (max - min || 1)) * (height - 8),
  ]);
  const path = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const stroke = ghost ? GHOST : color;
  return (
    <svg data-chart width={width} height={height} role="img"
      aria-label={ghost ? "Trend: not enough snapshots yet" : `Trend over ${values.length} snapshots, latest ${values.at(-1)}`}>
      <polygon points={`2,${height} ${path} ${width - 2},${height}`} fill={stroke} opacity={0.1} />
      <polyline points={path} fill="none" stroke={stroke} strokeWidth={1.8} strokeDasharray={ghost ? "4 3" : undefined} />
      {!ghost && <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r={2.5} fill={color} />}
    </svg>
  );
}

function Kpi({ title, value, detail, chart, onOpen }: {
  title: string; value: string; detail: string; chart: ReactNode; onOpen: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-s rounded-lg border border-border bg-card p-m">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen}
          className="group flex max-w-full items-center gap-xxs text-left text-200 font-semibold leading-200 text-muted-foreground hover:text-primary">
          <span className="truncate">{title}</span>
          <ArrowRight className="icon-size-100 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden="true" />
        </button>
        <p className="mt-xxs font-numeric text-600 font-semibold leading-600">{value}</p>
        <p className="truncate text-100 leading-200 text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{chart}</div>
    </div>
  );
}

function Donut({ slices, total, unit, colors = PALETTE }: { slices: InsightSlice[]; total: number; unit: string; colors?: string[] }) {
  const size = 120;
  const outer = 54;
  const inner = 36;
  const center = size / 2;
  const ghost = total === 0;
  const parts = ghost ? [{ key: "a", label: "", value: 5 }, { key: "b", label: "", value: 3 }, { key: "c", label: "", value: 2 }] : slices;
  const sum = parts.reduce((acc, slice) => acc + slice.value, 0);
  const starts = parts.map((_, index) =>
    -Math.PI / 2 + (parts.slice(0, index).reduce((acc, slice) => acc + slice.value, 0) / sum) * Math.PI * 2);
  const point = (radius: number, at: number) => `${(center + radius * Math.cos(at)).toFixed(2)},${(center + radius * Math.sin(at)).toFixed(2)}`;
  return (
    <div className="flex min-w-0 items-center gap-m">
      <svg data-chart width={size} height={size} className="shrink-0" role="img"
        aria-label={ghost ? `No ${unit} yet` : slices.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}>
        {parts.map((slice, index) => {
          const start = starts[index];
          const end = start + (slice.value / sum) * Math.PI * 2 - (parts.length > 1 ? 0.0001 : 0);
          const large = end - start > Math.PI ? 1 : 0;
          return (
            <path key={slice.key} stroke="#fff" strokeWidth={1.5}
              fill={ghost ? [GHOST, "#e1dfdd", "#edebe9"][index] : colors[index % colors.length]}
              d={`M${point(outer, start)} A${outer},${outer} 0 ${large} 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`} />
          );
        })}
        <text x={center} y={center + 2} textAnchor="middle" fontSize={18} fontWeight={600} fill={ghost ? MUTED : INK}>{ghost ? "–" : total}</text>
        <text x={center} y={center + 16} textAnchor="middle" fontSize={FONT_SMALL} fill={MUTED}>{unit}</text>
      </svg>
      {!ghost && (
        <ul className="grid min-w-0 flex-1 gap-xxs text-100">
          {slices.map((slice, index) => (
            <li key={slice.key} className="flex min-w-0 items-center gap-xs">
              <span className="inline-block size-[0.55rem] shrink-0 rounded-sm" style={{ background: colors[index % colors.length] }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
              <span className="font-numeric font-semibold">{slice.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Horizontal bars with a label column, a value column and an optional target line. */
function BarRows({ width, rows, max, target, labelWidth = 104, ariaLabel }: {
  width: number;
  rows: Array<{ key: string; label: string; strong?: boolean; segments?: Array<{ value: number; color: string }>; value?: number | null; display?: string }>;
  max: number;
  target?: number;
  labelWidth?: number;
  ariaLabel: string;
}) {
  const rowHeight = 26;
  const valueWidth = 40;
  const span = Math.max(40, width - labelWidth - valueWidth - 8);
  const height = rows.length * rowHeight + 2;
  const labelChars = Math.floor((labelWidth - 8) / 6);
  return (
    <svg data-chart width={width} height={height} role="img" aria-label={ariaLabel}>
      {rows.map((row, index) => {
        const y = index * rowHeight;
        const segments = row.segments ?? (row.value == null ? [] : [{ value: row.value, color: scoreColor(row.value) }]);
        const unknown = row.segments ? !row.segments.length : row.value == null;
        const widths = segments.map((segment) => (segment.value / Math.max(max, 1)) * span);
        const end = labelWidth + widths.reduce((total, w) => total + w, 0);
        return (
          <g key={row.key}>
            <text x={labelWidth - 8} y={y + 16} textAnchor="end" fontSize={FONT} fontWeight={row.strong ? 600 : 400} fill={INK}>
              {short(row.label, labelChars)}
            </text>
            <rect x={labelWidth} y={y + 7} width={span} height={12} rx={2} fill={unknown ? HATCH : TRACK} />
            {segments.map((segment, segmentIndex) => (
              <rect key={segmentIndex} x={labelWidth + widths.slice(0, segmentIndex).reduce((total, w) => total + w, 0)} y={y + 7}
                width={widths[segmentIndex]} height={12} fill={segment.color}
                rx={segments.length === 1 ? 2 : 0} />
            ))}
            {target != null && (
              <line x1={labelWidth + (target / max) * span} x2={labelWidth + (target / max) * span} y1={y + 4} y2={y + 22} stroke={INK} strokeWidth={1.2} />
            )}
            <text x={unknown ? labelWidth + span + 6 : Math.min(end + 6, labelWidth + span + 6)} y={y + 17} fontSize={FONT} fontWeight={600}
              fill={unknown ? MUTED : INK}>{unknown ? "Unknown" : row.display}</text>
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

function TrendChart({ insights, width }: { insights: AtlasInsights; width: number }) {
  const height = 200;
  const left = 36;
  const right = 8;
  const ghost = insights.trend.length < 2;
  const projectionSteps = insights.trend.length >= 3 ? 2 : 0;
  const points = ghost
    ? Array.from({ length: 8 }, (_, index) => ({ items: 40 + index * 6, labels: 10 + index * 3, failing: 8 - (index % 3), failedJobs: 5, brokenEdges: 2 }))
    : insights.trend;
  const slots = points.length + projectionSteps;
  const rawMax = Math.max(1, ...points.flatMap((point) => TREND_SERIES.map(([key]) => Number(point[key]) || 0)));
  const step = 10 ** Math.floor(Math.log10(rawMax));
  const max = Math.ceil(rawMax / step) * step;
  const x = (index: number) => left + (index / Math.max(1, slots - 1)) * (width - left - right);
  const y = (value: number) => 8 + (1 - value / max) * (height - 30);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((width - left) / 70))));
  return (
    <>
      <svg data-chart width={width} height={height} role="img"
        aria-label={ghost ? "Snapshot trend: needs at least two validated snapshots" :
          TREND_SERIES.map(([key, label]) => `${label}: ${Number(insights.trend.at(-1)?.[key]) || 0}`).join(", ")}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={left} x2={width - right} y1={y(max * ratio)} y2={y(max * ratio)} stroke={GRID} />
            <text x={left - 6} y={y(max * ratio) + 3} fontSize={FONT_SMALL} fill={MUTED} textAnchor="end">{Math.round(max * ratio)}</text>
          </g>
        ))}
        {projectionSteps > 0 && (
          <>
            <rect x={x(points.length - 1)} y={8} width={x(slots - 1) - x(points.length - 1)} height={height - 30} fill="#faf9f8" />
            <text x={x(slots - 1) - 4} y={20} fontSize={FONT_SMALL} fill={MUTED} textAnchor="end" fontStyle="italic">Projection</text>
          </>
        )}
        {TREND_SERIES.map(([key, , color]) => {
          const values = points.map((point) => Number(point[key]) || 0);
          const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
          const projection = projectSeries(values, projectionSteps);
          const projected = [values.at(-1)!, ...projection]
            .map((value, index) => `${x(points.length - 1 + index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
          return (
            <g key={key}>
              <polyline points={line} fill="none" stroke={ghost ? GHOST : color} strokeWidth={2} strokeLinejoin="round"
                strokeDasharray={ghost ? "5 4" : undefined} />
              {!ghost && values.length <= 12 && values.map((value, index) => (
                <circle key={index} cx={x(index)} cy={y(value)} r={2.5} fill={color} />
              ))}
              {projection.length > 0 && <polyline points={projected} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="4 4" opacity={0.6} />}
            </g>
          );
        })}
        {!ghost && insights.trend.map((point, index) => (index % labelEvery === 0 || index === insights.trend.length - 1) && (
          <text key={point.snapshotId} x={x(index)} y={height - 6} fontSize={FONT_SMALL} fill={MUTED}
            textAnchor={index === 0 ? "start" : index === insights.trend.length - 1 && projectionSteps === 0 ? "end" : "middle"}>
            {new Date(point.syncedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
          </text>
        ))}
      </svg>
      <Legend items={[
        ...TREND_SERIES.map(([, label, color]) => ({ label, color: ghost ? GHOST : color })),
        ...(projectionSteps ? [{ label: "Projection (linear, not a measure)", color: "#d2d0ce" }] : []),
      ]} />
    </>
  );
}

function DomainHeatmap({ insights, width }: { insights: AtlasInsights; width: number }) {
  const ghost = insights.domains.length === 0;
  const rows = ghost
    ? [["Domain A", 70, 40, 55], ["Domain B", 50, 65, 30], ["Domain C", 80, 45, 60]] as const
    : insights.domains.map((row) => [row.domain.label, row.pillars.health, row.pillars.protect, row.pillars.trust] as const);
  const labelWidth = Math.min(130, Math.max(80, width * 0.32));
  const cell = Math.min(72, (width - labelWidth) / 3);
  const rowHeight = 28;
  const header = 18;
  return (
    <svg data-chart width={width} height={rows.length * rowHeight + header + 2} role="img"
      aria-label={ghost ? "No domain posture yet" : rows.map(([name, health, protect, trust]) => `${name}: Health ${health ?? "Unknown"}, Protect ${protect ?? "Unknown"}, Trust ${trust ?? "Unknown"}`).join("; ")}>
      {PILLARS.map(([, label], index) => (
        <text key={label} x={labelWidth + index * cell + cell / 2} y={12} textAnchor="middle" fontSize={FONT_SMALL} fontWeight={600} fill={MUTED}>{label}</text>
      ))}
      {rows.map(([name, ...values], rowIndex) => (
        <g key={`${name}-${rowIndex}`}>
          <text x={labelWidth - 8} y={header + rowIndex * rowHeight + 18} textAnchor="end" fontSize={FONT} fill={INK}>
            {short(String(name), Math.floor((labelWidth - 8) / 6))}
          </text>
          {values.map((value, index) => (
            <g key={index}>
              <rect x={labelWidth + index * cell + 1.5} y={header + rowIndex * rowHeight + 1.5} width={cell - 3} height={rowHeight - 3} rx={3}
                fill={ghost ? GHOST : value == null ? HATCH : scoreColor(value)} />
              {!ghost && (
                <text x={labelWidth + index * cell + cell / 2} y={header + rowIndex * rowHeight + 18} textAnchor="middle"
                  fontSize={FONT} fontWeight={600} fill={value == null ? MUTED : "#fff"}>{value ?? "?"}</text>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

function SignalRadar({ insights, width }: { insights: AtlasInsights; width: number }) {
  const ghost = insights.retirement.candidates === 0;
  const height = 160;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(54, width / 2 - 64);
  const point = (index: number, scale: number) => {
    const angle = (Math.PI * 2 * index) / RETIREMENT_SIGNAL_ORDER.length - Math.PI / 2;
    return [cx + radius * scale * Math.cos(angle), cy + radius * scale * Math.sin(angle)] as const;
  };
  const shortLabel: Record<string, string> = {
    dormant: "Dormant", "no-consumer": "Consumers", "failed-runs": "Runs", "no-owner": "Owner", "no-trust": "Trust", "duplicate-name": "Duplicate",
  };
  const values = RETIREMENT_SIGNAL_ORDER.map((id, index) =>
    ghost ? [0.6, 0.4, 0.3, 0.5, 0.7, 0.2][index] : insights.retirement.profile[id] / insights.retirement.candidates);
  return (
    <svg data-chart width={width} height={height} role="img"
      aria-label={ghost ? "No retirement candidate" : RETIREMENT_SIGNAL_ORDER.map((id) => `${RETIREMENT_SIGNAL_LABELS[id]}: ${insights.retirement.profile[id]}`).join(", ")}>
      {[1 / 3, 2 / 3, 1].map((scale) => (
        <polygon key={scale} points={RETIREMENT_SIGNAL_ORDER.map((_, index) => point(index, scale).join(",")).join(" ")} fill="none" stroke={GRID} />
      ))}
      {RETIREMENT_SIGNAL_ORDER.map((id, index) => {
        const [lx, ly] = point(index, 1.22);
        return (
          <text key={id} x={lx} y={ly + 3} fontSize={FONT_SMALL} fill={MUTED}
            textAnchor={Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end"}>{shortLabel[id]}</text>
        );
      })}
      <polygon points={values.map((value, index) => point(index, value).join(",")).join(" ")}
        fill={ghost ? "rgba(210,208,206,.3)" : "rgba(164,38,44,.16)"} stroke={ghost ? GHOST : "#a4262c"} strokeWidth={1.5}
        strokeDasharray={ghost ? "4 3" : undefined} />
    </svg>
  );
}

function JobCalendar({ insights, width }: { insights: AtlasInsights; width: number }) {
  const ghost = insights.jobs.runs === 0;
  const weeks = Math.ceil(insights.jobCalendar.length / 7);
  const gap = 3;
  const size = Math.max(8, Math.min(16, Math.floor((width - (weeks - 1) * gap) / weeks)));
  const color = (runs: number, failed: number) =>
    !runs ? TRACK : failed === 0 ? "#107c10" : failed / runs < 0.5 ? "#c19c00" : "#a4262c";
  return (
    <>
      <svg data-chart width={weeks * (size + gap) - gap} height={7 * (size + gap) - gap} role="img"
        aria-label={ghost ? "No job runs collected" : `${insights.jobs.runs} collected runs over 14 weeks, ${insights.jobs.failed} failed`}>
        {insights.jobCalendar.map((day, index) => (
          <rect key={day.date} x={Math.floor(index / 7) * (size + gap)} y={(index % 7) * (size + gap)} width={size} height={size} rx={2}
            fill={ghost ? (index % 5 === 0 ? GHOST : TRACK) : color(day.runs, day.failed)}>
            <title>{`${day.date}: ${day.runs} runs, ${day.failed} failed`}</title>
          </rect>
        ))}
      </svg>
      <Legend items={[{ label: "All succeeded", color: "#107c10" }, { label: "Some failed", color: "#c19c00" }, { label: "Mostly failed", color: "#a4262c" }, { label: "No run", color: TRACK }]} />
    </>
  );
}

function Treemap({ slices, width }: { slices?: InsightSlice[]; width: number }) {
  const height = 140;
  const ghost = !slices?.length;
  const data = ghost ? [{ key: "a", label: "", value: 6 }, { key: "b", label: "", value: 4 }, { key: "c", label: "", value: 3 }, { key: "d", label: "", value: 2 }] : slices!;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const [first, ...rest] = data;
  const firstWidth = rest.length ? Math.max(width * 0.32, (first.value / total) * width) : width;
  const columns = [rest.slice(0, Math.ceil(rest.length / 2)), rest.slice(Math.ceil(rest.length / 2))].filter((column) => column.length);
  const restTotal = rest.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const restWidth = width - firstWidth - 3 * columns.length;
  const cells: Array<{ slice: InsightSlice; x: number; y: number; w: number; h: number; index: number }> = [
    { slice: first, x: 0, y: 0, w: firstWidth, h: height, index: 0 },
  ];
  columns.reduce((x, column) => {
    const columnTotal = column.reduce((sum, slice) => sum + slice.value, 0);
    const w = (columnTotal / restTotal) * restWidth;
    column.reduce((y, slice) => {
      const h = (slice.value / columnTotal) * (height - 3 * (column.length - 1));
      cells.push({ slice, x, y, w, h, index: cells.length });
      return y + h + 3;
    }, 0);
    return x + w + 3;
  }, firstWidth + 3);
  return (
    <svg data-chart width={width} height={height} role="img"
      aria-label={ghost ? "Connection inventory not collected" : data.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}>
      {cells.map((cell) => {
        const chars = Math.floor((cell.w - 12) / 6.2);
        return (
          <g key={cell.slice.key}>
            <rect x={cell.x} y={cell.y} width={Math.max(0, cell.w)} height={Math.max(0, cell.h)} rx={3}
              fill={ghost ? [GHOST, "#e1dfdd", "#edebe9", "#f3f2f1"][cell.index] : PALETTE[cell.index % PALETTE.length]} />
            {!ghost && chars >= 3 && cell.h >= 20 && (
              <text x={cell.x + 6} y={cell.y + 15} fontSize={FONT} fontWeight={600} fill="#fff">
                {short(`${cell.slice.label} ${cell.slice.value}`, chars)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function total(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

const SELECT = "h-[2rem] min-w-[10rem] rounded-md border border-input bg-card px-s text-200";

export function InsightsView({ onNavigate }: { onNavigate: (navigation: AtlasNavigation) => void }) {
  const {
    data, history, workspaceSyncStatuses, governanceTargets, connectionInventory,
  } = useAtlas();
  const [period, setPeriod] = useState<InsightPeriod>(12);
  const [domain, setDomain] = useState("");
  const [workspace, setWorkspace] = useState("");
  const insights = useMemo(() => buildAtlasInsights({
    data,
    trend: history.trend,
    statuses: workspaceSyncStatuses,
    targets: governanceTargets,
    connections: connectionInventory.inventory,
    period,
    scope: { ...(domain ? { domain } : {}), ...(workspace ? { workspace } : {}) },
  }), [connectionInventory.inventory, data, domain, governanceTargets, history.trend, period, workspace, workspaceSyncStatuses]);

  const workspaceOptions = insights.allWorkspaces.filter((entry) => !domain || entry.domainKey === domain);
  const chooseWorkspace = (id: string) => setWorkspace(id);
  const chooseDomain = (key: string) => {
    setDomain(key);
    if (workspace && !insights.allWorkspaces.some((entry) => entry.id === workspace && (!key || entry.domainKey === key))) setWorkspace("");
  };

  const open = (tab: Tab, governanceSection?: GovernanceSection) => () =>
    onNavigate({ tab, focus: { requestId: crypto.randomUUID(), ...(governanceSection ? { governanceSection } : {}) } });
  const findings = total(insights.findings);
  const scopeLabel = workspace
    ? insights.allWorkspaces.find((entry) => entry.id === workspace)?.name ?? "Selected workspace"
    : `${insights.workspaces.length} workspace${insights.workspaces.length === 1 ? "" : "s"}${domain ? ` in ${insights.domainOptions.find((option) => option.key === domain)?.label ?? "domain"}` : ""}`;
  const detailSubtitle = workspace ? undefined : `Details for ${data.workspace.displayName}`;
  const noData = "No data yet. It appears after the next synchronization.";
  // Detail charts need the full snapshot of the active workspace, switched in the global header selector.
  const scopedName = insights.workspaces.length === 1 ? insights.workspaces[0].name : undefined;
  const detailEmpty = insights.activeInScope ? undefined
    : !insights.allWorkspaces.length ? noData
      : scopedName ? `Details need ${scopedName} as the active workspace: switch it in the header selector.`
        : "The active workspace is outside this scope: switch it in the header selector.";
  const hasItems = insights.activeInScope && data.items.length > 0;
  const trendValues = (key: "items" | "failing") => insights.trend.map((point) => Number(point[key]) || 0);
  const lineagePct = insights.lineage.lineageKnown && insights.lineage.edges
    ? Math.round((insights.lineage.resolved / insights.lineage.edges) * 100) : null;
  const linkedPct = insights.lineage.lineageKnown && hasItems
    ? Math.round((insights.lineage.itemsWithLineage / data.items.length) * 100) : null;
  const accessTotal = insights.access.reduce((sum, slice) => sum + slice.value, 0);
  const detailItems = hasItems ? data.items.length : 0;
  const workspaceMax = Math.max(1, ...insights.workspaces.map((entry) => (entry.findings ? total(entry.findings) : 0)));

  return (
    <div className="grid min-w-0 gap-m p-l" data-testid="atlas-insights">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="insights-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={TRACK} /><line x1="0" y1="0" x2="0" y2="6" stroke={GHOST} strokeWidth="2" />
          </pattern>
        </defs>
      </svg>
      <header className="flex flex-wrap items-end gap-m">
        <div className="min-w-0">
          <h1 className="flex items-center gap-s text-500 font-semibold"><PieChart className="icon-size-300 text-primary" aria-hidden="true" />Atlas Insights</h1>
          <p className="text-200 text-muted-foreground">{scopeLabel} · validated snapshots. Unknown evidence is hatched, never shown as healthy.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-s">
          <label className="grid gap-xxs text-100 font-semibold text-muted-foreground">
            Domain
            <select className={SELECT} value={domain} onChange={(event) => chooseDomain(event.target.value)}>
              <option value="">All domains</option>
              {insights.domainOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-xxs text-100 font-semibold text-muted-foreground">
            Workspace
            <select className={SELECT} value={workspace} onChange={(event) => chooseWorkspace(event.target.value)}>
              <option value="">All workspaces</option>
              {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Snapshot period" className="flex h-[2rem] overflow-hidden rounded-md border border-input">
            {([3, 6, 12] as const).map((months, index) => (
              <button key={months} type="button" aria-pressed={period === months} onClick={() => setPeriod(months)}
                className={cn("px-s text-200", index > 0 && "border-l border-input",
                  period === months ? "bg-primary/10 font-semibold text-primary" : "bg-card hover:bg-accent")}>
                {months} months
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-m sm:grid-cols-2 xl:grid-cols-5">
        <Kpi title="Governance posture" value={insights.posture == null ? "–" : String(insights.posture)}
          detail={insights.workspacesWithoutSummary ? `${insights.workspacesWithoutSummary} workspace(s) Unknown` : "Health, Protect, Trust average"}
          chart={<Ring value={insights.posture} color="#117865" label="Governance posture" />} onOpen={open("governance", "posture")} />
        <Kpi title="Open findings" value={String(findings)} detail={`${insights.findings.critical} critical · ${insights.findings.high} high`}
          chart={<Sparkline values={trendValues("failing")} color="#a4262c" />} onOpen={open("governance", "findings")} />
        <Kpi title="Fabric items" value={String(insights.items)} detail={scopeLabel}
          chart={<Sparkline values={trendValues("items")} color="#0078d4" />} onOpen={open("catalog")} />
        <Kpi title="Job success rate" value={insights.jobs.rate == null ? "–" : `${insights.jobs.rate}%`}
          detail={insights.activeInScope ? `${insights.jobs.runs} runs · ${data.workspace.displayName}` : "Select a workspace"}
          chart={<Ring value={insights.jobs.rate} color="#107c10" label="Job success rate" />} onOpen={open("jobs")} />
        <Kpi title="Sensitivity coverage" value={insights.labeled.rate == null ? "–" : `${insights.labeled.rate}%`}
          detail={`${insights.labeled.labeled} of ${insights.labeled.total} items labeled`}
          chart={<Ring value={insights.labeled.rate} color="#742774" label="Sensitivity coverage" />} onOpen={open("governance", "coverage")} />
      </div>

      <div className="grid gap-m xl:grid-cols-[3fr_2fr]">
        <ChartCard title="Snapshot trend" subtitle={workspace ? `Last ${period} months` : `${data.workspace.displayName} · last ${period} months`}
          rows={insights.trend.map((point) => [new Date(point.syncedAt).toLocaleDateString(), `${point.items} items · ${point.labels} labeled · ${point.failing} failing · ${point.failedJobs} failed jobs · ${point.brokenEdges} broken`])}
          empty={detailEmpty ?? (insights.trend.length < 2 ? "Needs at least two validated snapshots in this period." : undefined)}
          open={{ label: "History", onClick: open("governance", "history") }}>
          {(width) => <TrendChart insights={insights} width={width} />}
        </ChartCard>
        <ChartCard title="Posture by pillar" subtitle={`OneLake catalog pillars · target ${POSTURE_TARGET}`}
          rows={PILLARS.map(([key, label]) => [label, insights.pillars[key] ?? "Unknown"])}
          empty={insights.workspaces.length ? undefined : noData} open={{ label: "Posture", onClick: open("governance", "posture") }}>
          {(width) => (
            <BarRows width={width} max={100} target={POSTURE_TARGET} labelWidth={72}
              ariaLabel={PILLARS.map(([key, label]) => `${label}: ${insights.pillars[key] ?? "Unknown"}`).join(", ")}
              rows={PILLARS.map(([key, label]) => ({ key, label, value: insights.pillars[key], display: String(insights.pillars[key] ?? "") }))} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Findings by workspace" subtitle="by severity"
          rows={insights.workspaces.map((entry) => [entry.name, entry.findings ? SEVERITY.map(([key, label]) => `${entry.findings![key]} ${label}`).join(", ") : "Unknown"])}
          empty={insights.workspaces.length ? undefined : noData}
          open={{ label: "Findings", onClick: open("governance", "findings") }}>
          {(width) => (
            <>
              <BarRows width={width} max={workspaceMax}
                ariaLabel={insights.workspaces.map((entry) => `${entry.name}: ${entry.findings ? total(entry.findings) : "Unknown"}`).join(", ")}
                rows={insights.workspaces.map((entry) => ({
                  key: entry.id, label: entry.name, strong: entry.active,
                  segments: entry.findings ? SEVERITY.map(([key, , color]) => ({ value: entry.findings![key], color })) : [],
                  display: entry.findings ? String(total(entry.findings)) : undefined,
                }))} />
              <Legend items={SEVERITY.map(([, label, color]) => ({ label, color }))} />
            </>
          )}
        </ChartCard>
        <ChartCard title="Domain × pillar" subtitle="OneLake catalog pillars"
          rows={insights.domains.map((row) => [row.domain.label, `Health ${row.pillars.health ?? "Unknown"}, Protect ${row.pillars.protect ?? "Unknown"}, Trust ${row.pillars.trust ?? "Unknown"}`])}
          empty={insights.domains.length ? undefined : "No domain posture yet."}>
          {(width) => <DomainHeatmap insights={insights} width={width} />}
        </ChartCard>
        <ChartCard title="Sensitivity labels by workspace" subtitle="share of labeled items"
          rows={insights.workspaces.map((entry) => [entry.name, entry.labeled ? `${entry.labeled.labeled} of ${entry.labeled.total}` : "Unknown"])}
          empty={insights.workspaces.length ? undefined : noData}
          open={{ label: "Coverage", onClick: open("governance", "coverage") }}>
          {(width) => (
            <>
              <BarRows width={width} max={100}
                ariaLabel={insights.workspaces.map((entry) => `${entry.name}: ${entry.labeled?.total ? `${Math.round((entry.labeled.labeled / entry.labeled.total) * 100)}%` : "Unknown"}`).join(", ")}
                rows={insights.workspaces.map((entry) => {
                  const share = entry.labeled?.total ? Math.round((entry.labeled.labeled / entry.labeled.total) * 100) : null;
                  return {
                    key: entry.id, label: entry.name, strong: entry.active,
                    segments: share == null ? [] : [{ value: share, color: "#742774" }],
                    display: share == null ? undefined : `${share}%`,
                  };
                })} />
              <Legend items={[{ label: "Labeled", color: "#742774" }, { label: "Not labeled", color: TRACK }, { label: "Unknown", color: GHOST }]} />
            </>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Items by type" subtitle={detailSubtitle} rows={insights.itemTypes.map((slice) => [slice.label, slice.value])}
          empty={detailEmpty ?? (hasItems ? undefined : noData)} open={{ label: "Catalog", onClick: open("catalog") }}>
          {() => <Donut slices={insights.itemTypes} total={detailItems} unit="items" />}
        </ChartCard>
        <ChartCard title="Access by level" subtitle={detailSubtitle ?? (insights.externalPrincipals ? `${insights.externalPrincipals} external principals` : undefined)}
          rows={insights.access.map((slice) => [slice.label, slice.value])}
          empty={detailEmpty ?? (accessTotal ? undefined : "No access grant collected yet.")} open={{ label: "Access", onClick: open("access") }}>
          {() => <Donut slices={insights.access} total={accessTotal} unit="grants" colors={["#a4262c", "#ca5010", "#8fb8e6", "#c8c6c4"]} />}
        </ChartCard>
        <ChartCard title="Lineage health" subtitle={detailSubtitle}
          rows={[["Resolved edges", `${insights.lineage.resolved} / ${insights.lineage.edges}`], ["Items with lineage", `${insights.lineage.itemsWithLineage} / ${detailItems}`]]}
          empty={detailEmpty ?? (insights.lineage.lineageKnown ? (hasItems ? undefined : noData) : "Lineage collection was incomplete: Unknown.")}
          open={{ label: "Map", onClick: open("map") }}>
          {(width) => (
            <BarRows width={width} max={100} labelWidth={112}
              ariaLabel={`Edges resolved: ${lineagePct ?? "Unknown"}%, items with lineage: ${linkedPct ?? "Unknown"}%`}
              rows={[
                { key: "edges", label: "Edges resolved", value: lineagePct, display: lineagePct == null ? undefined : `${lineagePct}%` },
                { key: "items", label: "Items with lineage", value: linkedPct, display: linkedPct == null ? undefined : `${linkedPct}%` },
              ]} />
          )}
        </ChartCard>
        <ChartCard title="Retirement signals" subtitle={detailSubtitle ?? `${insights.retirement.candidates} candidates`}
          rows={RETIREMENT_SIGNAL_ORDER.map((id) => [RETIREMENT_SIGNAL_LABELS[id], insights.retirement.profile[id]])}
          empty={detailEmpty ?? (insights.retirement.candidates ? undefined : "No retirement candidate in this snapshot.")}
          open={{ label: "Radar", onClick: open("governance", "retirement") }}>
          {(width) => <SignalRadar insights={insights} width={width} />}
        </ChartCard>
      </div>

      <div className="grid gap-m lg:grid-cols-3">
        <ChartCard title="Job runs, last 14 weeks" subtitle={detailSubtitle ?? "recent runs kept per item"}
          rows={insights.jobCalendar.filter((day) => day.runs).map((day) => [day.date, `${day.runs} runs, ${day.failed} failed`])}
          empty={detailEmpty ?? (insights.jobs.runs ? undefined : "No job run collected yet.")} open={{ label: "Jobs", onClick: open("jobs") }}>
          {(width) => <JobCalendar insights={insights} width={width} />}
        </ChartCard>
        <ChartCard title="Items per owner" subtitle={detailSubtitle} rows={insights.owners.map((slice) => [slice.label, slice.value])}
          empty={detailEmpty ?? (hasItems ? undefined : noData)} open={{ label: "Catalog", onClick: open("catalog") }}>
          {(width) => (
            <BarRows width={width} max={Math.max(1, ...insights.owners.map((slice) => slice.value))} labelWidth={Math.min(150, width * 0.4)}
              ariaLabel={insights.owners.map((slice) => `${slice.label}: ${slice.value}`).join(", ") || "No items yet"}
              rows={(insights.owners.length ? insights.owners : [{ key: "a", label: "", value: 6 }, { key: "b", label: "", value: 3 }]).map((slice) => ({
                key: slice.key, label: slice.label,
                segments: [{ value: slice.value, color: slice.label === "No owner" ? "#a4262c" : insights.owners.length ? "#117865" : GHOST }],
                display: insights.owners.length ? String(slice.value) : "",
              }))} />
          )}
        </ChartCard>
        <ChartCard title="Connections by connector" subtitle="tenant inventory"
          rows={(insights.connectors ?? []).map((slice) => [slice.label, slice.value])}
          empty={insights.connectors?.length ? undefined : "Connection inventory not collected yet."}
          open={{ label: "Connections", onClick: open("connections") }}>
          {(width) => <Treemap slices={insights.connectors} width={width} />}
        </ChartCard>
      </div>
    </div>
  );
}
