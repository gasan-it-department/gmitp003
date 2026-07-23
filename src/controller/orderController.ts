import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError, dbError } from "../errors/errors";
import { generateItemRef } from "../middleware/handler";
import {
  DeleteOrderItemProps,
  DeleteOrderProps,
  FullfilledItemOrderProps,
  FullFillOrderProps,
  PagingProps,
  UpdateOrderItem,
} from "../models/route";
import { quality } from "../route/quality";
import { supplyOrderStatus } from "../utils/helper";

export const orders = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { id, lastCursor, limit } = req.query as PagingProps;
    console.log("check", { id, lastCursor, limit });

    if (!id) {
      throw new ValidationError("INVALID REQUIRED ID");
    }
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const response = await prisma.supplyBatchOrder.findMany({
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

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === parseInt(limit, 10);

    return res.code(200).send({
      list: response,
      hasMore,
      lastCursor: newLastCursorId,
    });
  } catch (error) {
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const orderItemList = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { lastCursor, limit, id } = req.query as PagingProps;
    if (!id) {
      throw new ValidationError("BAD_REQUEST");
    }
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const take = limit ? parseInt(limit, 10) : 20;
    const items = await prisma.supplyOrder.findMany({
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

    const newLastCursorId =
      items.length > 0 ? items[items.length - 1].id : null;
    const hasMore = items.length === parseInt(limit, 10);

    return res.code(200).send({
      list: items,
      lastCursor: newLastCursorId,
      hasMore,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const addSupplyItem = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const params = req.body as {
      quanlity: string;
      desc: string;
      orderId: string;
      supplyId: string;
    };
    // console.log("Params new ORder: ", params);

    if (!params.quanlity || !params.orderId || !params.supplyId) {
      return res.code(400).send({ message: "BAD REQUEST!" });
    }
    const checked = await prisma.supplyOrder.findFirst({
      where: {
        supplyBatchOrderId: params.orderId,
        suppliesId: params.supplyId,
      },
    });

    const code = await generateItemRef();
    const transaction = await prisma.$transaction(async (tx) => {
      if (checked) {
        const quantity = parseInt(params.quanlity, 10);
        const total = checked.quantity;
        await tx.supplyOrder.update({
          where: { id: checked.id },
          data: {
            quantity: total + quantity,
          },
        });
      } else {
        await tx.supplyOrder.create({
          data: {
            desc: params.desc,
            supplyBatchOrderId: params.orderId,
            quantity: parseInt(params.quanlity, 10),
            suppliesId: params.supplyId,
            refNumber: code,
          },
        });
      }
    });

    return res.code(200).send({ message: "Success!" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const removeOrderItem = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as DeleteOrderItemProps;

  if (!params.id || !params.orderId) {
    throw new ValidationError("Item ID is Required!");
  }

  try {
    const [order, items] = await prisma.$transaction([
      prisma.supplyBatchOrder.findUnique({
        where: { id: params.orderId },
      }),
      prisma.supplyOrder.findUnique({
        where: {
          id: params.id,
        },
      }),
    ]);

    if (!order) throw new NotFoundError("Order not found!");
    if (!items) throw new NotFoundError("Selected Item not found!");

    await prisma.supplyOrder.deleteMany({
      where: { id: params.id },
    });

    return res.code(200).send({ message: "Success" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const order = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as { id: string };

  if (!params.id) {
    throw new ValidationError();
  }
  try {
    const order = await prisma.supplyBatchOrder.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!order) {
      throw new NotFoundError();
    }

    return res.code(200).send({ message: "OK", order });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const updateOrderItem = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const body = req.body as UpdateOrderItem;

  if (!body.id) throw new ValidationError("Required ID not found!");
  if (!body.inventoryBoxId || !body.value)
    throw new ValidationError("BAD REQUEST!");

  const toUpdate: any = {};
  if (body.value) {
    toUpdate.quantity = parseInt(body.value, 10);
  }

  try {
    await prisma.supplyOrder.update({
      where: {
        id: body.id,
      },
      data: {
        quantity: parseInt(body.value, 10),
        desc: body.desc,
      },
    });

    res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const cancelOrder = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as DeleteOrderProps;

  if (!params.id || !params.inventoryBoxId || !params.userId) {
    throw new ValidationError();
  }
  try {
    const order = await prisma.supplyBatchOrder.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!order) throw new NotFoundError();
    await prisma.$transaction([
      prisma.supplyBatchOrder.delete({
        where: {
          id: params.id,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          userId: params.userId,
          action: `Deleted ORDER Ref No.: ${order.refNumber}`,
          inventoryBoxId: params.inventoryBoxId,
          timestamp: new Date(),
        },
      }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const saveOrder = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as {
    id: string;
    status: number;
    inventoryBoxId: string;
    userId: string;
  };

  if (!body.id) throw new ValidationError("Order is missing");
  if (!body.status) return new ValidationError("Status to update not found!");
  try {
    await prisma.$transaction(async (tx) => {
      const items = await tx.supplyOrder.findMany({
        where: {
          supplyBatchOrderId: body.id,
        },
      });

      if (items.length === 0) throw new ValidationError("FOUND 0 ITEMS");
      const order = await tx.supplyBatchOrder.update({
        where: {
          id: body.id,
        },
        data: {
          status: 1,
        },
      });

      await tx.inventoryAccessLogs.create({
        data: {
          inventoryBoxId: body.inventoryBoxId,
          userId: body.userId,
          timestamp: new Date(),
          action: `Save Order: ${order.title} - Ref. Number: ${order.refNumber}`,
        },
      });
      await tx.supplyOrder.updateMany({
        where: {
          supplyBatchOrderId: order.id,
        },
        data: {
          status: "Pending",
        },
      });
    });
    res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const fullFillOrder = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as FullFillOrderProps;
  console.log(body);

  if (!body.orderId || !body.userId || !body.inventoryBoxId) {
    throw new ValidationError("BAD REQUEST!");
  }

  try {
    const [items, order] = await prisma.$transaction([
      prisma.supplyOrder.findMany({
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
      prisma.supplyBatchOrder.findUnique({
        where: {
          id: body.orderId,
        },
      }),
    ]);

    if (!order) throw new NotFoundError("Order not found!");
    if (items.length === 0) throw new NotFoundError("No items found!");

    // IMPORTANT: Stock writes happen in saveItemOrder (per-item, supplier-
    // aware). Do NOT add stock here or it gets recorded twice. This handler
    // is now strictly the "close out the batch" pass: flip order/item
    // statuses, log the access, and append the recieve history.
    const operations: Prisma.PrismaPromise<any>[] = [];

    items.forEach((item) => {
      const status = item.status !== "OK" ? item.status : "OK";
      operations.push(
        prisma.inventoryAccessLogs.create({
          data: {
            userId: body.userId,
            inventoryBoxId: body.inventoryBoxId,
            action: `Fullfilled Order: ${order.title} Ref No.: ${order.refNumber}`,
          },
        }),
        prisma.supplyOrder.update({
          where: {
            id: item.id,
          },
          data: {
            status: status,
          },
        }),
        prisma.supplyBatchOrder.update({
          where: {
            id: body.orderId,
          },
          data: {
            status: 2,
          },
        }),
        prisma.supplieRecieveHistory.create({
          data: {
            suppliesId: item.suppliesId,
            quality: item.quality,
            quantity: item.quantity,
            perQuantity: item.perQuantity,
            pricePerItem: item.price || 0.0,
            condition: item.condition,
            supplyBatchId: order.supplyBatchId,
          },
        }),
      );
    });

    // Execute all operations in a transaction
    await prisma.$transaction(operations);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const saveItemOrder = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as FullfilledItemOrderProps;

  if (
    !body.id ||
    !body.quantity ||
    !body.condition ||
    body.resolve === undefined ||
    !body.inventoryBoxId ||
    !body.listId
  ) {
    throw new ValidationError("BAD REQUEST!");
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
    const optional: any = {};
    // Subtract 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(currentDate.getMonth() - 7);
    const brands = body.brand ? body.brand.split(",") : [];
    console.log({ brands });

    await prisma.$transaction(async (tx) => {
      const item = await tx.supplyOrder.findUnique({
        where: { id: body.orderItemId },
      });

      if (!item) throw new NotFoundError("Item not found!");

      // Resolve supplier — frontend can send either the supplier's id
      // (when the user picked one from the search list) or a free-text
      // name (when they typed but didn't pick). Try id first, then name,
      // then create if it's a brand-new name.
      let supplier: string | undefined;
      if (body.supplier && body.supplier.trim()) {
        const raw = body.supplier.trim();
        const byId = await tx.supplier.findUnique({ where: { id: raw } });
        if (byId) {
          supplier = byId.id;
        } else {
          const byName = await tx.supplier.findFirst({
            where: {
              name: { equals: raw, mode: "insensitive" },
              lineId: body.lineId,
            },
          });
          if (byName) {
            supplier = byName.id;
          } else if (body.lineId) {
            const created = await tx.supplier.create({
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

      const orderOptionalData: any = {};
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

      const updatedOrder = await tx.supplyOrder.update({
        where: { id: item.id },
        data: {
          price: body.price ? parseFloat(body.price) : 0,
          status: supplyOrderStatus[body.resolve],
          comments: body.comments,
          remark: body.resolve,
          condition: body.condition,
          receivedQuantity: quantity,
          perQuantity: body.perQuantity,
          quality: body.quality,
          ...(supplier ? { supplierId: supplier } : {}),
          ...orderOptionalData,
        },
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
        const prior = await tx.supplyStockTrack.findFirst({
          where: {
            suppliesId: body.id,
            supplyBatchId: body.listId,
            inventoryBoxId: body.inventoryBoxId,
            supplierId: item.supplierId ?? null,
            quality: item.quality ?? null,
            perQuantity: prevPerQ,
          },
        });
        if (prior) {
          await tx.supplyStockTrack.update({
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
      const stock = await tx.supplyStockTrack.findFirst({
        where: {
          suppliesId: body.id,
          supplyBatchId: body.listId,
          inventoryBoxId: body.inventoryBoxId,
          supplierId: supplier ?? null,
          quality: body.quality ?? null,
          perQuantity: perQuantity,
        },
      });

      const brandCreates = brands
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
        .map((brand) => ({ brand, suppliesId: body.id }));

      if (stock) {
        await tx.supplyStockTrack.update({
          where: { id: stock.id },
          data: {
            stock: stock.stock + addedStock,
            quantity: stock.quantity + quantity,
            ...(body.quality ? { quality: body.quality } : {}),
            ...optional,
            ...(brandCreates.length > 0
              ? { brand: { createMany: { data: brandCreates } } }
              : {}),
            price: {
              create: {
                value: priceValue,
                suppliesId: body.id,
                timestamp: threeMonthsAgo.toISOString(),
              },
            },
          },
        });
      } else {
        await tx.supplyStockTrack.create({
          data: {
            suppliesId: body.id,
            stock: addedStock,
            quantity: quantity,
            quality: body.quality,
            perQuantity: perQuantity,
            inventoryBoxId: body.inventoryBoxId,
            supplyBatchId: body.listId,
            ...optional,
            price: {
              create: {
                value: priceValue,
                suppliesId: body.id,
                timestamp: threeMonthsAgo.toISOString(),
              },
            },
            ...(brandCreates.length > 0
              ? { brand: { createMany: { data: brandCreates } } }
              : {}),
          },
        });
      }
    });

    // Return information about whether stock was created or updated
    return res.code(200).send({
      message: "OK",
    });
  } catch (error) {
    console.log(error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const purchaseRequest = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  console.log("Params: ", params);

  if (!params.id) {
    throw new ValidationError("BAD_REQUEST");
  }
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit) : 20;

    const filter: any = {};

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
      } else {
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

    const response = await prisma.supplyBatchOrder.findMany({
      where: {
        status: 1,
        lineId: params.id,
        ...filter,
      },
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

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("DB_CONNNECTION_ERROR", 500, "DB_FAILED");
    }
    throw error;
  }
};

export const purchaseRequestInfo = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id: string };

  if (!params.id) throw new ValidationError("BAD_REQUEST");
  try {
    const response = await prisma.supplyBatchOrder.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!response) {
      throw new NotFoundError("Purchase Request Data not found!");
    }
    return res.code(200).send(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const purchaseRequestList = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as PagingProps;
  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;

    const response = await prisma.supplyOrder.findMany({
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
    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = response.length === limit;

    return res
      .code(200)
      .send({ list: response, hasMore, lastCursor: newLastCursorId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};
