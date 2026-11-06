Fabric Atlas governance store. All tables are in schema dbo. Each sync of a Fabric workspace creates an immutable snapshot.

# Snapshot rule (MANDATORY)
- dbo.Workspaces has ONE ROW PER SNAPSHOT of a workspace. Workspaces.fabricId = Fabric workspace GUID; Workspaces.snapshotId = snapshot of that row; syncedAt = when it was published.
- The current state of a workspace = the Workspaces row with the most recent syncedAt for its fabricId:
  WITH latest AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY fabricId ORDER BY syncedAt DESC) AS rn FROM dbo.Workspaces) ... WHERE rn = 1
- Snapshot tables (FabricItems, LineageEdges, AccessGrants, Principals, JobRuns, ConfigEntries, OperationalIncidents, AccessPolicyEvidences, ItemRelationsEvidenceSnapshots, SyncRuns) have workspace_id = Workspaces.fabricId (the Fabric workspace GUID, NOT Workspaces.id) and snapshotId. Always join: t.workspace_id = latest.fabricId AND t.snapshotId = latest.snapshotId.
- WorkspaceScopes.id = Fabric workspace GUID of each workspace selected in Atlas.

# Main tables
- Workspaces: displayName, capacity (capacity id), region, fabricDomainId (NULL = not assigned to a domain), itemCount, healthyCount, failingCount, staleCount, edgeCount, brokenEdgeCount, principalCount, externalPrincipalCount, grantCount, failedJobCount, labelCount, governanceSummaryJson (JSON: pillars.health/protect/trust scores 0-100, findings.critical/high/medium/low, coverage.endorsed/certified/described/labeled/tagged each with numerator/denominator/unknown), syncSectionsJson (status per collected section).
- FabricItems: one row per Fabric item. fabricId = item GUID, displayName, itemType, description, ownerEmail/ownerName, endorsement ('none','promoted','certified'), sensitivity (label name, empty = no label), sensitivityLabelId, tags/tagIds, health ('healthy','failing','unknown'), lastRefresh, itemCreatedAt, itemUpdatedAt, modifiedBy, size.
  Flags sensitivityMetadataAvailable, tagMetadataAvailable, ownerMetadataAvailable, endorsementMetadataAvailable: when 0 the metric was not collected for that item -> exclude from the denominator and report as unknown.
- LineageEdges: sourceFabricId -> targetFabricId (item GUIDs, join FabricItems.fabricId in the same snapshot), relation (writes, Direct Lake, orchestrates, SQL endpoint, Shortcut, ...), broken (1 = broken edge).
- AccessGrants: itemFabricId, principalRef (Principals.principalId), accessLevel ('owner','edit',...), roleName, source ('workspaceRole' or 'directShare'), flag ('admin','servicePrincipal' or empty).
- Principals: principalId, displayName, email, kind ('user','servicePrincipal','group'), external (1 = guest / external tenant), workspaceRole (Admin, Member, Contributor, Viewer).
- JobRuns: itemFabricId, itemName, jobType, status ('completed','failed'), startedAt, durationSec, message.
- OperationalIncidents: failed runs promoted to incidents: itemFabricId, itemName, itemType, jobType, occurredAt, firstObservedAt, durationSec.
- ConfigEntries: item configuration key/values (section, label, value). section '__schema__' = table schemas as JSON, 'Data agent selected elements', 'Source provenance', 'General', 'Tables'.
- SyncRuns: status, startedAt, finishedAt, itemsSynced, failureMessage per sync.
- ExternalDatasets / ExternalLineageEdges / OpenLineageImports: external lineage imported from OpenLineage (not snapshot based). ExternalDatasets.state 'linked' (mapped to a Fabric item through fabricItemId) or 'to_link'. ExternalLineageEdges: sourceDatasetId -> targetDatasetId (ExternalDatasets.id), jobName, lastRunState.
- GovernancePolicies (targets per pillar), GovernanceExceptions (accepted risks with expiresAt), FindingAcks (acknowledged findings), AccessReviews / AccessReviewEvents (access review decisions), Comments: user governance decisions, not snapshot based.
- Sync*, SynchronizerAuthorities, SavedViews, Users, storage.objects: technical tables of the app, use only for questions about the sync engine itself.

# Conventions
- "Stale" = item with itemUpdatedAt and lastRefresh older than 90 days.
- "External user" = Principals.external = 1.
- Domain names are not stored; refer to fabricDomainId.

# SQL dialect rules
- The engine is Synapse SQL: recursive CTEs (a CTE that references itself) are NOT supported and fail.
- To walk lineage over several hops, chain non recursive CTEs: hop1 = edges whose sourceFabricId is the root item, hop2 = edges whose sourceFabricId IN (SELECT targetFabricId FROM hop1), and so on up to hop4, then UNION ALL them. For upstream lineage, swap source and target.
- Lineage can contain cycles (a notebook reads then writes the same lakehouse): deduplicate edges with GROUP BY.
- LineageEdges.broken is a bit: use MAX(CAST(broken AS int)).
- Several items can share a display name (a Lakehouse and its SQLEndpoint): always return the item type next to the name.
