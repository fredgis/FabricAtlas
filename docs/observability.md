# Observability foundation (Phase 9)

Fabric Atlas does not collect live monitoring telemetry. The Phase 9 foundation
adds three things to **Jobs & health**:

- native links to the Fabric Monitor hub and to the Atlas app's own metrics
- one model that separates *observed* failures from *inferred* downstream impact
- an explicit status for every monitoring source, including the ones Atlas
  cannot read

Nothing in this foundation adds a collector, a stored incident entity or a
background poll. When a monitoring source is unavailable, the validated catalog,
lineage and job history stay usable.

## Evidence model

`src/atlas/observability.ts` defines two evidence classes. The UI labels each one
with its own chip.

| Evidence | Meaning | Source | Label |
| --- | --- | --- | --- |
| Observed | The latest recorded run of an item and job type failed | Fabric job history captured at synchronization (`List Item Job Instances`) | Solid **Observed failure** chip |
| Inferred | A consumer reachable downstream of the failed item | Normalized snapshot lineage (`LineageEdge`) | Dashed **Inferred impact** chip |

- An observed incident carries the source workspace ID, item ID, job type, the
  run start time (`occurredAt`) and the snapshot capture time (`observedAt`). Its
  ID is the existing deterministic job search ID, so **Show this run** focuses
  the exact row in Run history.
- A failure followed by a later run of the same item and job type is history,
  not a current incident. A running latest run is not treated as a failure.
- Inferred impact is labelled "Not confirmed by monitoring". It walks only
  downstream edges, never reports the failed item or upstream producers, and
  records the hop distance. **Open impact in Map & lineage** opens the item in
  focused impact mode (`?item=<id>&impact=focused#map`).
- No inferred item is ever promoted to an observed incident. Phase 9 still has
  to join observed telemetry to verified impact before any downstream item can be
  shown as affected.

## Monitoring sources

| Source | Atlas status | Why |
| --- | --- | --- |
| Fabric job history | Collected | Read through the Job Scheduler REST API at each synchronization and stored with the snapshot |
| Workspace monitoring | Not collected | No Atlas collector exists. Atlas cannot detect whether monitoring is enabled |
| Monitor hub job alerts | Fabric portal only | Alert rules and notifications have no public read API |
| Fabric App Metrics | Fabric portal only | No public read API is documented |

## Native navigation

The Monitor hub routes were verified in the Fabric portal on 2026-10-02. Each
link adds `experience=fabric-developer` and, when `VITE_FABRIC_TENANT_ID` or
`VITE_ATLAS_TENANT_ID` is a valid tenant ID, `ctid=<tenant>` so guest users
reach the right tenant. Only HTTPS values of `VITE_FABRIC_PORTAL_URL` are used;
anything else falls back to `https://app.fabric.microsoft.com`.

| Link | Route | Notes |
| --- | --- | --- |
| Job runs in Monitor hub | `/monitoringhub/jobs` | Preview. Shows only items the user can view |
| Alerts in Monitor hub | `/monitoringhub/alerts` | Preview. Alert configuration stays in Fabric |
| Applications in Monitor hub | `/monitoringhub/applications` | Preview. Always-on platform metrics for apps the user can view |
| Open the Atlas app item | `/groups/<workspace>/appbackends/<item>` | Shown only when `VITE_FABRIC_WORKSPACE_ID` and `VITE_FABRIC_ITEM_ID` are valid IDs. Then select **Manage app > Metrics** |

The Monitor hub does not document deep links that pre-filter a workspace or an
item, so Atlas links to each page and does not invent filter parameters.

## Workspace monitoring prerequisites

Source: [Workspace monitoring overview](https://learn.microsoft.com/en-us/fabric/fundamentals/workspace-monitoring-overview)
and [Configure workspace monitoring](https://learn.microsoft.com/en-us/fabric/fundamentals/enable-workspace-monitoring),
checked on 2026-10-02.

- **Capacity.** The workspace must be assigned to Power BI Premium or a Fabric
  capacity.
- **Tenant settings.** A Fabric administrator must enable *Workspace admins can
  turn on monitoring for their workspaces*, and *Users can create Fabric items*
  must be enabled for the person configuring it.
- **Who enables it.** A workspace admin creates the Monitoring Item and then
  turns on collection. Collection is off when the item is created, and earlier
  activity is never backfilled.
- **Who can read it.** Workspace users with at least the Contributor role can
  query the read-only monitoring KQL database. The Monitoring Item can also be
  shared with people who have no workspace role.
- **Retention.** Data is kept for 30 days by default. Retention and caching are
  changed on the monitoring KQL database (*Manage > Data policies*). The caching
  period must not exceed the retention period.
- **Cost.** Ingestion, storage and queries consume Fabric capacity through
  Eventhouse, KQL database and Eventstream usage. Power BI reports and Activator
  alerts on the monitoring database respect capacity throttling.
- **Topology.** One Monitoring Item collects telemetry per workspace. Sending
  data to another Monitoring Item requires both workspaces in the same Azure
  region, and the destination cannot be changed later. Each source workspace
  adds a KQL database to the destination workspace's item limit.
- **Coverage.** A table appears only after a supported item emits telemetry.
  Supported telemetry includes item job events, pipeline activity runs, copy jobs,
  semantic model operations, Eventhouse, Eventstream, mirrored databases, GraphQL
  and Activator.

## Monitor hub alerts and App Metrics

- [Monitor hub job alerts](https://learn.microsoft.com/en-us/fabric/admin/monitoring-hub-alerts)
  are in Preview and portal-only. Failure emails need the Contributor role in the
  workspace or Write permission on the item and cover scheduled runs only.
  Activator-based rules need workspace Owner or Contributor and are unavailable
  where workspace monitoring is unavailable.
- [App Metrics](https://learn.microsoft.com/en-us/fabric/apps/app-metrics) are in
  Preview. They show sign-ins, app loads, GraphQL query count, error count, error
  rate and average server-side duration over 24 hours, 7 days or 30 days in UTC.
  Opening **Manage app > Metrics** requires Write permission on the app. App
  Metrics is not a capacity consumption report, and it has no individual error
  drill-down.

## Remaining collector blockers

The incident adapter stays unimplemented until each of these is resolved:

1. **No read API for alerts.** Monitor hub alerts and App Metrics expose no
   documented read API, so Atlas can only link to them.
2. **Workspace monitoring is opt-in and unknown to Atlas.** A workspace admin must
   enable it per workspace, it costs capacity, and Atlas has no supported way to
   detect whether it is on.
3. **No supported Kusto path.** Reading the monitoring KQL database needs a
   Kusto-audience token and at least Contributor access. The Rayfin Kusto
   connector is not documented, and Fabric Apps Functions use the AppBackend
   owner identity, which is not proven to have that access.
4. **No incident persistence contract.** The planned `OperationalIncident` entity,
   its allowlisted fields (no logs, secrets, query text or business rows) and its
   retention are not defined or reviewed yet.
5. **No verified impact join.** Downstream impact stays inferred until an observed
   telemetry row can be matched to a downstream item by a verified signal rather
   than by snapshot lineage alone.
