import { FastifyInstance } from "../barrel/fastify";
import { createGroup, groupList } from "../controller/groupController";
import { groupListSchema } from "../models/request";
import { authenticated } from "../middleware/handler";
export const unit = async (fasitfy: FastifyInstance) => {
  fasitfy.post("/add-unit", { preHandler: authenticated }, createGroup);
  fasitfy.get(
    "/group",
    { preHandler: authenticated, schema: groupListSchema },
    groupList
  );
};
