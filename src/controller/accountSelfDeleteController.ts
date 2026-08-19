import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { ValidationError, UnauthorizedError } from "../errors/errors";
import argon from "argon2";

/**
 * Self-service account deletion.
 *
 * App Store Review 5.1.1(v) requires an app that has accounts to let the
 * person delete theirs from inside the app. This is that endpoint.
 *
 * What it does NOT do is erase the employee. This is a local-government HR
 * system: attendance, leave, payroll, signed documents and the audit trail
 * behind them are public records the LGU is obliged to keep, and an employee
 * cannot unilaterally destroy them. So:
 *
 *   deleted  — the login account. Credentials are gone, sessions are killed,
 *              push tokens are removed, and the app can no longer be used.
 *   retained — the employment record itself, under the LGU's records
 *              retention obligations.
 *
 * The app states this plainly before asking for confirmation. Apple accepts a
 * deletion that discloses legally-required retention; it does not accept a
 * button that quietly does nothing.
 *
 * The Account row is NEVER deleted, and that is deliberate:
 * `User.account` is declared `onDelete: Cascade`, so dropping the account row
 * takes the employee with it — and everything hanging off the employee:
 * attendance, leave, documents, signatures, the lot. A person tapping "delete
 * my account" must not be able to erase public records. Verified by
 * e2e_self_delete.ts, which failed loudly the first time this was written the
 * obvious way.
 *
 * Instead the account is permanently neutralised: the password is replaced
 * with a hash of a value nobody holds, the username is retired (freeing the
 * original), and the row is marked inactive. There is no way back in, and no
 * path that resurrects it — HR would have to issue a new account.
 */
export const selfDeleteAccount = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = (req.body ?? {}) as { password?: string; confirm?: string };
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) throw new UnauthorizedError("Not signed in");

  // Two deliberate speed bumps: the exact word, and the password. Deleting an
  // account is not something to lose to a mis-tap.
  if ((body.confirm ?? "").trim().toUpperCase() !== "DELETE")
    throw new ValidationError('Type DELETE to confirm.');
  if (!body.password)
    throw new ValidationError("Enter your password to confirm.");

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      username: true,
      password: true,
      User: { select: { id: true } },
    },
  });
  if (!account) throw new UnauthorizedError("Account not found");

  let valid = false;
  try {
    valid = await argon.verify(account.password, body.password);
  } catch {
    valid = false;
  }
  if (!valid) throw new UnauthorizedError("That password is not correct.");

  const userId = account.User?.id ?? null;

  // Stop the phone being reachable regardless of which branch we end up in.
  if (userId) {
    await prisma.pushToken
      .deleteMany({ where: { userId } })
      .catch((e) => console.warn("[selfDelete] push token cleanup failed", e));
  }

  // Retire the credentials in place. See the note above: deleting the row
  // would cascade to the User and take the employment record with it.
  const retired = `deleted_${account.id.slice(0, 8)}_${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await tx.accountResetLink.deleteMany({ where: { accountId } });
    await tx.account.update({
      where: { id: accountId },
      data: {
        // A hash of something nobody holds the input to. Not an empty string:
        // a blank password is the kind of value a later `if (!password)`
        // branch mistakes for "no password required".
        password: await argon.hash(
          `${account.id}:${Date.now()}:${Math.random()}`,
        ),
        username: retired,
        active: false,
        status: 2,
      },
    });
  });

  if (userId) {
    try {
      const { notificationSocket } = await import("..");
      notificationSocket.emitForceLogout(
        userId,
        "Your account has been deleted at your request.",
      );
    } catch (e) {
      console.warn("[selfDelete] force-logout emit failed", e);
    }
  }

  return res.code(200).send({
    message: "OK",
    outcome: "deleted",
    // Said out loud so the app can repeat it rather than inventing wording.
    retained:
      "Employment records the LGU is required to keep are retained; your login has been removed.",
  });
};
