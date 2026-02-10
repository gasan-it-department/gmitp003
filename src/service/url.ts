export const tempURL = () => {
  const dev = process.env.DEV;
  const local = process.env.VITE_LOCAL_FRONTEND_URL;
  const official = process.env.OFFICIAL_DOMAIN;

  if (dev && dev === "1" && official) {
    return official;
  }
  return local;
};
