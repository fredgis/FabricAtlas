import { Buffer } from "node:buffer";
import type { DefinitionBenchmarkFixture } from "../../rayfin/functions/src/bulk-definition-benchmark.js";

export const FIXTURE_PROVENANCE = {
  kind: "sanitized-public-contract-examples",
  reviewedOn: "2026-10-02",
  sources: [
    "https://learn.microsoft.com/en-us/rest/api/fabric/core/items/bulk-export-item-definitions",
    "https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/graph-model-definition",
    "https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/semantic-model-definition",
  ],
  transformations: [
    "Public example shapes only; no tenant capture, credentials, business rows or measured service timings.",
    "Replace IDs and names; remove platform metadata, model partitions, annotations, source paths and filter values.",
    "Keep bulk TMDL and report byPath; supply a structural TMSL/byConnection per-item fallback specimen.",
    "Repeat the sanitized graph specimen twice to exercise batching; this is not an observed workspace.",
  ],
} as const;

const GRAPH = "11111111-1111-4111-8111-111111111111";
const GRAPH2 = "22222222-2222-4222-8222-222222222222";
const REPORT = "33333333-3333-4333-8333-333333333333";
const MODEL = "44444444-4444-4444-8444-444444444444";

function part(path: string, value: unknown) {
  return {
    path,
    payload: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64"),
    payloadType: "InlineBase64" as const,
  };
}

export function publicContractFixture(): DefinitionBenchmarkFixture {
  const graphs = [
    part(".platform", {}),
    part("graphType.json", {
      nodeTypes: [{
        alias: "Entity", labels: ["Entity"], primaryKeyProperties: ["Id"],
        properties: [{ name: "Id", type: "STRING" }],
      }],
      edgeTypes: [],
    }),
    part("graphDefinition.json", { nodeTables: [], edgeTables: [] }),
    part("dataSources.json", { dataSources: [] }),
    part("stylingConfiguration.json", {}),
  ];
  const report = [
    part(".platform", {}),
    part("definition.pbir", { version: "4.0", datasetReference: { byPath: { path: "../Model.SemanticModel" } } }),
  ];
  const model = [
    part(".platform", {}),
    part("definition/database.tmdl", "database\n\tcompatibilityLevel: 1550\n"),
    part("definition/tables/Entity.tmdl", "table Entity\n\tcolumn Id\n\t\tdataType: string\n"),
  ];
  const specimens = [
    { id: GRAPH, type: "GraphModel" as const, rootPath: "/GraphA.GraphModel", parts: graphs },
    { id: GRAPH2, type: "GraphModel" as const, rootPath: "/Folder/GraphB.GraphModel", parts: graphs },
    { id: REPORT, type: "Report" as const, rootPath: "/Folder/Report.Report", parts: report },
    { id: MODEL, type: "SemanticModel" as const, rootPath: "/Model.SemanticModel", parts: model },
  ];
  const fallback = {
    [REPORT]: [
      part(".platform", {}),
      part("definition.pbir", { version: "4.0", datasetReference: { byConnection: { pbiModelDatabaseName: MODEL } } }),
    ],
    [MODEL]: [
      part(".platform", {}),
      part("model.bim", { model: { tables: [{ name: "Entity", columns: [{ name: "Id", dataType: "string" }] }] } }),
    ],
  };
  return {
    version: 1,
    items: specimens.map(({ id, type }) => ({ id, type })),
    bulk: [{
      status: 200,
      body: {
        itemDefinitionsIndex: specimens.map(({ id, rootPath }) => ({ id, rootPath })),
        definitionParts: specimens.flatMap(({ rootPath, parts }) => parts.map((value) => ({
          ...value, path: `${rootPath}/${value.path}`,
        }))),
      },
    }],
    perItem: Object.fromEntries(specimens.map(({ id, parts }) => [
      id, [{ status: 200, body: { definition: { parts: fallback[id as keyof typeof fallback] ?? parts } } }],
    ])),
  };
}
