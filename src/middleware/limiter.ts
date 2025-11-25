import rateLimiter from "@fastify/rate-limit";

export const limiter = {
  max: 100,
  timeWindow: "1 minute",
  ban: 10,
  cache: 10000,
  allowList: ["127.0.0.1"],
};
