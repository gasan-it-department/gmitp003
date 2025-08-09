import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, InvitationLink } from "../barrel/prisma";

export const createInvitationLink = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as InvitationLink;
    if (!body || !body.code) {
      return res.code(400).send({ message: "Invalid request" });
    }
    const newInviteLink = await prisma.invitationLink.create({
      data: {
        code: body.code,
        expiresAt: new Date(Date.now() + 0 * 0 * 60 * 60 * 1000),
        url: "none",
        used: false,
        lineId: body.lineId,
      },
    });
    const inviteLink = await prisma.invitationLink.update({
      where: { id: newInviteLink.id },
      data: {
        url: `/invitation/${newInviteLink.id}`,
      },
    });

    return res.code(201).send({
      message: "Invitation link created successfully",
      data: {
        inviteLink,
      },
      error: 0,
    });
  } catch (error) {
    console.log(error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};
export const invitationAuth = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.query as { id: string };
    console.log({ body });

    if (body.id === undefined || body.id === null) {
      return res
        .code(400)
        .send({ message: "Invalid request: Link must be deleted" });
    }
    const invitations = await prisma.invitationLink.findUnique({
      where: {
        id: body.id,
      },
    });
    const currentDate = new Date();
    if (invitations?.expiresAt && invitations.expiresAt < currentDate) {
      return res
        .code(400)
        .send({ message: "Invitation link has expired", error: 1 });
    } else {
      return res.code(200).send({
        message: "Invitation link is valid",
        data: {
          ...invitations,
        },
      });
    }
  } catch (error) {
    console.log(error);
  }
};
