import type { GovernanceEvidence } from "../governance-evidence";
import type { Item } from "../model";
import { Card } from "../ui";

export function ExternalSharesCard({
  evidence,
  items,
}: {
  evidence: GovernanceEvidence | undefined;
  items: readonly Item[];
}) {
  const section = evidence?.externalShares;
  const known = section?.status.status === "complete";
  const names = new Map(items.map((item) => [item.fabricId, item]));
  return (
    <Card className="mt-l p-l">
      <h2 className="text-400 font-semibold">External shares</h2>
      <p className="mt-xxs text-200 text-muted-foreground">
        OneLake external data shares created from this workspace (read-only, from the admin API).
      </p>
      {!known ? (
        <p className="mt-s text-200 text-muted-foreground">
          External shares: Unknown — the external data shares API was not available to the synchronizer.
        </p>
      ) : section.entries.length === 0 ? (
        <p className="mt-s text-200 text-muted-foreground">No external data share recorded for this workspace.</p>
      ) : (
        <div className="mt-s overflow-x-auto">
          <table className="w-full text-left text-200" aria-label="External shares">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-xs pr-m font-semibold">Item</th>
                <th className="py-xs pr-m font-semibold">Recipient</th>
                <th className="py-xs pr-m font-semibold">Recipient tenant</th>
                <th className="py-xs pr-m font-semibold">Paths</th>
                <th className="py-xs pr-m font-semibold">Status</th>
                <th className="py-xs pr-m font-semibold">Created by</th>
              </tr>
            </thead>
            <tbody>
              {section.entries.map((share) => {
                const item = names.get(share.itemId);
                return (
                  <tr key={share.shareId} className="border-t border-border">
                    <td className="py-xs pr-m">
                      {item?.displayName ?? share.itemId}
                      {item?.sensitivity && <span className="ml-xs text-muted-foreground">({item.sensitivity})</span>}
                    </td>
                    <td className="py-xs pr-m">{share.recipient ?? "Unknown"}</td>
                    <td className="py-xs pr-m">{share.recipientTenantId ?? "Unknown"}</td>
                    <td className="py-xs pr-m">{share.paths.join(", ") || "—"}</td>
                    <td className="py-xs pr-m">{share.status}</td>
                    <td className="py-xs pr-m">{share.createdBy ?? "Unknown"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
