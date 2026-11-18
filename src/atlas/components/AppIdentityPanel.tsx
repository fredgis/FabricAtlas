import { ExternalLink } from "lucide-react";
import { fabricGovernanceSurfaceUrl, FABRIC_GOVERNANCE_SURFACES } from "../fabric-portal";
import { appIdentityLine, type ItemPassportData } from "../item-passport";

/** Default identity of a Fabric app backend; portal-only controls are stated as Unknown. */
export function AppIdentityPanel({ data, itemId }: { data: Pick<ItemPassportData, "governanceEvidence">; itemId: string }) {
  return (
    <div className="space-y-xs p-l text-200">
      <p>
        <span className="text-muted-foreground">Default identity: </span>
        <strong data-testid="app-default-identity">{appIdentityLine(data, itemId)}</strong>
      </p>
      <p className="text-muted-foreground">
        Block state, Content Security Policy and Secure Embed are set in the Fabric portal and are not exposed by the
        API: Unknown.
      </p>
      <a
        className="inline-flex items-center gap-xs font-semibold text-brand-foreground hover:underline"
        href={fabricGovernanceSurfaceUrl(FABRIC_GOVERNANCE_SURFACES[0].path)}
        target="_blank"
        rel="noreferrer"
      >
        Open app governance in Fabric
        <ExternalLink className="icon-size-100" aria-hidden="true" />
      </a>
    </div>
  );
}
