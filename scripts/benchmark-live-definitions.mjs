import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { runLiveDefinitionBenchmark } from "../rayfin/functions/dist/src/live-definition-benchmark.js";

const AUTH_COMMAND = "az account get-access-token --resource https://api.fabric.microsoft.com --output json --only-show-errors";

try {
  const { values } = parseArgs({
    options: { workspace: { type: "string" }, "confirm-read-only": { type: "boolean", default: false } },
  });
  if (!values.workspace || !values["confirm-read-only"]) throw new Error();
  // CLI owns the cache/refresh. Token is captured in process memory, never in argv, env, a file or logs.
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 128 * 1024 };
  const result = process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", AUTH_COMMAND], options)
    : execFileSync("az", AUTH_COMMAND.split(" ").slice(1), options);
  const credential = JSON.parse(result);
  const token = credential.accessToken;
  if (typeof token !== "string" || token.split(".").length !== 3) throw new Error();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (typeof claims.scp !== "string" || !Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now() + 150_000) {
    throw new Error();
  }
  const report = await runLiveDefinitionBenchmark(token, values.workspace, true);
  console.log(JSON.stringify({
    ...report, workspace: values.workspace,
    identity: {
      ...report.identity, source: "existing-Azure-CLI-cache", kind: "delegated-user",
      itemReadWriteScopePresent: claims.scp.split(" ").includes("Item.ReadWrite.All"),
    },
  }, null, 2));
} catch {
  console.error(JSON.stringify({
    outcome: "blocked", code: "LIVE_BENCHMARK_UNAVAILABLE",
    action: "Use an already authenticated Azure CLI user and --workspace <name> --confirm-read-only. No automatic login, consent, deployment or credential fallback is performed.",
    deployedBulkGateEnabled: false,
  }));
  process.exitCode = 1;
}
