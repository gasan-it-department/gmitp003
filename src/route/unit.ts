import { FastifyInstance } from "../barrel/fastify";
import {
  createGroup,
  groupList,
  unitInfo,
} from "../controller/groupController";
import { groupListSchema } from "../models/request";
import { authenticated } from "../middleware/handler";
import { searchUnit } from "../controller/unitController";
export const unit = async (fasitfy: FastifyInstance) => {
  fasitfy.post("/add-unit", { preHandler: authenticated }, createGroup);
  fasitfy.get(
    "/line-units",
    { preHandler: authenticated, schema: groupListSchema },
    groupList
  );
  fasitfy.get("/unit-info", { preHandler: authenticated }, unitInfo);
  fasitfy.get("/unit/search", { preHandler: authenticated }, searchUnit);
};
