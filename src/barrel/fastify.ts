import fastify, {
  FastifySchema,
  FastifyRequest,
  FastifyReply,
  RouteHandlerMethod,
  FastifyInstance,
} from "fastify";
import jwt from "@fastify/jwt";
const app = fastify();
export {
  FastifySchema,
  FastifyRequest,
  FastifyReply,
  RouteHandlerMethod,
  FastifyInstance,
  jwt,
};
export default app;
