"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.order = void 0;
const handler_1 = require("../middleware/handler");
const supplyController_1 = require("../controller/supplyController");
const orderController_1 = require("../controller/orderController");
const request_1 = require("../models/request");
const order = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/new-order", { preHandler: handler_1.authenticated }, supplyController_1.newOrder);
    fastify.get("/orders", { preHandler: handler_1.authenticated }, orderController_1.orders);
    fastify.get("/supply-order-items", { preHandler: handler_1.authenticated }, orderController_1.orderItemList);
    fastify.post("/add-item-order", { preHandler: handler_1.authenticated }, orderController_1.addSupplyItem);
    fastify.delete("/delete-order-item", { preHandler: handler_1.authenticated, schema: request_1.deleteOrderItemSchema }, orderController_1.removeOrderItem);
    fastify.get("/order", { preHandler: handler_1.authenticated }, orderController_1.order);
    fastify.patch("/update-order-item", { preHandler: handler_1.authenticated }, orderController_1.updateOrderItem);
    fastify.delete("/delete-order", { preHandler: handler_1.authenticated }, orderController_1.cancelOrder);
    fastify.patch("/save-order", { preHandler: handler_1.authenticated }, orderController_1.saveOrder);
    fastify.patch("/finalize-order", { preHandler: handler_1.authenticated }, orderController_1.fullFillOrder);
    fastify.post("/fullfill-item-order", { preHandler: handler_1.authenticated }, orderController_1.saveItemOrder);
    fastify.get("/purchase-request", { preHandler: handler_1.authenticated }, orderController_1.purchaseRequest);
    fastify.get("/purchase-request-info", { preHandler: handler_1.authenticated }, orderController_1.purchaseRequestInfo);
    fastify.get("/purchase-request-list", { preHandler: handler_1.authenticated }, orderController_1.purchaseRequestList);
    // fastify.get("/item-availability", {preHandler:authenticated }, )
});
exports.order = order;
