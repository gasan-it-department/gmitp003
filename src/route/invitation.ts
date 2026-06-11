import { FastifyInstance } from "../barrel/fastify";
import {
  invitationAuth,
  createInvitationLink,
  invitations,
  deleteInvitationLink,
  suspendInvitationLink,
  submitToInvitationLink,
} from "../controller/invitationController.";
import { authenticated } from "../middleware/handler";

export const invitation = (fastify: FastifyInstance) => {
  fastify.get("/invitation", invitationAuth);
  fastify.post(
    "/create-invitation",
    { preHandler: authenticated },
    createInvitationLink,
  );
  fastify.get("/invite-link", { preHandler: authenticated }, invitations);
  fastify.delete(
    "/delete-link",
    { preHandler: authenticated },
    deleteInvitationLink,
  );
  fastify.patch(
    "/invitation/suspend",
    { preHandler: authenticated },
    suspendInvitationLink,
  );
  // Public submission from an invite link (the invitee isn't authenticated
  // yet) — registers their details against the invitation.
  fastify.post("/invitation/line/submition", submitToInvitationLink);
};
