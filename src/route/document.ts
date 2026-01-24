import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";

import {
  addDocument,
  signatories,
  roomRegister,
  signatoryRegistry,
} from "../controller/documentController";

export const document = (fastify: FastifyInstance) => {
  fastify.post("/document/create", { preHandler: authenticated }, addDocument);
  fastify.get(
    "/document/signatories",
    { preHandler: authenticated },
    signatories,
  );
  fastify.post("/document/room/register", roomRegister);
  fastify.get(
    "/document/signatory-registry",
    { preHandler: authenticated },
    signatoryRegistry,
  );
};
