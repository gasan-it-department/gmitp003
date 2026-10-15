/**
 * Trigger the blob backfill from the admin panel.
 *
 * Gated by `adminAuthenticated` like the rest of /admin, rather than by a
 * bespoke token: the system already knows how to tell an administrator
 * from a stranger, and inventing a second secret for one operation means
 * one more thing to set, rotate and leak.
 *
 * Reports by default and only moves anything when asked, because the first
 * question about a migration is always how much there is to do.
 */
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { runBlobBackfill } from "../service/blobBackfill";

export const blobBackfill = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { run?: string; limit?: string };
  const lines: string[] = [];
  const report = await runBlobBackfill({
    dryRun: q.run !== "1",
    limit: q.limit ? Math.max(1, parseInt(q.limit, 10) || 1) : undefined,
    log: (l) => {
      lines.push(l);
      console.log("[blob-backfill]", l);
    },
  });
  return res.code(200).send({ ...report, log: lines.slice(-200) });
};
