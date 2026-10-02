# Phase 10 live benchmark: measured, bulk activation deferred

Decision date: **2026-10-02**. Base revision:
`d335f7487955b1cfe7ad0bfa0ac02fe725a6b694`.

## Outcome

The cached Azure CLI delegated-user identity could discover FGI-MAIN and
retrieve individual definitions. A real bounded comparison ran without
deployment or credential creation. The documented selective bulk export
request returned **HTTP 404**. Direct bulk definition/format parity is therefore
unavailable, not successful.

**Close the Phase 10 investigation as measured with deployed activation
deferred.** Keep the existing per-item collectors. The deployed bulk gate
remains false. The result does not establish Fabric App/AppBackend
deployment-plan support, application-identity parity or a performance gain.

## Why this execution path was allowed

Installed Rayfin/Fabric packages are **1.36.2**. The installed Rayfin guide,
`functions/connections/index.md`, distinguishes developer CLI identity from
deployed `ctx.Tokens.Fabric` application identity. Audience declaration does not
guarantee token availability or resource permission.

The existing registered Atlas functions expose per-item collection, not a bulk
comparison entry point. Testing both paths as the deployed app would require a
separately reviewed runtime addition and deployment. No existing function was
used to export its application token, and no browser/session credential was
extracted.

An already authenticated Azure CLI user cache was available instead. The
authoring CLI retrieves the Fabric-audience access token through Azure CLI's
normal cache/refresh command, captures it only in process memory, and uses the
same token for both paths. It never puts the token in a command argument,
environment variable, file or log. It does not run `az login`, request consent,
create credentials, change permissions or deploy.

The current public [bulk export API][bulk] supports delegated users, with
workspace Contributor-or-higher and read/write permission on all selected
items. The command performs read actions only, even though this API's delegated
permission contract is `Item.ReadWrite.All`.

## Reproduce the exact experiment

Use Node 24/npm 11 with both repository lockfiles restored. Use a previously
authenticated Azure CLI user session; the command fails closed rather than
starting an interactive login or trying another credential source.

```powershell
npm ci
npm ci --prefix rayfin\functions
npm run benchmark:definitions:live -- --workspace FGI-MAIN --confirm-read-only

# Equivalent direct command after compiling the Functions package:
npm run build --prefix rayfin\functions
node scripts\benchmark-live-definitions.mjs --workspace FGI-MAIN --confirm-read-only
```

There are no token, tenant-secret, arbitrary URL, item-content, SQL or DAX query
arguments. Without `--confirm-read-only`, it refuses before acquiring a token.
Only `--workspace` and that confirmation are accepted.

The harness resolves the workspace by an exact unique display-name match in
the paginated workspace list. It lists items, chooses one Graph Model, one
Report and one Semantic Model by stable item-ID order where available, and
fills missing type slots from the remaining reviewed types. Maximum selection
is three. Names, item IDs, part paths and projected field values are not emitted.
Changes to the catalog can change the selection; this is a bounded canary, not
a statistically controlled performance test.

Execution order is one per-item pass followed by one selective bulk pass and,
where needed, **fresh per-item fallback requests**. The baseline is not reused
as if it were a measured fallback. Semantic-model per-item requests explicitly
use `format=TMSL`. Raw responses stay in memory and pass the same strict
benchmark projection checks as the offline harness before parity comparison.
No raw definition fixture is captured or persisted.

### Hard bounds

| Bound | Value |
| --- | ---: |
| Shared execution deadline, including discovery and both paths | 120 seconds |
| Timeout per HTTP attempt | 20 seconds |
| Requests across discovery, both paths, polls, results and fallback | 40 |
| Automatic HTTP retries | 0 |
| LRO polls per operation | 4 |
| Response body cap | 4 MiB |
| Aggregate consumed-response budget | 16 MiB |
| Workspace/item list pages and records | 5 pages / 1,000 records |

LRO polling uses the bounded existing transport; server hints are capped at
30 seconds, and a wait that cannot fit in the remaining shared deadline stops
the operation. HTTP 429 stops new work, including fallback. Redirects are
rejected; LRO URLs are reconstructed on the fixed Fabric API origin.
The Azure CLI cache operation has a separate 15-second process timeout.

## Measured result

Completed **2026-10-02 at 15:40:32.420 UTC** (17:40:32.420 local UTC+02).
FGI-MAIN had seven items of the reviewed types; the canary selected three.
The following values came from the live command, not the sanitized fixture.

