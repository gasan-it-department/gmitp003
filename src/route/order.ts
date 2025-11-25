import { FastifyInstance } from "../barrel/fastify";
import { authenticated } from "../middleware/handler";
import { newOrder } from "../controller/supplyController";
import {
  orders,
  orderItemList,
  addSupplyItem,
  removeOrderItem,
  order as orderData,
  updateOrderItem,
  cancelOrder,
  saveOrder,
  fullFillOrder,
  saveItemOrder,
  purchaseRequest,
  purchaseRequestInfo,
  purchaseRequestList,
} from "../controller/orderController";
import { deleteOrderItemSchema } from "../models/request";

export const order = async (fastify: FastifyInstance) => {
  fastify.post("/new-order", { preHandler: authenticated }, newOrder);
  fastify.get("/orders", { preHandler: authenticated }, orders);
  fastify.get(
    "/supply-order-items",
    { preHandler: authenticated },
    orderItemList
  );
  fastify.post("/add-item-order", { preHandler: authenticated }, addSupplyItem);
  fastify.delete(
    "/delete-order-item",
    { preHandler: authenticated, schema: deleteOrderItemSchema },
    removeOrderItem
  );
  fastify.get("/order", { preHandler: authenticated }, orderData);
  fastify.patch(
    "/update-order-item",
    { preHandler: authenticated },
    updateOrderItem
  );
  fastify.delete("/delete-order", { preHandler: authenticated }, cancelOrder);
  fastify.patch("/save-order", { preHandler: authenticated }, saveOrder);
  fastify.post("/finalize-order", { preHandler: authenticated }, fullFillOrder);
  fastify.post(
    "/fullfill-item-order",
    { preHandler: authenticated },
    saveItemOrder
  );
  fastify.get(
    "/purchase-request",
    { preHandler: authenticated },
    purchaseRequest
  );
  fastify.get(
    "/purchase-request-info",
    { preHandler: authenticated },
    purchaseRequestInfo
  );
  fastify.get(
    "/purchase-request-list",
    { preHandler: authenticated },
    purchaseRequestList
  );

  // fastify.get("/item-availability", {preHandler:authenticated }, )
};
