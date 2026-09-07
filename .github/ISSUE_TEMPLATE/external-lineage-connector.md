---
name: External lineage connector
about: Propose an external lineage source or interoperability standard
title: "[External lineage] "
labels: enhancement
assignees: ""
---

## Source

Name, system type and documentation URL.

## Fabric link

Describe the Fabric workspace item or object to link, and whether the external
asset is upstream, downstream or both.

## Metadata available

List the stable identifiers, asset types, relationship evidence, timestamps and
optional source URLs the connector can provide.

## Expected Atlas behaviour

Describe how the external nodes and edges should appear in lineage, impact
analysis and snapshot history.

## Acceptance criteria

- [ ] The connector uses stable, deterministic identities.
- [ ] Records follow the versioned external-lineage contract.
- [ ] Invalid or unresolved references fail explicitly.
- [ ] Repeated imports are idempotent.
- [ ] No business data, credentials or connection secrets are stored.

## Known limits

State any unsupported direction, object depth or evidence gap.
