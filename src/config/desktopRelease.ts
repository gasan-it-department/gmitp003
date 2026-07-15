/**
 * Latest published Gasan Pharmacy DESKTOP release.
 *
 * ── How to ship a desktop update ──────────────────────────────────────────
 * 1. In gmitp003-pharmacy-desktop: bump `AppUpdate.CurrentVersion`, then run
 *    installer\make_release.ps1  → produces Gasan_Pharmacy_App.zip.
 * 2. Upload that zip anywhere public (Cloudinary raw upload, Drive direct
 *    link, GitHub release asset…) and paste its URL below.
 * 3. Bump `version` here to match the app, describe the changes in `notes`,
 *    commit + push this repo → Railway redeploys.
 *
 * Every desktop checks this on launch (when online). If `version` is newer
 * than the app, the user is offered a one-click "Download & install" that
 * runs the zip's installer (data is kept — it lives outside the app folder).
 *
 * An empty `url` disables the offer even if the version is newer.
 */
export const DESKTOP_RELEASE = {
  version: "1.1.0",
  url: "",
  notes: "",
};
