const configuredSyncWriter =
  process.env.RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_EMAIL ??
  process.env.VITE_RAYFIN_ATLAS_SYNC_ADMIN_EMAIL ??
  "";

export const SYNC_WRITER_EMAIL = configuredSyncWriter.trim().toLowerCase();

if (!SYNC_WRITER_EMAIL) {
  throw new Error(
    "RAYFIN_PUBLIC_ATLAS_SYNC_ADMIN_EMAIL is required to compile Atlas snapshot policies.",
  );
}
