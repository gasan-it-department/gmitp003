export const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not defined`);
  }
  return value;
};

export const getCurrentUrl = async () => {
  const status = getEnv("DEV");
  const official = getEnv("OFFICIAL_DOMAIN");
  if (!status && !official) {
    return "http://localhost:5173";
  } else if (status === "0") {
    return "http://localhost:5173";
  } else if (official && status === "1") {
    return official;
  } else {
    return "http://localhost:5173";
  }
};
