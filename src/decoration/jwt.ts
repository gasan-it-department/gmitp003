import { FastifyRequest, FastifyReply } from "../barrel/fastify";

export const authenticated = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    await request.jwtVerify();
  } catch (error) {
    reply.code(401).send({ error: "Unauthorized", message: "Invalid token" });
  }
};
