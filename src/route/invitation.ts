import { FastifyInstance } from "../barrel/fastify";
import {
  invitationAuth,
  createInvitationLink,
  invitations,
  deleteInvitationLink,
} from "../controller/invitationController.";
import { authenticated } from "../middleware/handler";
export const invitation = (fastify: FastifyInstance) => {
  fastify.get("/invitation", invitationAuth);
  fastify.post("/create-invitation", createInvitationLink);
  fastify.get("/invite-link", { preHandler: authenticated }, invitations);
  fastify.delete(
    "/delete-link",
    { preHandler: authenticated },
    deleteInvitationLink
  );
};
