export const tempURL = () => {
  const dev = process.env.DEV;
  const local = process.env.VITE_LOCAL_FRONTEND_URL;
  const official = process.env.OFFICIAL_DOMAIN;

  if (dev && dev === "1" && official) {
    return official;
  }
  // Fall back to OFFICIAL_DOMAIN when the local frontend URL isn't configured
  // (e.g. on Railway), so callers like createLine don't 400 with
  // "INVALID CLIENT URL" just because one env var is unset.
  return local || official;
};
