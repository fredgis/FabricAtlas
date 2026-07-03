import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CSSProperties, ReactNode } from "react";
import {
  typeMeta,
  HEALTH_COLOR,
  avatarColor,
  initials,
  type Health,
  type ItemType,
  type PrincipalKind,
} from "./model";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Round user avatar with deterministic colour + initials. */
export function Avatar({
  name,
  size = 28,
  title,
}: {
  name: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initials(name)}
    </span>
  );
}

const KIND_ICON: Record<PrincipalKind, string> = {
  user: "",
  group: "▦",
  servicePrincipal: "⚙",
  guest: "★",
};

/** Avatar that adapts to the principal kind (user / group / SP / guest). */
export function PrincipalAvatar({
  name,
  kind,
  size = 28,
}: {
  name: string;
  kind: PrincipalKind;
  size?: number;
}) {
  if (kind === "user") return <Avatar name={name} size={size} />;
  const bg =
    kind === "guest" ? "#8a5a1e" : kind === "servicePrincipal" ? "#0f5f5a" : "#475569";
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.45),
        border: kind === "guest" ? "2px solid #f5a524" : undefined,
      }}
    >
      {KIND_ICON[kind] || initials(name)}
    </span>
  );
}

/** Colored rounded square with the 2-letter Fabric item-type code. */
export function TypeGlyph({ type, size = 32 }: { type: ItemType; size?: number }) {
  const meta = typeMeta(type);
  return (
    <span
      title={meta.label}
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{
        width: size,
        height: size,
        background: meta.color,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {meta.code}
    </span>
  );
}

export function HealthDot({ health, size = 9 }: { health: Health; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: HEALTH_COLOR[health] }}
    />
  );
}

export function Chip({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[6px] rounded-md px-[8px] py-[2px] text-[11px] font-semibold",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

const ENDORSE_STYLE: Record<string, string> = {
  certified: "bg-[#0ea5b71f] text-[#0e8a99]",
  promoted: "bg-[#7c5cff1f] text-[#6d54e0]",
};

export function EndorsementChip({ endorsement }: { endorsement: string }) {
  if (endorsement === "none" || !endorsement) return null;
  return (
    <Chip className={ENDORSE_STYLE[endorsement] ?? ""}>
      {endorsement === "certified" ? "✔ Certified" : "Promoted"}
    </Chip>
  );
}

export function HealthChip({ health }: { health: Health }) {
  const label =
    health === "healthy"
      ? "Healthy"
      : health === "stale"
        ? "Stale"
        : health === "failing"
          ? "Failing"
          : "Unknown";
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-md px-[8px] py-[2px] text-[11px] font-semibold"
      style={{ background: `${HEALTH_COLOR[health]}22`, color: HEALTH_COLOR[health] }}
    >
      <HealthDot health={health} size={8} />
      {label}
    </span>
  );
}
