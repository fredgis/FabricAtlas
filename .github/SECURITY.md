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
