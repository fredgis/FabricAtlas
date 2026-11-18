// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP_CONNECT_ORIGINS, CSP_NON_CONNECT_ORIGINS, cspAllowsConnect, recommendedCsp } from "./csp";

const ROOT = resolve(__dirname, "..");
const ORIGIN = /https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) && name !== "csp.ts" ? [path] : [];
  });
}

function originsIn(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(ORIGIN)) {
      found.add(match[0].toLowerCase());
    }
  }
  return found;
}

describe("recommended CSP", () => {
  it("classifies every origin referenced by the app source", () => {
    const unclassified = [...originsIn(sourceFiles(ROOT))].filter(
      (origin) => !cspAllowsConnect(origin) && !(origin in CSP_NON_CONNECT_ORIGINS),
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies every origin in built assets when a build exists", () => {
    const dist = resolve(ROOT, "..", "dist", "assets");
    let files: string[] = [];
    try {
      files = readdirSync(dist).filter((name) => name.endsWith(".js")).map((name) => join(dist, name));
    } catch {
      return;
    }
    const known = [...originsIn(files)].filter((origin) => /microsoft|windows\.net|azure/.test(origin));
    const unclassified = known.filter(
      (origin) => !cspAllowsConnect(origin) && !(origin in CSP_NON_CONNECT_ORIGINS),
    );
    expect(unclassified).toEqual([]);
  });

  it("allows sign-in, Scout and Rayfin hosts and keeps scripts local", () => {
    const policy = recommendedCsp();
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    for (const { origin } of CSP_CONNECT_ORIGINS) expect(policy).toContain(origin);
    expect(cspAllowsConnect("https://centralus.pbidedicated.windows.net")).toBe(true);
    expect(cspAllowsConnect("https://6bf4c521.z6b.userdatafunctions.fabric.microsoft.com")).toBe(true);
    expect(cspAllowsConnect("https://evil.example")).toBe(false);
    expect(cspAllowsConnect("https://pbidedicated.windows.net.evil.example")).toBe(false);
  });
});
