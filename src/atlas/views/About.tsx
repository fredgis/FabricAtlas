import {
  Boxes,
  CalendarDays,
  CheckCircle2,
  Code2,
  ExternalLink,
  GitCommitHorizontal,
  Layers3,
  Map,
  Package,
  ServerCog,
} from "lucide-react";
import { useAtlas } from "../store";
import { Card, SectionLabel } from "../ui";
import {
  APP_VERSION,
  BUILD_COMMIT,
  BUILD_DATE,
  CURRENT_RELEASE,
  REPOSITORY_URL,
  releaseUrl,
} from "../release";

function displayBuildDate(): string {
  const date = new Date(BUILD_DATE);
  if (Number.isNaN(date.valueOf()) || date.getUTCFullYear() === 1970) {
    return "Development build";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ExternalCard({
  href,
  icon: Icon,
  title,
  detail,
}: {
  href: string;
  icon: typeof Code2;
  title: string;
  detail: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-[12px] rounded-xl border border-border bg-card p-[14px] transition-all hover:-translate-y-[1px] hover:border-primary/50 hover:shadow-lg"
    >
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-[2px] block truncate text-[11px] text-muted-foreground">
          {detail}
        </span>
      </span>
      <ExternalLink
        size={14}
        className="text-muted-foreground transition-transform group-hover:translate-x-[2px] group-hover:text-primary"
      />
    </a>
  );
}

export function AboutView() {
  const { data, isPreview, configured, lastSyncedAt } = useAtlas();
  const runtime = isPreview ? "Local preview" : "Fabric Data App";
  const workspaceId = data.workspace.fabricId || "Not available";

  const facts = [
    { icon: Package, label: "Version", value: `v${APP_VERSION}` },
    { icon: GitCommitHorizontal, label: "Build commit", value: BUILD_COMMIT },
    { icon: CalendarDays, label: "Built", value: displayBuildDate() },
    { icon: ServerCog, label: "Runtime", value: runtime },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px] p-[24px]">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
          Project information
        </div>
        <h1 className="mt-[4px] text-[24px] font-bold">About Fabric Atlas</h1>
        <p className="mt-[5px] max-w-[780px] text-[13px] leading-[1.55] text-muted-foreground">
          Workspace metadata, governance, effective access and lineage in one
          Fabric-native application.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
          <div className="border-b border-border p-[20px] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-[14px]">
              <span className="flex h-[54px] w-[54px] items-center justify-center rounded-2xl bg-gradient-to-br from-[#0ea5b7] to-[#3b82f6] text-white shadow-lg">
                <Map size={27} />
              </span>
              <div>
                <div className="text-[20px] font-bold">Fabric Atlas</div>
                <div className="text-[12px] text-muted-foreground">
                  Workspace explorer · version {APP_VERSION}
                </div>
              </div>
            </div>
            <p className="mt-[16px] text-[13px] leading-[1.6] text-muted-foreground">
              Fabric Atlas reads workspace metadata through the Fabric APIs and
              semantic-model metadata paths, persists it through Rayfin, and turns it
              into an operational catalog for engineering and governance teams.
            </p>
            <div className="mt-[16px] grid gap-[8px] sm:grid-cols-2">
              <ExternalCard
                href={REPOSITORY_URL}
                icon={Code2}
                title="Source repository"
                detail="fredgis/FabricAtlas"
              />
              <ExternalCard
                href={releaseUrl()}
                icon={Package}
                title={`Release v${APP_VERSION}`}
                detail="Release notes and downloadable source"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[1px] bg-border">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-card p-[16px]">
                <Icon size={16} className="text-primary" />
                <div className="mt-[10px] text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-[4px] break-words font-mono text-[12px] font-semibold">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-[16px] lg:grid-cols-[1fr_1fr]">
        <Card className="p-[16px]">
          <div className="flex items-center gap-[8px]">
            <Layers3 size={16} className="text-primary" />
            <SectionLabel>Current deployment</SectionLabel>
          </div>
          <div className="mt-[13px] divide-y divide-border/60">
            {[
              ["Workspace", data.workspace.displayName],
              ["Workspace ID", workspaceId],
              ["Capacity", data.workspace.capacity || "Not reported"],
              ["Region", data.workspace.region || "Not reported"],
              ["Sync endpoint", configured ? "Configured" : "Not configured"],
              [
                "Last indexed",
                lastSyncedAt
                  ? new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(lastSyncedAt))
                  : "Never",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid gap-[5px] py-[9px] text-[12px] sm:grid-cols-[140px_1fr]"
              >
                <span className="font-semibold text-muted-foreground">{label}</span>
                <span className={label.includes("ID") ? "break-all font-mono" : ""}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-[16px]">
          <div className="flex items-center gap-[8px]">
            <Code2 size={16} className="text-primary" />
            <SectionLabel>Application stack</SectionLabel>
          </div>
          <div className="mt-[13px] grid gap-[9px] sm:grid-cols-2">
            {[
              ["React", "19.2.7"],
              ["Rayfin", "1.33.1"],
              ["Fabric app data", "1.1.0"],
              ["Tailwind CSS", "4.3.0"],
              ["TypeScript", "5.7.2"],
              ["Vite", "8.0.16"],
            ].map(([name, version]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-lg border border-border px-[11px] py-[9px] text-[12px]"
              >
                <span className="font-semibold">{name}</span>
                <span className="font-mono text-muted-foreground">{version}</span>
              </div>
            ))}
          </div>
          <div className="mt-[12px] flex items-start gap-[8px] rounded-lg bg-status-healthy/10 px-[11px] py-[9px] text-[11px] leading-[1.45] text-status-healthy">
            <CheckCircle2 size={14} className="mt-[1px] shrink-0" />
            Fabric Atlas reads metadata only. It does not copy or persist workspace
            business data.
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-border px-[16px] py-[13px]">
          <div>
            <div className="text-[14px] font-bold">
              v{CURRENT_RELEASE.version} · {CURRENT_RELEASE.title}
            </div>
            <div className="mt-[2px] text-[11px] text-muted-foreground">
              Released {CURRENT_RELEASE.date}
            </div>
          </div>
          <a
            href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-[6px] text-[12px] font-semibold text-primary hover:underline"
          >
            Full changelog
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="grid gap-[16px] p-[16px] md:grid-cols-2">
          {CURRENT_RELEASE.sections.map((section) => (
            <div key={section.title}>
              <SectionLabel>{section.title}</SectionLabel>
              <ul className="mt-[9px] space-y-[7px]">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-[8px] text-[12px] leading-[1.45]">
                    <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-[8px] text-[11px] text-muted-foreground">
        <Boxes size={14} />
        Built as a Rayfin Data App and deployed into Microsoft Fabric.
      </div>
    </div>
  );
}
