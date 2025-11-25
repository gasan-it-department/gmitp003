import fastify, {
  FastifySchema,
  FastifyRequest,
  FastifyReply,
  RouteHandlerMethod,
  FastifyInstance,
  FastifyError,
  FastifyPluginAsync,
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
  FastifyError,
  FastifyPluginAsync,
};
export default app;
