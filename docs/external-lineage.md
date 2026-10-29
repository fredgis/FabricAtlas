# External lineage (OpenLineage)

Since 2.7, Fabric Atlas can show what happens **outside Fabric** next to the
Fabric graph. The only exchange format is [OpenLineage](https://openlineage.io).
Atlas has no connector for SAS, Databricks, dbt, Airflow or any other tool:
each tool writes OpenLineage, Atlas reads it. In the other direction, Atlas
writes the Fabric lineage as OpenLineage so other tools can read it.

V1 is manual: you import a file, and you download a file. Automatic ingestion
and Spark runtime events are planned after V1 (#86, #19).

## Where

- **External lineage** (sidebar) → **Imports**, **Link to Fabric**, **File format**.
- **Map & lineage** → **External lineage** switch (shown once a file is imported)
  and **Download OpenLineage**.

## Import

1. Export OpenLineage events from the external tool (`.json` or `.ndjson`).
2. **External lineage → Import OpenLineage file**.
3. Atlas reads the events, keeps datasets, jobs, input → output edges and
   column lineage, and stores them in the workspace (three Rayfin tables:
   `OpenLineageImport`, `ExternalDataset`, `ExternalLineageEdge`).

Accepted input:

| Point | Rule |
|---|---|
| Files | `.json` (one event, an array, or `{ "events": [...] }`) or `.ndjson` (one event per line) |
| Events | `RunEvent`, `JobEvent`, `DatasetEvent` (OpenLineage 2-0-x) |
| Kept | dataset `namespace` + `name`, job `namespace` + `name`, run state and time, `columnLineage` facet |
| Not kept | data, SQL text, credentials, any other facet |
| Limits | 20 MB per file, 50 000 events, 5 000 datasets |

A file that contains no OpenLineage event is rejected and listed with the reason.
Re-importing a file with the same name replaces its edges; manual links are kept. Deleting an
import removes its edges and the datasets no other import uses.

## Link to Fabric

The link point is the dataset that exists on both sides.

- **Automatic (exact path)** — a dataset whose namespace is the OneLake host of
  the current workspace (`abfss://<workspace name or id>@onelake.dfs.fabric.microsoft.com`)
  and whose name is an item path (`<item>[.<Type>]/Tables/<schema>/<table>`,
  `<item>[.<Type>]/Files/...` or `<item>.<Type>`) is linked to that item.
  Names and GUIDs are both accepted; nothing is guessed.
- **Manual** — every other dataset is **To link**. An administrator picks the
  Fabric item, or marks it **External** (stays outside Fabric).

## Map and impact

With the **External lineage** switch on, external datasets and jobs appear in an
"External · OpenLineage" lane. A linked dataset is drawn on the Fabric item it
points to. Impact analysis follows the edges across the boundary: a Fabric
report shows its external upstream, an external job shows the Fabric items it
feeds.

## Download (export)

**Download OpenLineage** (External lineage header or Map toolbar) writes an
NDJSON file in the browser — no network call.

| Option | Effect |
|---|---|
| Current workspace | every item and edge of the snapshot |
| Selection on the map | selected item(s) and their direct neighbours |
| Include linked external datasets | adds imported edges that touch a linked Fabric item, with column lineage |

Content:

- One **JobEvent** per Fabric job item (Notebook, Data pipeline, Dataflow,
  Eventstream, User data function): inputs → job → outputs, `jobType` facet
  `integration = FABRIC`.
- One **JobEvent** per group of direct item → item edges (for example Warehouse →
  Semantic model), named `<target>.<Type>#<relation>`.
- One **DatasetEvent** per dataset item in scope, including items with no edge.
- Fabric datasets use the OneLake namespace and names above, so importing the
  file back links 100 % of them by exact path.
- `producer = https://github.com/fredgis/FabricAtlas/v2.7`, official
  OpenLineage `schemaURL`. Only item, table and job names are written.
