// Runtime config for the live Sync (MSAL -> Fabric User Data Function).
//
// clientId / tenantId / workspaceId are provided at build time through VITE_*
// env vars (see .env.local, git-ignored, and docs/installation.md). Nothing is
// hard-coded so the repo isn't tied to a specific tenant. VITE_FABRIC_WORKSPACE_ID
// is written by `rayfin up`; VITE_ATLAS_SPA_CLIENT_ID / VITE_ATLAS_TENANT_ID you set.
//
// The UDF invoke URL is only known after the function is published in the
// Fabric portal. New deployments provide it through a public Rayfin env var;
// the localStorage fallback keeps older configured installations working.

export const ATLAS_CONFIG = {
  clientId:
    (import.meta.env.VITE_RAYFIN_ATLAS_SPA_CLIENT_ID as string) ||
    (import.meta.env.VITE_ATLAS_SPA_CLIENT_ID as string) ||
    "",
  tenantId:
    (import.meta.env.VITE_ATLAS_TENANT_ID as string) ||
    (import.meta.env.VITE_FABRIC_TENANT_ID as string) ||
    "",
  workspaceId: (import.meta.env.VITE_FABRIC_WORKSPACE_ID as string) || "",
  workspaceName:
    (import.meta.env.VITE_RAYFIN_ATLAS_WORKSPACE_NAME as string) ||
    "Microsoft Fabric workspace",
  syncAdminEmail:
    (import.meta.env.VITE_RAYFIN_ATLAS_SYNC_ADMIN_EMAIL as string) || "",
  // A Power BI-audience token both invokes the UDF (UserDataFunction.Execute.All)
  // and is forwarded to Fabric REST inside the function.
  scope: "https://analysis.windows.net/powerbi/api/.default",
};

const UDF_KEY = "atlas.udfUrl";

/** Resolved UDF `sync_all` invoke URL, or null when not configured yet. */
export function getUdfUrl(): string | null {
  const env =
    (import.meta.env.VITE_RAYFIN_ATLAS_UDF_URL as string | undefined) ??
    (import.meta.env.VITE_ATLAS_UDF_URL as string | undefined);
  if (env) return env;
  try {
    return localStorage.getItem(UDF_KEY);
  } catch {
    return null;
  }
}

/** True once the UDF `sync_all` invoke URL is known. */
export function isSyncConfigured(): boolean {
  return !!getUdfUrl() && !!ATLAS_CONFIG.clientId && !!ATLAS_CONFIG.syncAdminEmail;
}
