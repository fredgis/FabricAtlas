// Runtime config for the live Sync (MSAL -> Fabric User Data Function).
//
// clientId / tenantId are not secrets (they identify a public SPA app
// registration). They default to the values provisioned for FGI-MAIN and can
// be overridden at build time with VITE_* env vars.
//
// The UDF invoke URL is only known AFTER the function is Published in the
// Fabric portal, so it is not baked in: it is read from an env var if present,
// otherwise from localStorage (pasted once in the empty-state screen).

export const ATLAS_CONFIG = {
  clientId:
    (import.meta.env.VITE_ATLAS_SPA_CLIENT_ID as string) ||
    "16998994-9439-4e94-a401-4ac8ce7c8c02",
  tenantId:
    (import.meta.env.VITE_ATLAS_TENANT_ID as string) ||
    (import.meta.env.VITE_FABRIC_TENANT_ID as string) ||
    "1e45d0cb-b0dd-408c-8806-58b447605e96",
  workspaceId:
    (import.meta.env.VITE_FABRIC_WORKSPACE_ID as string) ||
    "6bf4c521-7412-4e6b-8867-68253bbfb18a",
  // A Power BI-audience token both invokes the UDF (UserDataFunction.Execute.All)
  // and is forwarded to Fabric REST inside the function.
  scope: "https://analysis.windows.net/powerbi/api/.default",
};

const UDF_KEY = "atlas.udfUrl";

/** Resolved UDF `sync_all` invoke URL, or null when not configured yet. */
export function getUdfUrl(): string | null {
  const env = import.meta.env.VITE_ATLAS_UDF_URL as string | undefined;
  if (env) return env;
  try {
    return localStorage.getItem(UDF_KEY);
  } catch {
    return null;
  }
}

export function setUdfUrl(url: string): void {
  try {
    localStorage.setItem(UDF_KEY, url.trim());
  } catch {
    /* ignore */
  }
}

/** True once the UDF `sync_all` invoke URL is known (env or pasted). */
export function isSyncConfigured(): boolean {
  return !!getUdfUrl();
}
