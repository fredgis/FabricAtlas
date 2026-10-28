import { domainLabel, type GovernanceEvidence } from "../governance-evidence";
import { cn } from "../ui";

/** Fabric domain shown as `Domain › Subdomain`, the GUID with "Unknown name", "No domain" or "Not collected". */
export function FabricDomainName({
  evidence,
  domainId,
  className,
}: {
  evidence: GovernanceEvidence | undefined;
  domainId: string | undefined;
  className?: string;
}) {
  const domain = domainLabel(evidence, domainId);
  if (domain.kind === "named") {
    return (
      <span className={className} title={domain.id}>
        {domain.label}
      </span>
    );
  }
  if (domain.kind === "unnamed") {
    return (
      <span className={cn("font-normal", className)}>
        <span className="font-monospace">{domain.id}</span>{" "}
        <span className="text-muted-foreground">(Unknown name)</span>
      </span>
    );
  }
  return (
    <span className={cn("font-normal text-muted-foreground", className)}>
      {domain.kind === "unassigned" ? "No domain assigned" : "Not collected"}
    </span>
  );
}
