import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

//
import { AddNewSupplyProps, UpdateSupplyProps } from "../models/route";
import { generatedItemCode } from "../middleware/handler";
export const addSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as AddNewSupplyProps;
    console.log("New", body);

    if (!body.item || !body.suppliesDataSetId || !body.lineId) {
      return res.code(400).send({ message: "Bad Request" });
    }
    const code = await generatedItemCode();
    await prisma.$transaction([
      prisma.supplies.create({
        data: {
          item: body.item,
          suppliesDataSetId: body.suppliesDataSetId,
          lineId: body.lineId,
          description: body.description,

          consumable: body.consumable,
          code,
        },
      }),
      prisma.inventoryAccessLogs.create({
        data: {
          userId: body.userId,
          inventoryBoxId: body.inventoryBoxId,
          action: `Added Supply: ${body.item}`,
          timestamp: new Date(),
        },
      }),
    ]);

    return res.code(200).send({ message: "OK" });
  } catch (error) {
    console.log(error);
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
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};

export const updateSupply = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = req.body as UpdateSupplyProps;
    console.log("suppl", body);

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }
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
    console.log(error);
    res.code(500).send({ message: "Internal Server Error" });
  }
};
