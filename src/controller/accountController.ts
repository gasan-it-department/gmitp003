import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";
import argon from "argon2";
import { sendEmail } from "../middleware/handler";
import { EncryptionService } from "../service/encryption";

export const accountList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.query as PagingProps;

    const filter: any = {};
    if (params.query) {
      const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace

      if (searchTerms.length === 1) {
        filter.OR = [
          { lastName: { contains: searchTerms[0], mode: "insensitive" } },
          { firstName: { contains: searchTerms[0], mode: "insensitive" } },
          { middleName: { contains: searchTerms[0], mode: "insensitive" } },
          { email: { contains: searchTerms[0], mode: "insensitive" } },
        ];
      } else {
        filter.AND = searchTerms.map((term) => ({
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { middleName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }));

        filter.OR = [
          { AND: filter.AND },
          {
            username: { contains: params.query.trim(), mode: "insensitive" },
          },
        ];
        delete filter.AND; // Remove the AND since we've incorporated it into OR
      }
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const accounts = await prisma.account.findMany({
      where: {
        User: { ...filter },
      },
      cursor,
      take: parseInt(params.limit, 10),
      select: {
        User: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        id: true,
        username: true,
      },
      skip: cursor ? 1 : 0,
    });
    const nextLastCursorId =
      accounts.length > 0 ? accounts[accounts.length - 1].id : null;
    const hasMore = accounts.length === 20;

    res
      .code(200)
      .send({ list: accounts, lastCursor: nextLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const sendResetPasswordLink = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as {
    accountId: string;
    lineId: string;
    userId: string;
  };
  const frontEnd = process.env.VITE_LOCAL_FRONTEND_URL;

  if (!body.accountId || !body.lineId)
    throw new ValidationError("INVALID REQUIRED ID");

  try {
    // Find the account with user details
    const [account, line] = await prisma.$transaction([
      prisma.account.findUnique({
        where: {
          id: body.accountId,
        },
        select: {
          id: true,
          username: true,
          User: {
            select: {
              email: true,
              emailIv: true,
            },
          },
        },
      }),
      prisma.line.findUnique({
        where: {
          id: body.lineId,
        },
        select: {
          id: true,
          province: {
            select: {
              name: true,
            },
          },
          municipal: {
            select: {
              name: true,
            },
          },
          barangay: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    if (!account) throw new NotFoundError("ACCOUNT NOT FOUND!");
    if (!line) throw new ValidationError("INVALID LINE");
    // Decrypt the email
    const decryptedEmail =
      account.User &&
      account.User.email &&
      account.User.emailIv &&
      (await EncryptionService.decrypt(
        account.User.email,
        account.User.emailIv
      ));

    if (!decryptedEmail) throw new ValidationError("FAILED TO SEND RESET LINK");

    // Generate a unique reset token
    const link = await prisma.accountResetLink.create({
      data: {
        accountId: account.id,
      },
    });
    // Create reset link
    const resetLink = `${frontEnd}public/${line.id}/reset-password/${link.id}/${account.id}`;

    // Get user name
    const userName = account.username;

    // Plain text email content
    const emailSubject = "Password Reset Request - Gasan Municipal Portal";

    const emailBody = `
PASSWORD RESET REQUEST

Dear ${userName},

You have requested to reset your password for your Gasan Municipal Portal account.

To reset your password, please click on the following link:
${resetLink}


If you did not request this password reset, please ignore this email. Your account security has not been compromised.

Please note:
- The link can only be used once
- You will be prompted to create a new password
- After resetting, you will need to log in with your new password

For security reasons, never share your password or this reset link with anyone.

If you need assistance, please contact the municipal IT support.

HR Management
Municipality of ${line.municipal.name}
${line.province.name}, Philippines
`;

    // Send the email
    await sendEmail(emailSubject, decryptedEmail, emailBody, "text/plain");

    // Log the action

    return res.code(200).send({
      message: "OK",
    });
  } catch (error) {
    console.error("Error sending reset password link:", error);

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    throw error;
  }
};

export const resetUserPassword = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as {
    accountId: string;
    linkId: string;
    password: string;
  };
  console.log({ body });

  if (!body.accountId || !body.linkId || !body.password)
    throw new ValidationError("INVALID REQUIRED ID");

  try {
    const [link, account] = await prisma.$transaction([
      prisma.accountResetLink.findUnique({
        where: {
          id: body.linkId,
        },
      }),
      prisma.account.findUnique({
        where: {
          id: body.accountId,
        },
      }),
    ]);

    if (!link) throw new NotFoundError("LINK NOT FOUND");
    if (!account) throw new NotFoundError("USER NOT FOUND");

    //if (account.status === 2) throw new ValidationError("USER IN SUSPENSION");

    if (link.status === 0) throw new ValidationError("INVALID LINK");

    const hashed = await argon.hash(body.password);

    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: {
          id: body.accountId,
        },
        data: {
          password: hashed,
        },
      });
      await tx.accountResetLink.update({
        where: {
          id: link.id,
        },
        data: {
          status: 0,
        },
      });
    });

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    throw error;
  }
};
