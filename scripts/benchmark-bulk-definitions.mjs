import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  benchmarkDefinitions, BULK_BENCHMARK_LIMITS, BULK_DEFINITION_RUNTIME_GATE,
} from "../rayfin/functions/dist/src/bulk-definition-benchmark.js";
import { FIXTURE_PROVENANCE, publicContractFixture } from "./fixtures/bulk-definitions.fixture.ts";

try {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string" },
      iterations: { type: "string", default: "10" },
      scenario: { type: "string", default: "contract" },
      live: { type: "boolean", default: false },
    },
  });
  if (values.live) throw new Error(BULK_DEFINITION_RUNTIME_GATE.reason);
  if (!/^\d+$/.test(values.iterations)) throw new Error("Use 1-50 iterations.");
  const iterations = Number(values.iterations);
  if (iterations < 1 || iterations > 50) throw new Error("Use 1-50 iterations.");
  const scenarios = ["contract", "bulk-forbidden", "bulk-throttled", "missing-item", "lro", "operation-failed"];
  if (!scenarios.includes(values.scenario)) throw new Error("Unknown replay scenario.");

  let fixture = publicContractFixture();
  if (values.fixture) {
    const handle = await open(values.fixture, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > BULK_BENCHMARK_LIMITS.maxFixtureBytes) throw new Error("Invalid fixture.");
      const buffer = Buffer.alloc(BULK_BENCHMARK_LIMITS.maxFixtureBytes + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > BULK_BENCHMARK_LIMITS.maxFixtureBytes) throw new Error("Invalid fixture.");
      fixture = JSON.parse(buffer.subarray(0, used).toString("utf8"));
    } finally { await handle.close(); }
  }
  if (values.scenario === "bulk-forbidden") fixture.bulk = [{ status: 403 }];
  if (values.scenario === "bulk-throttled") fixture.bulk = [{ status: 429 }];
  if (values.scenario === "missing-item") {
    const body = fixture.bulk[0].body;
    const omitted = body.itemDefinitionsIndex.shift();
    body.definitionParts = body.definitionParts.filter((part) => !part.path.startsWith(`${omitted.rootPath}/`));
  }
  if (values.scenario === "lro") fixture.bulk = [
    { status: 202 }, { status: 200, body: { status: "Running" } },
    { status: 200, body: { status: "Succeeded" } }, ...fixture.bulk,
  ];
  if (values.scenario === "operation-failed") fixture.bulk = [
    { status: 202 }, { status: 200, body: { status: "Failed" } },
  ];
  const started = performance.now();
  const runs = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (performance.now() - started > 30_000) throw new Error("Replay deadline reached.");
    runs.push(benchmarkDefinitions(fixture));
  }
  const timing = (key) => {
    const samples = runs.map((run) => run[key].metrics.durationMs).sort((a, b) => a - b);
    return { minMs: samples[0], medianMs: samples[Math.floor(samples.length / 2)], maxMs: samples.at(-1) };
  };
  console.log(JSON.stringify({
    ...runs.at(-1),
    provenance: values.fixture ? { kind: "operator-supplied-fixture-not-independently-verified" } : FIXTURE_PROVENANCE,
    scenario: values.scenario, iterations,
    replayTiming: { perItem: timing("perItem"), bulk: timing("bulk") },
  }, null, 2));
} catch {
  console.error("Benchmark refused or failed. Use Node 24, a bounded sanitized fixture and a documented offline scenario. Live bulk collection is disabled.");
  process.exitCode = 1;
}
