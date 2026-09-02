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
exports.purchaseRequestList = exports.purchaseRequestInfo = exports.purchaseRequest = exports.saveItemOrder = exports.fullFillOrder = exports.saveOrder = exports.cancelOrder = exports.updateOrderItem = exports.order = exports.removeOrderItem = exports.addSupplyItem = exports.orderItemList = exports.orders = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const helper_1 = require("../utils/helper");
const orders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, lastCursor, limit } = req.query;
        console.log("check", { id, lastCursor, limit });
        if (!id) {
            throw new errors_1.ValidationError("INVALID REQUIRED ID");
        }
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const response = yield prisma_1.prisma.supplyBatchOrder.findMany({
            where: {
                supplyBatchId: id,
            },
            take: parseInt(limit, 10),
            skip: cursor ? 1 : 0,
            cursor,
            include: {
                _count: {
                    select: {
                        order: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === parseInt(limit, 10);
        return res.code(200).send({
            list: response,
            hasMore,
            lastCursor: newLastCursorId,
        });
    }
    catch (error) {
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.orders = orders;
const orderItemList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { lastCursor, limit, id } = req.query;
        if (!id) {
            throw new errors_1.ValidationError("BAD_REQUEST");
        }
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 20;
        const items = yield prisma_1.prisma.supplyOrder.findMany({
            where: {
                supplyBatchOrderId: id,
            },
            cursor,
            take: take,
            skip: cursor ? 1 : 0,
            include: {
                supply: {
                    select: {
                        item: true,
                    },
                },
                brand: {
                    select: {
                        brand: true,
                    },
                },
                supplieRecieveHistories: {
                    where: {},
                    select: {
                        timestamp: true,
                    },
                },
            },
        });
        const newLastCursorId = items.length > 0 ? items[items.length - 1].id : null;
        const hasMore = items.length === parseInt(limit, 10);
        return res.code(200).send({
            list: items,
            lastCursor: newLastCursorId,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.orderItemList = orderItemList;
const addSupplyItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.body;
        // console.log("Params new ORder: ", params);
        if (!params.quanlity || !params.orderId || !params.supplyId) {
            return res.code(400).send({ message: "BAD REQUEST!" });
        }
        const checked = yield prisma_1.prisma.supplyOrder.findFirst({
            where: {
                supplyBatchOrderId: params.orderId,
                suppliesId: params.supplyId,
            },
        });
        const code = yield (0, handler_1.generateItemRef)();
        const transaction = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            if (checked) {
                const quantity = parseInt(params.quanlity, 10);
                const total = checked.quantity;
                yield tx.supplyOrder.update({
                    where: { id: checked.id },
                    data: {
                        quantity: total + quantity,
                    },
                });
            }
            else {
                yield tx.supplyOrder.create({
                    data: {
                        desc: params.desc,
                        supplyBatchOrderId: params.orderId,
                        quantity: parseInt(params.quanlity, 10),
                        suppliesId: params.supplyId,
                        refNumber: code,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "Success!" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.addSupplyItem = addSupplyItem;
const removeOrderItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.orderId) {
        throw new errors_1.ValidationError("Item ID is Required!");
    }
    try {
        const [order, items] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplyBatchOrder.findUnique({
                where: { id: params.orderId },
            }),
            prisma_1.prisma.supplyOrder.findUnique({
                where: {
                    id: params.id,
                },
            }),
        ]);
        if (!order)
            throw new errors_1.NotFoundError("Order not found!");
        if (!items)
            throw new errors_1.NotFoundError("Selected Item not found!");
        yield prisma_1.prisma.supplyOrder.deleteMany({
            where: { id: params.id },
        });
        return res.code(200).send({ message: "Success" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.removeOrderItem = removeOrderItem;
const order = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError();
    }
    try {
        const order = yield prisma_1.prisma.supplyBatchOrder.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!order) {
            throw new errors_1.NotFoundError();
        }
        return res.code(200).send({ message: "OK", order });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.order = order;
const updateOrderItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("Required ID not found!");
    if (!body.inventoryBoxId || !body.value)
        throw new errors_1.ValidationError("BAD REQUEST!");
    const toUpdate = {};
    if (body.value) {
        toUpdate.quantity = parseInt(body.value, 10);
    }
    try {
        yield prisma_1.prisma.supplyOrder.update({
            where: {
                id: body.id,
            },
            data: {
                quantity: parseInt(body.value, 10),
                desc: body.desc,
            },
        });
        res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updateOrderItem = updateOrderItem;
const cancelOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id || !params.inventoryBoxId || !params.userId) {
        throw new errors_1.ValidationError();
    }
    try {
        const order = yield prisma_1.prisma.supplyBatchOrder.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!order)
            throw new errors_1.NotFoundError();
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplyBatchOrder.delete({
                where: {
                    id: params.id,
                },
            }),
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    userId: params.userId,
                    action: `Deleted ORDER Ref No.: ${order.refNumber}`,
                    inventoryBoxId: params.inventoryBoxId,
                    timestamp: new Date(),
                },
            }),
        ]);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.cancelOrder = cancelOrder;
const saveOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("Order is missing");
    if (!body.status)
        return new errors_1.ValidationError("Status to update not found!");
    try {
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const items = yield tx.supplyOrder.findMany({
                where: {
                    supplyBatchOrderId: body.id,
                },
            });
            if (items.length === 0)
                throw new errors_1.ValidationError("FOUND 0 ITEMS");
            const order = yield tx.supplyBatchOrder.update({
                where: {
                    id: body.id,
                },
                data: {
                    status: 1,
                },
            });
            yield tx.inventoryAccessLogs.create({
                data: {
                    inventoryBoxId: body.inventoryBoxId,
                    userId: body.userId,
                    timestamp: new Date(),
                    action: `Save Order: ${order.title} - Ref. Number: ${order.refNumber}`,
                },
            });
            yield tx.supplyOrder.updateMany({
                where: {
                    supplyBatchOrderId: order.id,
                },
                data: {
                    status: "Pending",
                },
            });
        }));
        res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.saveOrder = saveOrder;
const fullFillOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log(body);
    if (!body.orderId || !body.userId || !body.inventoryBoxId) {
        throw new errors_1.ValidationError("BAD REQUEST!");
    }
    try {
        const [items, order] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplyOrder.findMany({
                where: {
                    supplyBatchOrderId: body.orderId,
                },
                select: {
                    quantity: true,
                    perQuantity: true,
                    id: true,
                    status: true,
                    price: true,
                    suppliesId: true,
                    receivedQuantity: true,
                    quality: true,
                    desc: true,
                    condition: true,
                },
            }),
            prisma_1.prisma.supplyBatchOrder.findUnique({
                where: {
                    id: body.orderId,
                },
            }),
        ]);
        if (!order)
            throw new errors_1.NotFoundError("Order not found!");
        if (items.length === 0)
            throw new errors_1.NotFoundError("No items found!");
        // IMPORTANT: Stock writes happen in saveItemOrder (per-item, supplier-
        // aware). Do NOT add stock here or it gets recorded twice. This handler
        // is now strictly the "close out the batch" pass: flip order/item
        // statuses, log the access, and append the recieve history.
        const operations = [];
        items.forEach((item) => {
            const status = item.status !== "OK" ? item.status : "OK";
            operations.push(prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    userId: body.userId,
                    inventoryBoxId: body.inventoryBoxId,
                    action: `Fullfilled Order: ${order.title} Ref No.: ${order.refNumber}`,
                },
            }), prisma_1.prisma.supplyOrder.update({
                where: {
                    id: item.id,
                },
                data: {
                    status: status,
                },
            }), prisma_1.prisma.supplyBatchOrder.update({
                where: {
                    id: body.orderId,
                },
                data: {
                    status: 2,
                },
            }), prisma_1.prisma.supplieRecieveHistory.create({
                data: {
                    suppliesId: item.suppliesId,
                    quality: item.quality,
                    quantity: item.quantity,
                    perQuantity: item.perQuantity,
                    pricePerItem: item.price || 0.0,
                    condition: item.condition,
                    supplyBatchId: order.supplyBatchId,
                },
            }));
        });
        // Execute all operations in a transaction
        yield prisma_1.prisma.$transaction(operations);
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.fullFillOrder = fullFillOrder;
const saveItemOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id ||
        !body.quantity ||
        !body.condition ||
        body.resolve === undefined ||
        !body.inventoryBoxId ||
        !body.listId) {
        throw new errors_1.ValidationError("BAD REQUEST!");
    }
    try {
        // const [item, stock, supplier] = await prisma.$transaction([
        //   prisma.supplyOrder.findFirst({
        //     where: { suppliesId: body.id },
        //   }),
        //   prisma.supplyStockTrack.findFirst({
        //     where: { suppliesId: body.id },
        //   }),
        //   prisma.supplier.findFirst({
        //     where: { id: body.supplier },
        //   }),
        // ]);
        // if (!item) throw new NotFoundError("Item not found!");
        const currentDate = new Date();
        const optional = {};
        // Subtract 3 months
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(currentDate.getMonth() - 7);
        const brands = body.brand ? body.brand.split(",") : [];
        console.log({ brands });
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c;
            const item = yield tx.supplyOrder.findUnique({
                where: { id: body.orderItemId },
            });
            if (!item)
                throw new errors_1.NotFoundError("Item not found!");
            // Resolve supplier — frontend can send either the supplier's id
            // (when the user picked one from the search list) or a free-text
            // name (when they typed but didn't pick). Try id first, then name,
            // then create if it's a brand-new name.
            let supplier;
            if (body.supplier && body.supplier.trim()) {
                const raw = body.supplier.trim();
                const byId = yield tx.supplier.findUnique({ where: { id: raw } });
                if (byId) {
                    supplier = byId.id;
                }
                else {
                    const byName = yield tx.supplier.findFirst({
                        where: {
                            name: { equals: raw, mode: "insensitive" },
                            lineId: body.lineId,
                        },
                    });
                    if (byName) {
                        supplier = byName.id;
                    }
                    else if (body.lineId) {
                        const created = yield tx.supplier.create({
                            data: { name: raw, lineId: body.lineId },
                        });
                        supplier = created.id;
                    }
                }
            }
            if (body.expirationDate) {
                optional.expiration = new Date(body.expirationDate).toISOString();
            }
            if (supplier) {
                optional.supplierId = supplier;
            }
            const quantity = parseInt(body.quantity, 10);
            const orderOptionalData = {};
            if (brands.length > 0) {
                orderOptionalData.brand = {
                    createMany: {
                        data: brands.map((brand) => {
                            return {
                                suppliesId: item.suppliesId,
                                brand: brand,
                            };
                        }),
                    },
                };
            }
            const updatedOrder = yield tx.supplyOrder.update({
                where: { id: item.id },
                data: Object.assign(Object.assign({ price: body.price ? parseFloat(body.price) : 0, status: helper_1.supplyOrderStatus[body.resolve], comments: body.comments, remark: body.resolve, condition: body.condition, receivedQuantity: quantity, perQuantity: body.perQuantity, quality: body.quality }, (supplier ? { supplierId: supplier } : {})), orderOptionalData),
            });
            // Only register stock when the resolution actually adds stock
            // (status code maps to received/accepted). For now we mirror the
            // SupplyOrder update — any fulfillment increments stock.
            const priceValue = body.price ? parseFloat(body.price) : 0;
            const perQuantity = body.perQuantity || 1;
            const addedStock = quantity * perQuantity;
            // ── EDIT-SAFETY: reverse the previous contribution of this order
            // item before applying the new one. Without this, re-saving the
            // same line stacks stock on top of itself (e.g. 100 → 200 → 300
            // for the same Save click). We use the pre-update snapshot of the
            // order item (already in `item`) to figure out what it contributed
            // last time and which stock row it landed on.
            const prevQty = item.receivedQuantity || 0;
            const prevPerQ = item.perQuantity || 1;
            const prevAdded = prevQty * prevPerQ;
            if (prevAdded > 0) {
                const prior = yield tx.supplyStockTrack.findFirst({
                    where: {
                        suppliesId: body.id,
                        supplyBatchId: body.listId,
                        inventoryBoxId: body.inventoryBoxId,
                        supplierId: (_a = item.supplierId) !== null && _a !== void 0 ? _a : null,
                        quality: (_b = item.quality) !== null && _b !== void 0 ? _b : null,
                        perQuantity: prevPerQ,
                    },
                });
                if (prior) {
                    yield tx.supplyStockTrack.update({
                        where: { id: prior.id },
                        data: {
                            stock: Math.max(0, prior.stock - prevAdded),
                            quantity: Math.max(0, prior.quantity - prevQty),
                        },
                    });
                }
            }
            // Stock is segmented per (item, batch, container, supplier, unit,
            // perQuantity). Two batches with the same unit but different suppliers
            // MUST stay separate rows — never collapse them. Same supplier with
            // different unit (piece vs box) also stays separate. A null supplier
            // only merges into another null-supplier row.
            const stock = yield tx.supplyStockTrack.findFirst({
                where: {
                    suppliesId: body.id,
                    supplyBatchId: body.listId,
                    inventoryBoxId: body.inventoryBoxId,
                    supplierId: supplier !== null && supplier !== void 0 ? supplier : null,
                    quality: (_c = body.quality) !== null && _c !== void 0 ? _c : null,
                    perQuantity: perQuantity,
                },
            });
            const brandCreates = brands
                .map((b) => b.trim())
                .filter((b) => b.length > 0)
                .map((brand) => ({ brand, suppliesId: body.id }));
            if (stock) {
                yield tx.supplyStockTrack.update({
                    where: { id: stock.id },
                    data: Object.assign(Object.assign(Object.assign(Object.assign({ stock: stock.stock + addedStock, quantity: stock.quantity + quantity }, (body.quality ? { quality: body.quality } : {})), optional), (brandCreates.length > 0
                        ? { brand: { createMany: { data: brandCreates } } }
                        : {})), { price: {
                            create: {
                                value: priceValue,
                                suppliesId: body.id,
                                timestamp: threeMonthsAgo.toISOString(),
                            },
                        } }),
                });
            }
            else {
                yield tx.supplyStockTrack.create({
                    data: Object.assign(Object.assign(Object.assign({ suppliesId: body.id, stock: addedStock, quantity: quantity, quality: body.quality, perQuantity: perQuantity, inventoryBoxId: body.inventoryBoxId, supplyBatchId: body.listId }, optional), { price: {
                            create: {
                                value: priceValue,
                                suppliesId: body.id,
                                timestamp: threeMonthsAgo.toISOString(),
                            },
                        } }), (brandCreates.length > 0
                        ? { brand: { createMany: { data: brandCreates } } }
                        : {})),
                });
            }
        }));
        // Return information about whether stock was created or updated
        return res.code(200).send({
            message: "OK",
        });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("Database operation failed", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.saveItemOrder = saveItemOrder;
const purchaseRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log("Params: ", params);
    if (!params.id) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        const filter = {};
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/); // Split on any whitespace
            if (searchTerms.length === 1) {
                filter.OR = [
                    { title: { contains: searchTerms[0], mode: "insensitive" } },
                    { refNumber: { contains: searchTerms[0], mode: "insensitive" } },
                    {
                        user: {
                            firsName: { contains: searchTerms[0], mode: "insensitive" },
                            lastName: { contains: searchTerms[0], mode: "insensitive" },
                        },
                    },
                ];
            }
            else {
                filter.AND = searchTerms.map((term) => ({
                    OR: [
                        { title: { contains: term, mode: "insensitive" } },
                        { refNumber: { contains: term, mode: "insensitive" } },
                        {
                            user: {
                                firsName: { contains: term, mode: "insensitive" },
                                lastName: { contains: term, mode: "insensitive" },
                            },
                        },
                    ],
                }));
                filter.OR = [
                    { AND: filter.AND },
                    {
                        user: {
                            middleName: {
                                contains: params.query.trim(),
                                mode: "insensitive",
                            },
                        },
                    },
                ];
                delete filter.AND;
            }
        }
        console.log(JSON.stringify(filter, null, 2));
        const response = yield prisma_1.prisma.supplyBatchOrder.findMany({
            where: Object.assign({ status: 1, lineId: params.id }, filter),
            include: {
                user: {
                    select: {
                        username: true,
                        id: true,
                        department: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.purchaseRequest = purchaseRequest;
const purchaseRequestInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const response = yield prisma_1.prisma.supplyBatchOrder.findUnique({
            where: {
                id: params.id,
            },
        });
        if (!response) {
            throw new errors_1.NotFoundError("Purchase Request Data not found!");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.purchaseRequestInfo = purchaseRequestInfo;
const purchaseRequestList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const response = yield prisma_1.prisma.supplyOrder.findMany({
            where: {
                supplyBatchOrderId: params.id,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            include: {
                supply: {
                    select: {
                        item: true,
                        id: true,
                        refNumber: true,
                    },
                },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === limit;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.purchaseRequestList = purchaseRequestList;
