import { FastifyInstance } from "../barrel/fastify";

import {
  createList,
  listData,
  list as listOflist,
  addListAccess,
  listAccessUsers,
  deleteList,
  removeList,
} from "../controller/listController";
import { authenticated } from "../middleware/handler";

import {
  listDataSchema,
  listSchema,
  addAccessToListSchema,
  deleteListSchema,
} from "../models/request";
export const list = (fastify: FastifyInstance) => {
  fastify.post(
    "/create-list",
    { preHandler: authenticated, schema: listSchema },
    createList
  );
  fastify.get("/list", listOflist);
  fastify.get(
    "/list-data",
    { preHandler: authenticated, schema: listDataSchema },
    listData
  );
  fastify.post(
    "/add-list-access",
    { preHandler: authenticated, schema: addAccessToListSchema },
    addListAccess
  );
  fastify.get(
    "/access-list",
    { preHandler: authenticated, schema: listSchema },
    listAccessUsers
  );
  fastify.delete(
    "/delete-list",
    { schema: deleteListSchema, preHandler: authenticated },
    deleteList
  );
  fastify.delete("/list/remove", { preHandler: authenticated }, removeList);
};
