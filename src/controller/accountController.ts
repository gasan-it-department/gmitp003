import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { NotFoundError, ValidationError } from "../errors/errors";
import { PagingProps } from "../models/route";
import argon from "argon2";
import { sendEmail } from "../middleware/handler";
import { EncryptionService } from "../service/encryption";

export const accountList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.query as PagingProps & { filter?: string };

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

    // Account-level where. Search filters apply to the linked User; the "hrmo"
    // role filter matches either the HR Management Officer position (created at
    // line registration) OR an account username that looks like an HRMO login.
    const where: any = { User: { ...filter } };
    if (params.filter === "hrmo") {
      where.OR = [
        {
          User: {
            is: {
              Position: {
                is: {
                  name: {
                    contains: "Human Resources Management",
                    mode: "insensitive",
                  },
                },
              },
            },
          },
        },
        { username: { contains: "hrmo", mode: "insensitive" } },
      ];
    }

    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const accounts = await prisma.account.findMany({
      where,
      cursor,
      take: parseInt(params.limit, 10) || 20,
      select: {
        User: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            emailIv: true,
          },
        },
        id: true,
        username: true,
        status: true,
        active: true,
      },
      skip: cursor ? 1 : 0,
    });

    // `User.email` is encrypted when `emailIv` is set — decrypt before sending
    // and strip the IV from the payload.
    const list = await Promise.all(
      accounts.map(async (a) => {
        let email = a.User?.email ?? null;
        if (a.User?.email && a.User.emailIv) {
          try {
            email = await EncryptionService.decrypt(
              a.User.email,
              a.User.emailIv,
            );
          } catch {
            email = null;
          }
        }
        return {
          id: a.id,
          username: a.username,
          status: a.status,
          active: a.active,
          User: a.User
            ? {
                id: a.User.id,
                firstName: a.User.firstName,
                lastName: a.User.lastName,
                email,
              }
            : null,
        };
      }),
    );

    const nextLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = accounts.length === (parseInt(params.limit, 10) || 20);

    res.code(200).send({ list, lastCursor: nextLastCursorId, hasMore });
  } catch (error) {
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

// PATCH /account/status { accountId, active }
// Suspend (active=false → status 2) or reactivate (active=true → status 1).
export const adminSetAccountStatus = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { accountId?: string; active?: boolean };
  if (!body.accountId || typeof body.active !== "boolean") {
    throw new ValidationError("INVALID REQUIRED FIELDS");
  }
  try {
    const updated = await prisma.account.update({
      where: { id: body.accountId },
      data: { active: body.active, status: body.active ? 1 : 2 },
      select: { id: true, active: true, User: { select: { id: true } } },
    });

    // When suspending, kick the user out of any live sessions in real time.
    if (!body.active && updated.User?.id) {
      try {
        const { notificationSocket } = await import("..");
        notificationSocket.emitForceLogout(
          updated.User.id,
          "Your account has been suspended by an administrator.",
        );
      } catch (e) {
        console.warn("[adminSetAccountStatus] force-logout emit failed", e);
      }
    }

    return res.code(200).send({ message: "OK", active: body.active });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.code(404).send({ message: "Account not found" });
    }
    console.error("[adminSetAccountStatus]", error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};

// DELETE /account/delete { accountId }
// Full delete: the account is removed and the linked User cascade-deletes
// (User.account onDelete: Cascade). Reset links (Restrict) are cleared first.
export const adminDeleteAccount = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { accountId?: string };
  if (!body.accountId) throw new ValidationError("INVALID REQUIRED FIELDS");
  const accountId = body.accountId;
  try {
    // Capture the linked user before deleting so we can force-logout any live
    // session afterwards (the row is gone by then, but the socket room is just
    // an id string).
    const acct = await prisma.account.findUnique({
      where: { id: accountId },
      select: { User: { select: { id: true } } },
    });

    await prisma.$transaction(async (tx) => {
      await tx.accountResetLink.deleteMany({ where: { accountId } });
      await tx.account.delete({ where: { id: accountId } });
    });

    if (acct?.User?.id) {
      try {
        const { notificationSocket } = await import("..");
        notificationSocket.emitForceLogout(
          acct.User.id,
          "Your account has been removed by an administrator.",
        );
      } catch (e) {
        console.warn("[adminDeleteAccount] force-logout emit failed", e);
      }
    }

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return res.code(404).send({ message: "Account not found" });
      }
      if (error.code === "P2003" || error.code === "P2014") {
        return res.code(409).send({
          message:
            "This account is linked to records that block deletion. Suspend it instead.",
        });
      }
    }
    console.error("[adminDeleteAccount]", error);
    return res.code(500).send({ message: "Internal Server Error" });
  }
};

