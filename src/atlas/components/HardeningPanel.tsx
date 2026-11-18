import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { HARDENING_CHECKLIST, recommendedCsp } from "../csp";
import { Card, SectionLabel } from "../ui";

/** Recommended Fabric app hardening. Settings are applied by an administrator in Fabric. */
export function HardeningPanel() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const policy = recommendedCsp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(policy);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("failed");
    }
  };
  return (
    <Card className="overflow-hidden border-border shadow-fabric-2" data-testid="hardening-panel">
      <div className="flex flex-wrap items-center gap-m border-b border-border bg-secondary px-l py-m">
        <span className="flex icon-size-500 items-center justify-center rounded-lg bg-primary/10 text-brand-foreground">
          <ShieldCheck className="icon-size-200" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <SectionLabel>Production hardening</SectionLabel>
          <p className="mt-xs text-200 text-muted-foreground">
            Recommended baseline. Atlas cannot read what your tenant enforces.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="atlas-control flex items-center gap-s rounded-lg border border-border bg-card px-m text-200 font-semibold hover:bg-accent"
        >
          {state === "copied" ? (
            <Check className="icon-size-200 text-status-healthy" aria-hidden="true" />
          ) : (
            <Copy className="icon-size-200" aria-hidden="true" />
          )}
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy recommended CSP"}
        </button>
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-2">
        {HARDENING_CHECKLIST.map((check, index) => (
          <li key={check.id} className="bg-card px-l py-m text-200">
            <p className="font-semibold">
              {index + 1}. {check.title}
            </p>
            <p className="mt-xs text-muted-foreground">{check.detail}</p>
          </li>
        ))}
      </ol>
      <pre className="overflow-x-auto border-t border-border bg-secondary/55 px-l py-m font-mono text-100 leading-300 whitespace-pre-wrap break-all">
        {policy}
      </pre>
    </Card>
  );
}
