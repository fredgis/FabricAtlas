/**
 * Content Security Policy baseline for Fabric Atlas as a Fabric app. The
 * policy itself is set by a Fabric administrator in the OneLake catalog
 * governance view (Apps); the browser cannot read what is enforced, so Atlas
 * only recommends this baseline.
 */

export interface CspOrigin {
  origin: string;
  purpose: string;
}

/** Every origin the running app connects to. Wildcards cover tenant- and region-specific hosts. */
export const CSP_CONNECT_ORIGINS: readonly CspOrigin[] = [
  { origin: "https://login.microsoftonline.com", purpose: "Entra ID sign-in and token requests (MSAL)" },
  { origin: "https://api.fabric.microsoft.com", purpose: "Atlas Scout chat through the Data Agent API" },
  { origin: "https://*.pbidedicated.windows.net", purpose: "Rayfin data and functions API (RAYFIN_PUBLIC_API_URL)" },
  { origin: "https://*.userdatafunctions.fabric.microsoft.com", purpose: "Python compatibility collector UDF (RAYFIN_PUBLIC_ATLAS_UDF_URL)" },
];

/** Hidden iframes used by MSAL silent sign-in. */
export const CSP_FRAME_ORIGINS: readonly string[] = ["https://login.microsoftonline.com"];

/** Hosts allowed to embed Atlas (Secure Embed): the Fabric portal and Microsoft Teams. */
export const CSP_FRAME_ANCESTORS: readonly string[] = [
  "https://app.fabric.microsoft.com",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
];

/**
 * Origins that appear in the source but are never fetched by the browser:
 * token audiences, documentation and portal links, and sample data. Listed so
 * a new origin cannot slip in without being classified.
 */
export const CSP_NON_CONNECT_ORIGINS: Readonly<Record<string, string>> = {
  "https://analysis.windows.net": "Token audience (scope prefix), not a request host",
  "https://database.windows.net": "Token audience for SQL metadata, used server-side",
  "https://kusto.kusto.windows.net": "Token audience for KQL metadata, used server-side",
  "https://app.fabric.microsoft.com": "Links that open the Fabric portal in a new tab",
  "https://learn.microsoft.com": "Documentation links",
  "https://github.com": "Repository links",
  "https://raw.githubusercontent.com": "Documentation links",
  "https://azure.microsoft.com": "Documentation links",
  "https://purview.microsoft.com": "Portal links",
  "https://openlineage.io": "Documentation links",
  "https://docs.atlan.com": "Documentation links",
  "https://alpinerent.sharepoint.com": "Preview sample data",
  "https://alpinerent-my.sharepoint.com": "Preview sample data",
  "https://alpinerentlake.dfs.core.windows.net": "Preview sample data",
  "https://api.snowreport.example": "Preview sample data",
  "https://login.salesforce.com": "Preview sample data",
  "https://s3.eu-central-1.amazonaws.com": "Preview sample data",
  "https://docs.microsoft.com": "Library documentation strings in bundled dependencies",
  "https://teams.microsoft.com": "Secure Embed host listed in frame-ancestors, not a request host",
  "https://login.microsoftonline.de": "MSAL sovereign-cloud authority metadata, unused in the public cloud",
  "https://login.microsoftonline.us": "MSAL sovereign-cloud authority metadata, unused in the public cloud",
  "https://login.partner.microsoftonline.cn": "MSAL sovereign-cloud authority metadata, unused in the public cloud",
};

/** Recommended policy: bundled scripts and styles only, metadata calls to Microsoft hosts. */
export function recommendedCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React applies inline style attributes for charts and layout.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${CSP_CONNECT_ORIGINS.map((entry) => entry.origin).join(" ")}`,
    `frame-src ${CSP_FRAME_ORIGINS.join(" ")}`,
    `frame-ancestors 'self' ${CSP_FRAME_ANCESTORS.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://login.microsoftonline.com",
  ].join("; ");
}

/** True when `origin` is allowed by a connect-src entry, including `*.` wildcards. */
export function cspAllowsConnect(origin: string): boolean {
  const host = new URL(origin).host;
  return CSP_CONNECT_ORIGINS.some(({ origin: allowed }) => {
    const pattern = new URL(allowed.replace("*.", "wildcard.")).host;
    return allowed.includes("*.")
      ? host.endsWith(pattern.slice("wildcard".length))
      : host === pattern;
  });
}

export interface HardeningCheck {
  id: string;
  title: string;
  detail: string;
}

/** Steps an administrator applies in Fabric; Atlas cannot verify them. */
export const HARDENING_CHECKLIST: readonly HardeningCheck[] = [
  {
    id: "csp",
    title: "Content Security Policy",
    detail: "Paste the recommended policy in the app settings of the OneLake catalog governance view (Apps).",
  },
  {
    id: "identity",
    title: "Item identity",
    detail: "Run the app under a dedicated service principal or item identity, never a personal account or the entire tenant.",
  },
  {
    id: "embed",
    title: "Secure Embed",
    detail: "Allow embedding only in the Fabric portal and Teams. Sign-in uses a popup or redirect to login.microsoftonline.com.",
  },
  {
    id: "synchronizer",
    title: "Synchronizer authority",
    detail: "Keep RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_SUBJECT set so only the configured administrator can publish snapshots.",
  },
];
