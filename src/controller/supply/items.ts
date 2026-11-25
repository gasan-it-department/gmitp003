/**
 * Catalogue: the items themselves, and the lists that show them.
 *
 * Moved out of supplyController.ts, which had grown to 3,034 lines
 * across twenty unrelated handlers. The code itself is unchanged.
 */
import { FastifyReply, FastifyRequest } from "../../barrel/fastify";
import { assertOwned } from "../../service/inventoryScope";
import { callerContext } from "../../service/callerScope";
import { Prisma, prisma } from "../../barrel/prisma";
import { AddNewSupplyProps, PagingProps, UpdateSupplyProps } from "../../models/route";
import { generatedItemCode } from "../../middleware/handler";
import {
  NotFoundError,
  ValidationError,
  dbError,
  UnauthorizedError,
} from "../../errors/errors";


export const addSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddNewSupplyProps;

    if (!body.item || !body.suppliesDataSetId) {
      return res.code(400).send({ message: "Bad Request" });
    }

    /*
      The municipality and the actor both come from the TOKEN.

      This route had no authentication at all and took `lineId` straight
      from the body, so anyone could add items to any municipality's
      catalogue — and the audit row beneath took `userId` from the body
      too, which let the entry name somebody who had done nothing. A
      forgeable audit trail is worse than none, because it is believed.

      A lineId in the body is still accepted when it matches the caller's
      own, so the existing web and desktop clients keep working unchanged;
      one that does not match is refused rather than quietly widened.
    */
    const caller = await callerContext(req);
    if (!caller.lineId) {
      throw new UnauthorizedError("Your account is not attached to a line.");
    }
    if (body.lineId && body.lineId !== caller.lineId) {
      throw new UnauthorizedError("This is not your municipality's data.");
    }
    const lineId = caller.lineId;

    const code = await generatedItemCode();
    await prisma.$transaction([
      prisma.supplies.create({
        data: {
          item: body.item,
          suppliesDataSetId: body.suppliesDataSetId,
          lineId,
          description: body.description,

          consumable: body.consumable,
          code,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          // The actor, resolved server-side — not whatever the body claimed.
          userId: caller.actorId,
          inventoryBoxId: body.inventoryBoxId,
          action: `Added Supply: ${body.item}`,
          timestamp: new Date(),
        },
      }),
    ]);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    /*
      Let the deliberate refusals through. This caught everything and
      answered 500, so "you are not signed in" and "that is not your
      municipality" both reached the client as "Internal Server Error" —
      which reads as a bug in the server rather than a decision about the
      request, and hides a refusal from anyone reading the logs.
    */
    if (
      error instanceof UnauthorizedError ||
      error instanceof ValidationError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    console.error(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const updateSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as UpdateSupplyProps;

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }

    await assertOwned(req, "supply", body.id);
    const toUpdate: any = {
      consumable: body.consumable,
    };

    if (body.item) {
      toUpdate.item = body.item;
    }
    if (body.description) {
      toUpdate.description = body.description;
    }

    await prisma.$transaction([
      prisma.supplies.update({
        where: {
          id: body.id,
        },
        data: toUpdate,
      }),
      // prisma.inventoryAccessLogs.create({
      //   data:{

      //   }
      // })
    ]);
  } catch (error) {
    console.error(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const deleteSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.query as {
      id: string;
      userId: string;
      inventoryBoxId: string;
    };
    if (!body.id || !body.userId || !body.inventoryBoxId) {
      return res.code(400).send({ message: "Bad Request!" });
    }
    await assertOwned(req, "supply", body.id);
    await prisma.$transaction([
      prisma.supplies.delete({
        where: {
          id: body.id,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          action: "Deleted an item.",
          inventoryBoxId: body.inventoryBoxId,
          userId: body.userId,
          timestamp: new Date(),
        },
      }),
    ]);
  } catch (error) {
    console.error(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const supplyList = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("BAD_REQUEST");

  try {
    const take = params.limit ? parseInt(params.limit, 10) : 20;
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;

    // Build search filter on Supplies (item name / refNumber)
    const searchFilter: any = {};
    if (params.query) {
      const terms = params.query.trim().split(/\s+/);
      if (terms.length === 1) {
        searchFilter.OR = [
          { item: { contains: terms[0], mode: "insensitive" } },
          { refNumber: { contains: terms[0], mode: "insensitive" } },
        ];
      } else {
        searchFilter.AND = terms.map((term) => ({
          OR: [
            { item: { contains: term, mode: "insensitive" } },
            { refNumber: { contains: term, mode: "insensitive" } },
          ],
        }));
      }
    }

    // Return Supplies rows joined to the list via their stock-tracks.
    const supplies = await prisma.supplies.findMany({
      where: {
        ...searchFilter,
        SupplyStockTrack: {
          some: { supplyBatchId: params.id },
        },
      },
      skip: cursor ? 1 : 0,
      take,
      cursor,
      orderBy: { item: "asc" },
      include: {
        SupplyStockTrack: {
          where: { supplyBatchId: params.id },
          orderBy: { timestamp: "desc" },
          include: {
            brand: {
              select: { brand: true, model: true },
              orderBy: { timestamp: "desc" },
              take: 1,
            },
            // Pulled so the Dispense flow can label each batch with its
            // supplier name (e.g. "Stock: 12 → Supplier 1"). Null when
            // the stock row was created without a supplier reference.
            supplier: { select: { id: true, name: true } },
          },
        },
        SupplyPriceTrack: {
          select: { value: true, timestamp: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    // Attach computed `totalStock` per supply (sum of quantity * perQuantity)
    const list = supplies.map((s) => {
      const tracks = s.SupplyStockTrack ?? [];
      const totalStock = tracks.reduce(
        (sum, t) => sum + (t.quantity ?? 0) * (t.perQuantity || 1),
        0,
      );
      return { ...s, totalStock };
    });

    const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
    const hasMore = list.length === take;

    return res.code(200).send({ list, lastCursor: newLastCursorId, hasMore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw dbError(error);
    }
    throw error;
  }
};

export const categories = async (req: FastifyRequest, res: FastifyReply) => {
  const params = req.query as PagingProps;

  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  if (!params.query)
    return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
  try {
    const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
    const limit = params.limit ? parseInt(params.limit, 10) : 10;

    const response = await prisma.supplyCategory.findMany({
      where: {
        label: {
          contains: params.query,
          mode: "insensitive",
        },
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
    });

    const newLastCursorId =
      response.length > 0 ? response[response.length - 1].id : null;
    const hasMore = limit === response.length;

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

// GET /supply/container-datasets?id=<inventoryBoxId>
// Datasets belong to a CONTAINER (a container can have several), and lists
// aren't pinned to one — so the direct "Add item" form searches/creates within
// the container's datasets. Returns them with their supply counts.

export const containerDatasets = async (
  req: FastifyRequest,
  res: FastifyReply,
) => {
  const params = req.query as { id?: string };
  if (!params.id) throw new ValidationError("INVALID REQUIRED ID");
  const datasets = await prisma.suppliesDataSet.findMany({
    where: { inventoryBoxId: params.id },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      title: true,
      _count: { select: { supplies: true } },
    },
  });
  return res.code(200).send({
    list: datasets.map((d) => ({
      id: d.id,
      title: d.title,
      count: d._count.supplies,
    })),
  });
};
