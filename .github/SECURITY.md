# Security policy

## Supported versions

Security fixes are applied to the latest Fabric Atlas release.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting:

https://github.com/fredgis/FabricAtlas/security/advisories/new

Include the affected version, deployment context, reproduction steps and
expected impact. Reports are reviewed as quickly as possible.

## Security boundary

Fabric Atlas stores workspace metadata and team notes. It does not copy or
persist workspace business data. Tokens and secrets must never be committed;
deployment values belong in the git-ignored `rayfin/.env` file.

The v1.x catalog is team-shared: every authenticated user admitted to the
deployed Fabric app can read the complete synchronized metadata graph and team
notes for its configured workspace. Catalog entities do not apply per-user read
filters. Deployment owners must control that audience through Fabric app and
workspace access.

Snapshot writes and retention are restricted to the configured synchronizer.
Saved views, access-review decisions and Radar acknowledgements are user-scoped.
Team notes are append-only; creation is bound to the authenticated email and
subject. The UI displays the policy-bound email beside any distinct author
label so readers can verify the identity.
