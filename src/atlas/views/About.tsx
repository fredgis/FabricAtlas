import { useState } from "react";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Map,
  Package,
  ServerCog,
  ShieldCheck,
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

const CLONE_COMMAND = `git clone ${REPOSITORY_URL}.git`;

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

function ProjectLink({
  href,
  icon: Icon,
  children,
  primary = false,
}: {
  href: string;
  icon: typeof Code2;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        primary
          ? "inline-flex items-center justify-center gap-s rounded-lg bg-primary px-l py-m text-300 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          : "inline-flex items-center justify-center gap-s rounded-lg border border-border bg-background px-l py-m text-300 font-semibold transition-colors hover:border-primary/50 hover:bg-accent"
      }
    >
      <Icon className="icon-size-200" aria-hidden="true" />
      {children}
      <ExternalLink className="icon-size-100" aria-hidden="true" />
    </a>
  );
}

export function AboutView() {
  const { data, isPreview, configured, lastSyncedAt } = useAtlas();
  const [copied, setCopied] = useState(false);

  const copyCloneCommand = async () => {
    try {
      await navigator.clipboard.writeText(CLONE_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy the clone command", CLONE_COMMAND);
    }
  };

  const facts = [
    { label: "Release", value: `v${APP_VERSION}`, icon: Package },
    { label: "Build", value: BUILD_COMMIT, icon: GitCommitHorizontal },
    {
      label: "Runtime",
      value: isPreview ? "Local preview" : "Fabric Data App",
      icon: ServerCog,
    },
    {
      label: "Workspace",
      value: data.workspace.displayName || "Microsoft Fabric",
      icon: Map,
    },
  ];

  return (
    <div className="atlas-content-frame flex flex-col gap-xl p-xl lg:p-xxl">
      <Card className="relative isolate overflow-hidden border-primary/30 bg-gradient-to-br from-primary/15 via-card to-lineage-downstream/10 shadow-xl">
        <div className="atlas-overview-beam" aria-hidden="true" />
        <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
          <section className="p-xl sm:p-xxxl">
            <div className="flex flex-wrap items-center gap-s">
              <span className="inline-flex items-center gap-s rounded-full border border-status-healthy/30 bg-status-healthy/10 px-m py-s text-200 font-semibold text-status-healthy">
                <GitBranch className="icon-size-100" aria-hidden="true" />
                Open source
              </span>
              <span className="rounded-full border border-border bg-background/55 px-m py-s text-200 font-semibold">
                MIT licensed
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-m py-s font-mono text-200 font-semibold text-primary">
                v{APP_VERSION}
              </span>
            </div>

            <div className="mt-xl flex items-center gap-l">
              <span className="flex icon-size-700 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lineage-downstream to-primary text-primary-foreground shadow-lg">
                <Map className="icon-size-400" aria-hidden="true" />
              </span>
              <div>
                <SectionLabel>Microsoft Fabric governance</SectionLabel>
                <h1 className="mt-xs font-heading text-hero-800 font-bold leading-hero-800 sm:text-hero-900 sm:leading-hero-900">
                  Fabric Atlas
                </h1>
              </div>
            </div>

            <p className="atlas-overview-copy mt-l text-300 leading-500 text-muted-foreground">
              An open-source workspace explorer for catalog, lineage, effective
              access, sensitivity, jobs and operational context — deployed directly
              into Microsoft Fabric with Rayfin.
            </p>

            <div className="mt-xl flex flex-col gap-s sm:flex-row sm:flex-wrap">
              <ProjectLink href={REPOSITORY_URL} icon={Code2} primary>
                View source
              </ProjectLink>
              <ProjectLink href={releaseUrl()} icon={Package}>
                Latest release
              </ProjectLink>
              <ProjectLink
                href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`}
                icon={GitCommitHorizontal}
              >
                Changelog
              </ProjectLink>
            </div>
          </section>

          <aside className="border-t border-border/70 bg-background/40 p-xl backdrop-blur-sm sm:p-xxl lg:border-l lg:border-t-0">
            <SectionLabel>Clone &amp; explore</SectionLabel>
            <div className="mt-m overflow-hidden rounded-xl border border-border bg-secondary">
              <div className="flex items-center gap-s border-b border-border px-m py-s text-200 text-muted-foreground">
                <span className="h-xs w-xs rounded-full bg-status-failing" />
                <span className="h-xs w-xs rounded-full bg-status-warning" />
                <span className="h-xs w-xs rounded-full bg-status-healthy" />
                <span className="ml-s">terminal</span>
              </div>
              <div className="flex items-center gap-m p-m">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-200 text-foreground">
                  {CLONE_COMMAND}
                </code>
                <button
                  type="button"
                  onClick={() => void copyCloneCommand()}
                  aria-label="Copy clone command"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <Check className="icon-size-200 text-status-healthy" />
                  ) : (
                    <Copy className="icon-size-200" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-l grid grid-cols-2 gap-s">
              {facts.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="min-w-0 rounded-xl border border-border bg-card/65 p-m"
                >
                  <Icon className="icon-size-200 text-primary" aria-hidden="true" />
                  <div className="mt-s text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-xs truncate text-200 font-semibold" title={value}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </Card>

      <div className="grid items-start gap-l lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-m border-b border-border bg-secondary/60 px-l py-m">
            <div>
              <SectionLabel>Current release</SectionLabel>
              <h2 className="mt-xs text-500 font-semibold">
                v{CURRENT_RELEASE.version} · {CURRENT_RELEASE.title}
              </h2>
            </div>
            <span className="text-200 text-muted-foreground">
              {CURRENT_RELEASE.date}
            </span>
          </div>
          <div className="grid gap-l p-l md:grid-cols-2">
            {CURRENT_RELEASE.sections.map((section) => (
              <section key={section.title}>
                <SectionLabel>{section.title}</SectionLabel>
                <ul className="mt-s space-y-s">
                  {section.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-s text-300 leading-300 text-muted-foreground"
                    >
                      <span className="mt-s h-xs w-xs shrink-0 rounded-full bg-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-l">
          <Card className="p-l">
            <div className="flex items-start gap-m">
              <span className="flex icon-size-600 shrink-0 items-center justify-center rounded-xl bg-status-healthy/10 text-status-healthy">
                <ShieldCheck className="icon-size-300" aria-hidden="true" />
              </span>
              <div>
                <SectionLabel>Open by design</SectionLabel>
                <h2 className="mt-xs text-400 font-semibold">
                  Metadata only, MIT licensed
                </h2>
                <p className="mt-s text-300 leading-400 text-muted-foreground">
                  Fabric Atlas does not copy workspace business data. The full source,
                  architecture and deployment guide are available in the repository.
                </p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border bg-secondary/60 px-l py-m">
              <SectionLabel>Deployment</SectionLabel>
            </div>
            <dl className="divide-y divide-border/60">
              {[
                ["Workspace", data.workspace.displayName || "Not available"],
                ["Build date", displayBuildDate()],
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
                <div key={label} className="grid grid-cols-3 gap-m px-l py-m">
                  <dt className="text-200 font-semibold text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="col-span-2 break-words text-200">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
