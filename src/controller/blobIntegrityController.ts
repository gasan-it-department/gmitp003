/**
 * Check, from the admin panel, that every file the database points at is
 * still in the bucket and still matches the digest recorded for it.
 *
 * The bucket is now the only copy of these files, so this is the check
 * that would notice a document quietly going missing. Read-only: it never
 * writes, uploads or deletes.
 */
import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { runBlobIntegrityCheck } from "../service/blobIntegrity";

export const blobIntegrity = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const q = req.query as { count?: string; limit?: string };
  const lines: string[] = [];
  const report = await runBlobIntegrityCheck({
    countOnly: q.count === "1",
    limit: q.limit ? Math.max(1, parseInt(q.limit, 10) || 1) : undefined,
    log: (l) => {
      lines.push(l);
      console.log("[blob-integrity]", l);
    },
  });
  return res.code(200).send({ ...report, log: lines.slice(-200) });
};
