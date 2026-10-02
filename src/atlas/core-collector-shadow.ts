import { getRayfinClient } from "@/lib/rayfin-client";
import {
  compareCoreCollectorParity,
  validateCoreCollectorEnvelope,
  type CoreCollectorEnvelope,
  type CoreParityReport,
} from "./core-collector-parity";

interface CoreCollectorShadowClient {
  functions: {
    workspaceCollectCore: {
      invoke: (
        input: {
          protocolVersion: 1;
          workspaceId: string;
          correlationId: string | null;
        },
        options?: { timeoutMs?: number },
      ) => Promise<CoreCollectorEnvelope>;
    };
  };
}

interface CoreCollectorShadowDependencies {
  client?: CoreCollectorShadowClient;
  enabled?: boolean;
  log?: (message: string, detail: unknown) => void;
  warn?: (message: string, detail: unknown) => void;
}

export function coreCollectorShadowEnabled(): boolean {
  const value = import.meta.env.VITE_ATLAS_CORE_COLLECTOR_SHADOW;
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function safeFailureDetail(error: unknown): { type: string } {
  return {
    type:
      error instanceof Error && error.name
        ? error.name.slice(0, 80)
        : "unknown",
  };
}

export async function startCoreCollectorShadow(
  workspaceId: string,
  correlationId: string,
  dependencies: CoreCollectorShadowDependencies = {},
): Promise<CoreCollectorEnvelope | undefined> {
  const enabled = dependencies.enabled ?? coreCollectorShadowEnabled();
  if (!enabled) return undefined;
  const client =
    dependencies.client ??
    (getRayfinClient() as unknown as CoreCollectorShadowClient);
  try {
    const envelope = await client.functions.workspaceCollectCore.invoke(
      {
        protocolVersion: 1,
        workspaceId,
        correlationId,
      },
      { timeoutMs: 180_000 },
    );
    validateCoreCollectorEnvelope(envelope, workspaceId);
    return envelope;
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] Rayfin Core shadow collection failed",
      safeFailureDetail(error),
    );
    return undefined;
  }
}

export function completeCoreCollectorShadow(
  rayfinEnvelope: CoreCollectorEnvelope | undefined,
  pythonEnvelope: unknown,
  dependencies: Pick<CoreCollectorShadowDependencies, "log" | "warn"> = {},
): CoreParityReport | undefined {
  if (!rayfinEnvelope) return undefined;
  try {
    const report = compareCoreCollectorParity(
      rayfinEnvelope,
      pythonEnvelope,
    );
    (dependencies.log ?? console.info)(
      "[atlas] Rayfin Core parity",
      report,
    );
    return report;
  } catch (error) {
    (dependencies.warn ?? console.warn)(
      "[atlas] Rayfin Core parity failed",
      safeFailureDetail(error),
    );
    return undefined;
  }
}

export function coreCollectorParitySummary(
  report: CoreParityReport,
): string {
  const fields = report.discrepancies
    .slice(0, 6)
    .map((entry) =>
      `${entry.collection}.${entry.field ?? entry.kind}`,
    )
    .join(",");
  return [
    `Core parity ${report.coreEqual ? "core-match" : "core-mismatch"}`,
    `coverage=${report.coverageEqual ? "match" : "different"}`,
    `differences=${report.discrepancyCount}`,
    `items=${report.counts.rayfin.items}/${report.counts.python.items}`,
    `roles=${report.counts.rayfin.roleAssignments}/${report.counts.python.roleAssignments}`,
    `jobs=${report.counts.rayfin.jobs}/${report.counts.python.jobs}`,
    fields ? `fields=${fields}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .join("; ")
    .slice(0, 420);
}
