import { FastifyRequest, FastifyReply } from "../barrel/fastify";
import { Prisma, prisma } from "../barrel/prisma";
import { AppError, NotFoundError, ValidationError } from "../errors/errors";
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

export const orders = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { id, lastCursor, limit } = req.query as PagingProps;
    console.log({ id, lastCursor, limit });

    if (!id) {
      return res.code(400).send({ message: "Bad request" });
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
    const { query, lastCursor, limit, id } = req.query as PagingProps;
    console.log("====================================");
    console.log("sdas");
    console.log("====================================");
    if (!id) {
      throw new ValidationError("BAD_REQUEST");
    }
    const cursor = lastCursor ? { id: lastCursor } : undefined;
    const items = await prisma.supplyOrder.findMany({
      where: {
        supplyBatchOrderId: id,
      },
      cursor,
      take: parseInt(limit, 10),
      skip: cursor ? 1 : 0,
      include: {
        supply: {
          select: {
            item: true,
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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
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
      qualityId: string;
    };
    console.log("Params new ORder: ", params);

    if (!params.quanlity || !params.orderId || !params.supplyId) {
      return res.code(400).send({ message: "BAD REQUEST!" });
    }
    const checked = await prisma.supplyOrder.findFirst({
      where: {
        supplyBatchOrderId: params.orderId,
        suppliesId: params.supplyId,
      },
    });

    if (checked) {
      return res.code(400).send({ message: "Already Existed in Order list" });
    }
    const code = await generateItemRef();
    await prisma.$transaction([
      prisma.supplyOrder.create({
        data: {
          desc: params.desc,
          supplyBatchOrderId: params.orderId,
          quantity: parseInt(params.quanlity, 10),
          suppliesId: params.supplyId,
          refNumber: code,
          suppliesQualityId: params.qualityId,
        },
      }),
    ]);

    return res.code(200).send({ message: "Success!" });
  } catch (error) {
    console.log(error);
  }
};

export const removeOrderItem = async (
  req: FastifyRequest,
  res: FastifyReply
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
  res: FastifyReply
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
  if (!body.ids || !body.orderId || !body.userId || !body.inventoryBoxId) {
    throw new ValidationError("BAD REQUEST!");
  }

  try {
    const [items, order, stocks] = await prisma.$transaction([
      prisma.supplyOrder.findMany({
        where: {
          supplyBatchOrderId: body.orderId,
          id: {
            in: body.ids.map((i) => i.id),
          },
        },
      }),
      prisma.supplyBatchOrder.findUnique({
        where: {
          id: body.orderId,
        },
      }),
      prisma.supplyStockTrack.findMany({
        where: {
          suppliesId: { in: body.ids.map((i) => i.id) },
        },
      }),
    ]);

    if (!order) throw new NotFoundError("Order not found!");
    if (items.length === 0) throw new NotFoundError("No items found!");

    const operations: Prisma.PrismaPromise<any>[] = [];
    const currentDate = new Date();

    // Subtract 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(currentDate.getMonth() - 3);

    body.ids.forEach((item) => {
      const existed = stocks.find((i) => i.suppliesId === item.id);
      if (existed) {
        operations.push(
          prisma.supplyStockTrack.update({
            where: { id: existed.id },
            data: {
              stock: existed.stock + parseInt(item.quantity, 10),
              inventoryBoxId: order.inventoryBoxId,
              price: {
                create: {
                  value: item.price ? parseFloat(item.price) : 0,
                  suppliesId: item.id,
                },
              },
            },
          })
        );
      } else {
        operations.push(
          prisma.supplyStockTrack.create({
            data: {
              suppliesId: item.id,
              stock: parseInt(item.quantity, 10),
              inventoryBoxId: order.inventoryBoxId,
              supplyBatchId: order.supplyBatchId,
              price: {
                create: {
                  value: item.price ? parseFloat(item.price) : 0,
                  suppliesId: item.id,
                },
              },
            },
          })
        );
      }
      operations.push(
        prisma.inventoryAccessLogs.create({
          data: {
            userId: body.userId,
            inventoryBoxId: body.inventoryBoxId,
            action: `Fullfilled Order: ${order.title} Ref No.: ${order.refNumber}`,
            timestamp: threeMonthsAgo.toISOString(),
          },
        })
      );
    });

    // Execute all operations in a transaction
    await prisma.$transaction(operations);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const saveItemOrder = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as FullfilledItemOrderProps;
  console.log("Datas: ", body);

  if (
    !body.id ||
    !body.quantity ||
    !body.condition ||
    body.resolve === undefined ||
    !body.inventoryBoxId ||
    !body.listId
  ) {
    throw new ValidationError("BAD REQUEST!1");
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

    // Subtract 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(currentDate.getMonth() - 7);

    await prisma.$transaction(async (tx) => {
      const item = await tx.supplyOrder.findUnique({
        where: { id: body.orderItemId },
      });
      const stock = await tx.supplyStockTrack.findFirst({
        where: { suppliesId: body.id },
      });
      // let supplier;
      // if (body.supplier) {
      //   supplier = await tx.supplier.findFirst({
      //     where: { id: body.supplier },
      //   });
      // }

      if (!item) throw new NotFoundError("Item not found!");
      // if (!supplier) {
      //   supplier = await tx.supplier.create({
      //     data: {
      //       name: body.supplier,
      //       lineId: body.lineId,
      //     },
      //   });
      // }
      //console.log("Source: ", supplier);

      const orderItem = await tx.supplyOrder.update({
        where: { id: body.orderItemId },
        data: {
          price: body.price ? parseFloat(body.price) : 0,
          status: body.condition,
          comments: body.comments,
          remark: body.resolve,
          condition: body.condition,
        },
      });
      console.log("Item updated:", orderItem);

      if (stock) {
        await tx.supplyStockTrack.update({
          where: { id: stock.id },
          data: {
            stock: stock.stock + parseInt(body.quantity, 10),
            brand: {
              create: {
                brand: body.brand || "N/A",
                suppliesId: body.id,
              },
            },
            price: {
              create: {
                value: body.price ? parseFloat(body.price) : 0,
                suppliesId: body.id,
                timestamp: threeMonthsAgo.toISOString(),
              },
            },
            supplyBatchId: body.listId,
          },
        });
      } else {
        await tx.supplyStockTrack.create({
          data: {
            suppliesId: body.id,
            stock: parseInt(body.quantity, 10),
            inventoryBoxId: body.inventoryBoxId,
            supplyBatchId: body.listId,
            expiration: body.expirationDate,
            price: {
              create: {
                value: body.price ? parseFloat(body.price) : 0,
                suppliesId: body.id,
                timestamp: threeMonthsAgo.toISOString(),
              },
            },
            brand: {
              create: {
                brand: body.brand || "N/A",
                suppliesId: body.id,
              },
            },
          },
        });
      }
    });

    // Return information about whether stock was created or updated
    return res.code(200).send({
      message: "OK",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database operation failed", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const purchaseRequest = async (
  req: FastifyRequest,
  res: FastifyReply
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
  res: FastifyReply
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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};

export const purchaseRequestList = async (
  req: FastifyRequest,
  res: FastifyReply
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
      throw new AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
    }
    throw error;
  }
};