export const sendResetPasswordLink = async (
  req: FastifyRequest,
  res: FastifyReply,
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
        account.User.emailIv,
      ));

    if (!decryptedEmail) throw new ValidationError("FAILED TO SEND RESET LINK");

    // Generate a unique reset token
    const link = await prisma.accountResetLink.create({
      data: {
        accountId: account.id,
      },
    });
    // Create reset link
    const resetLink = `${frontEnd}/public/${line.id}/reset-password/${link.id}/${account.id}`;

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

/**
 * POST /account/forgot-password  (PUBLIC — used by the logged-out login page).
 *
 * Keyed by `username` (Account.username is stored in plaintext; User.email is
 * encrypted, so it can't be queried directly). Looks up the account, decrypts
 * its registered email, mints a one-time reset link and emails it via Resend.
 *
 * SECURITY: always answers 200 with the same generic message so the endpoint
 * can't be used to enumerate which usernames exist / have email on file.
 */
export const forgotPassword = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as { username?: string };
  const username = (body.username ?? "").trim();
  const generic = {
    message:
      "If that account exists, a password reset link has been sent to its registered email.",
  };

  if (!username) return res.code(200).send(generic);

  try {
    // Mirror the /auth login lookup (exact username match) so the reset
    // targets the same account the user actually signs in with.
    const account = await prisma.account.findFirst({
      where: { username },
      select: {
        id: true,
        username: true,
        lineId: true,
        User: { select: { email: true, emailIv: true } },
        line: {
          select: {
            province: { select: { name: true } },
            municipal: { select: { name: true } },
          },
        },
      },
    });

    // Nothing to do — but still answer generically (no enumeration).
    if (!account || !account.lineId || !account.User?.email) {
      return res.code(200).send(generic);
    }

    let email: string | null = account.User.email;
    if (account.User.emailIv) {
      try {
        email = await EncryptionService.decrypt(
          account.User.email,
          account.User.emailIv,
        );
      } catch {
        email = null;
      }
    }
    if (!email) return res.code(200).send(generic);

    const frontEnd = (process.env.VITE_LOCAL_FRONTEND_URL || "").replace(
      /\/+$/,
      "",
    );
    const link = await prisma.accountResetLink.create({
      data: { accountId: account.id },
    });
    const resetLink = `${frontEnd}/public/${account.lineId}/reset-password/${link.id}/${account.id}`;

    const municipal = account.line?.municipal?.name || "Gasan";
    const province = account.line?.province?.name || "Marinduque";
    const emailSubject = "Password Reset Request - Gasan Municipal Portal";
    const emailBody = `
PASSWORD RESET REQUEST

Dear ${account.username},

You have requested to reset your password for your Gasan Municipal Portal account.

To reset your password, please open the following link:
${resetLink}


If you did not request this password reset, please ignore this email. Your account security has not been compromised.

Please note:
- The link can only be used once
- You will be prompted to create a new password
- After resetting, log in with your new password

For security reasons, never share your password or this reset link with anyone.

HR Management
Municipality of ${municipal}
${province}, Philippines
`;

    await sendEmail(emailSubject, email, emailBody, "Gasan Municipal Portal");

    return res.code(200).send(generic);
  } catch (error) {
    // Log server-side, but never leak the failure to the caller.
    console.error("[forgotPassword]", error);
    return res.code(200).send(generic);
  }
};

export const resetUserPassword = async (
  req: FastifyRequest,
  res: FastifyReply,
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
