import { FastifyInstance } from "../barrel/fastify";
import {
  invitationAuth,
  createInvitationLink,
} from "../controller/invitationController.";
export const invitation = (fastify: FastifyInstance) => {
  fastify.get("/invitation", invitationAuth);
  fastify.post("/create-invitation", createInvitationLink);
};