| Phase | HTTP requests | Elapsed ms | Request-body bytes | Response-body bytes consumed | HTTP statuses |
| --- | ---: | ---: | ---: | ---: | --- |
| Discovery | 2 | 819.7708 | 0 | 20,685 | 200 × 2 |
| Per-item baseline | 9 | 68,061.0069 | 0 | 166,484 | 200 × 6; 202 × 3 |
| Bulk attempt plus fresh per-item fallback | 8 | 43,410.8618 | 168 | 72,724 | 200 × 4; 202 × 3; 404 × 1 |
| Whole experiment | 19 | 112,294.8267 | 168 | 259,893 | Includes discovery and both paths |

Elapsed time includes HTTP requests, body reads, LRO waits and projection.
Payload sizes are consumed **decompressed** body bytes, not compressed wire
sizes. Error bodies are cancelled without logging. The reported sum of
`Content-Length` values was 4,746 / 542 / 384 bytes for the three phases;
three baseline and three bulk/fallback responses omitted that header.
Those declared lengths are not comparable to decompressed consumed bytes.

The bulk row includes fallback and is not a successful bulk-export latency.
The shared deadline also gives the second path less remaining time. Do not
derive a speedup or throughput estimate from this single ordered experiment.

| Selected item type | Baseline | Bulk direct | Fresh fallback | Final parity |
| --- | --- | --- | --- | --- |
| Graph Model | Definition returned; `GraphJSON`; strict benchmark projection reported `projection-incomplete` | Unavailable after bulk 404 | `GraphJSON`; same projection rejection | Unavailable |
| Report | `PBIR`; projection complete | Unavailable after bulk 404 | `PBIR`; projection complete | One exact projection match |
| Semantic Model | `TMSL`; projection complete | Unavailable after bulk 404 | Definition LRO started, then `deadline-exhausted` before completion | Unavailable |

Baseline: two complete projections, one failed. Bulk/fallback: one complete,
two failed. Fallback attempted three items and succeeded for one.
Direct parity: zero matches, zero mismatches, three unavailable.
After fallback: one match, zero mismatches, two unavailable.

The Graph Model result is a **local strict projection gate**, not a Fabric
permission denial. The harness deliberately rejects missing/unknown/truncated
graph projection coverage. Production per-item collection was not changed to
reject that item, and no incomplete benchmark snapshot was published.

### Permission and identity interpretation

- No 401 or 403 was observed in the measured run. Individual definition
  operations accepted this cached user identity with 200/202 responses.
- The token's delegated scope list did not contain the exact literal
  `Item.ReadWrite.All`. The report records only that boolean, not token claims
  or scope strings. Observed per-item success does not justify granting more
  privileges or claiming the published bulk permission contract was satisfied.
- Bulk returned 404, mapped by the safe transport to `endpoint-unsupported`.
  This proves only that the documented route did not produce definitions for
  this target and identity. It does not distinguish rollout/route availability
  from concealed authorization or item-support behavior.
- Both measured paths used one credential and one item selection. The deployed
  Rayfin app identity was **not tested** and must not inherit this result.
- No bulk payload was returned, so TMDL versus TMSL and report `byPath` versus
  `byConnection` parity remain untested live. The offline fixtures still cover
  those expected differences, but are not live evidence.

The current [API reference][bulk] documents the route without `beta=true`.
The older `(beta)` documentation link in the overview returned 404 during
this follow-up. No undocumented endpoint or preview query was guessed, and no
permission-changing operation was attempted to work around the live 404.

## Reopening the deployment gate

Reopen only after all of these have separate evidence:

1. The documented selective bulk route is available for the target and intended
   identity, with reviewed item-type and permission support.
2. A bulk definition response passes strict per-item projection and format
   parity, including Graph Model coverage and the TMSL/PBIR differences.
3. An approved non-authoritative deployed canary verifies the actual Rayfin
   application identity without exposing its tokens or accepting browser tokens.
4. Same-selection measurements include complete paths within their budgets,
   permission failures, throttling, partial failures and per-item rollback.
5. The existing server-side authorization, complete-snapshot publication gate,
   default-off feature flag and rollback controls remain intact.

No deployment is authorized by this decision. The current useful deliverable
is the reproducible read-only command plus measured failure evidence.

[bulk]: https://learn.microsoft.com/en-us/rest/api/fabric/core/items/bulk-export-item-definitions
