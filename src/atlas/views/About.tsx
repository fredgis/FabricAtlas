import { PageHeader } from "../components/PageHeader";
import { pythonCollectorRollbackEnabled } from "../browser-collector-sync";
import {
  APP_VERSION, BUILD_COMMIT, BUILD_DATE, FUNCTIONS_API_VERSION,
  RAYFIN_SDK_VERSION, REPOSITORY_URL, SNAPSHOT_CONTRACT_ID, releaseUrl,
} from "../release";
import { atlasFeatureFlags } from "../feature-flags";
import { PREVIEW_API_REGISTRY, previewMaturityLabel } from "../preview-api";
import { capabilityState, CAPABILITY_STATE_META } from "../capability-states";

export function AboutView() {
  const flags = atlasFeatureFlags();
  const groups = [
    { id: "active", label: "Active", flags: flags.filter((flag) => capabilityState(flag) === "active") },
    { id: "optional", label: "Optional / Off", flags: flags.filter((flag) => capabilityState(flag) === "available-off") },
    { id: "blocked", label: "Blocked / Deferred", flags: flags.filter((flag) => !["active", "available-off"].includes(capabilityState(flag))) },
  ];
  return (
    <div className="atlas-content-frame flex min-w-0 flex-col gap-l p-l sm:p-xxl">
      <PageHeader title="About Fabric Atlas" purpose="Workspace metadata, lineage and governance."
        actions={<a href={REPOSITORY_URL} target="_blank" rel="noreferrer"
          className="atlas-control inline-flex items-center rounded-md border border-border px-m text-200 font-semibold hover:bg-accent">View source</a>} />
      <dl aria-label="Runtime" className="grid gap-x-xxl gap-y-m border-y border-border px-l py-l sm:grid-cols-2">
        {[
          ["Application", `v${APP_VERSION}`],
          ["Rayfin SDK", RAYFIN_SDK_VERSION],
          ["Sync mode", pythonCollectorRollbackEnabled() ? "Python rollback · browser-run" : "Rayfin collectors + Python compatibility · browser-run"],
          ["Build", BUILD_COMMIT],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-200 text-muted-foreground">{label}</dt>
            <dd className="mt-xxs break-words text-300 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="divide-y divide-border px-l">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`about-${group.id}`} className="py-m">
            <h2 id={`about-${group.id}`} className="text-300 font-semibold">{group.label}</h2>
            <p className="mt-xs text-200 leading-300 text-muted-foreground">
              {group.flags.map((flag) => PREVIEW_API_REGISTRY[flag.id].productName).join(", ") || "None"}
            </p>
          </section>
        ))}
      </div>
      <details className="rounded-lg border border-border">
        <summary className="min-h-[var(--atlas-touch-target)] cursor-pointer px-l py-m text-300 font-semibold hover:bg-accent">
          Technical contracts
        </summary>
        <div className="grid gap-l border-t border-border p-l">
          <dl className="grid gap-m sm:grid-cols-3">
            {[
              ["Functions API", `v${FUNCTIONS_API_VERSION}`],
              ["Snapshot contract", SNAPSHOT_CONTRACT_ID],
              ["Built", BUILD_DATE],
            ].map(([label, value]) => (
              <div key={label}><dt className="text-200 text-muted-foreground">{label}</dt>
                <dd className="break-words font-mono text-200">{value}</dd></div>
            ))}
          </dl>
          <p className="text-200 text-muted-foreground">Atlas stores metadata, not business rows or credentials. Synchronization runs in the browser; scheduling is not enabled.</p>
          <ul className="divide-y divide-border">
            {flags.map((flag) => {
              const descriptor = PREVIEW_API_REGISTRY[flag.id];
              const state = capabilityState(flag);
              return (
                <li key={flag.id} className="py-m">
                  <h3 id={`coverage-${flag.id}`} className="text-300 font-semibold">{descriptor.productName}</h3>
                  <p className="mt-xs text-200 text-muted-foreground">
                    {CAPABILITY_STATE_META[state].label} · {previewMaturityLabel(descriptor.maturity)} · {descriptor.apiVersion}
                  </p>
                  <p className="mt-xs text-200 leading-300 text-muted-foreground">{descriptor.evidenceBoundary}</p>
                  {state === "available-off" && <code className="mt-xs block break-all text-200">{flag.environmentVariable}</code>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-l text-200">
            <a href={releaseUrl()} target="_blank" rel="noreferrer" className="text-primary underline">Latest release</a>
            <a href={`${REPOSITORY_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer" className="text-primary underline">Changelog</a>
            <span className="text-muted-foreground">MIT licensed</span>
          </div>
        </div>
      </details>
    </div>
  );
}
