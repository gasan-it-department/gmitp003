import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import {
  provisionalDesignations,
  provisionalPersonnel,
} from "../controller/provisionalController";

// Provisional (temporary/contract) staff. Designations reuse non-plantilla
// UnitPositions; hiring reuses /position/invitation/from-application (which now
// carries empType + term) and the existing /position/register flow.
export const provisional = (fastify: FastifyInstance) => {
  fastify.get(
    "/provisional/designations",
    { preHandler: authenticated },
    provisionalDesignations,
  );
  fastify.get(
    "/provisional/personnel",
    { preHandler: authenticated },
    provisionalPersonnel,
  );
};
