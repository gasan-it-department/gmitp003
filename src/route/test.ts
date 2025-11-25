import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "../barrel/fastify";
import axios from "axios";
import { prisma } from "../barrel/prisma";

const handelApiTest = async (api: string) => {
  const response = await axios.get(api);
  if (response.status !== 200) {
    throw new Error("Failed ");
  }
  return response.data;
};

export const test = (fastify: FastifyInstance) => {
  fastify.get("/test", async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const regions = await handelApiTest(
        "https://psgc.gitlab.io/api/regions/"
      );
      const province = await handelApiTest(
        "https://psgc.gitlab.io/api/regions/170000000/provinces/"
      );
      const municipalities = await handelApiTest(
        "https://psgc.gitlab.io/api/provinces/174000000/municipalities/"
      );
      const barangay = await handelApiTest(
        "https://psgc.gitlab.io/api/municipalities/174003000/barangays/"
      );
      //   await prisma.$transaction([
      //     prisma.region.createMany({
      //       data: regions.map((item: any) => {
      //         return {
      //           id: item.code,
      //           name: item.name,
      //         };
      //       }),
      //     }),
      //     prisma.province.createMany({
      //       data: province.map((item: any) => {
      //         return {
      //           id: item.code,
      //           name: item.name,
      //           regionId: "170000000",
      //         };
      //       }),
      //     }),
      //     prisma.municipal.createMany({
      //       data: municipalities.map((item: any) => {
      //         return {
      //           id: item.code,
      //           name: item.name,
      //           provinceId: "174000000",
      //         };
      //       }),
      //     }),
      //     prisma.barangay.createMany({
      //       data: barangay.map((item: any) => {
      //         return {
      //           id: item.code,
      //           name: item.name,
      //           municipalId: "174003000",
      //         };
      //       }),
      //     }),
      //   ]);
      console.log("Success!");
      //   await prisma.$transaction([
      //     prisma.region.deleteMany(),
      //     prisma.province.deleteMany(),
      //     prisma.municipal.deleteMany(),
      //     prisma.barangay.deleteMany(),
      //   ]);
      // const test = await prisma.barangay.findMany();
      // console.log({ test });

      return regions;
    } catch (error) {
      console.log(error);
      res.code(500).send({ message: "Internal Server" });
    }
  });
  fastify.post("/testOne", async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const sg = await prisma.salaryGrade.createManyAndReturn({
        data: Array.from({ length: 33 }).map((_, i) => {
          return {
            grade: i + 1,
            amount: 1,
          };
        }),
      });
      await prisma.$transaction([
        prisma.salaryGradeHistory.createMany({
          data: sg.map((item, i) => {
            return {
              amount: 1,
              userId: "",
              effectiveDate: new Date(),
              salaryGradeId: item.id,
            };
          }),
        }),
      ]);
    } catch (error) {
      console.log(error);

      res.code(500).send({ message: "Inernal Server Error" });
    }
  });
  fastify.get("/areas", async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const regions = await prisma.region.findMany();
      const provinces = await prisma.province.findMany();
      const municipalities = await prisma.municipal.findMany();
      const barangays = await prisma.barangay.findMany();

      return {
        regions,
        provinces,
        municipalities,
        barangays,
      };
    } catch (error) {
      console.log(error);
    }
  });
  fastify.get(
    "/test-quality",
    async (req: FastifyRequest, res: FastifyReply) => {
      try {
        const data = [
          { quality: "Liter", perQuality: 1 },
          { quality: "Dozen", perQuality: 12 },
          { quality: "Bottle", perQuality: 1 },
          { quality: "Box", perQuality: 1 },
          { quality: "Bundle", perQuality: 1 },
          { quality: "Sack", perQuality: 1 },
          { quality: "Yard", perQuality: 1 },
          { quality: "Pack", perQuality: 6 },
          { quality: "Each", perQuality: 1 },
          { quality: "Case", perQuality: 24 },
          { quality: "Kilogram", perQuality: 1 },
          { quality: "Ton", perQuality: 1 },
        ];
        await prisma.suppliesQuality.createMany({
          data: data.map((item) => {
            return {
              quality: item.quality,
              perQuality: item.perQuality,
            };
          }),
        });
        res.code(200).send({ message: "OK" });
      } catch (error) {
        console.log(error);
      }
    }
  );
  fastify.post("/application/upload", async (request, reply) => {
    const parts = request.parts();
    const files = [];
    const data: any = {};

    for await (const part of parts) {
      if (part.type === "file") {
        // Handle file
        const buffer = await part.toBuffer();
        files.push({
          filename: part.filename,
          mimetype: part.mimetype,
          data: buffer,
          fieldname: part.fieldname,
        });
      } else {
        // Handle regular fields
        data[part.fieldname] = part.value;
      }
    }

    return {
      message: "Files and data received",
      data,
      files: files.map((f) => ({
        filename: f.filename,
        fieldname: f.fieldname,
      })),
    };
  });
  fastify.get("/test/env", async (req: FastifyRequest, res: FastifyReply) => {
    const key = process.env.CLOUDINARY_URL;
    ///const municipals = await prisma.municipal.findMany();
    // const line = await prisma.position.updateMany({
    //   data: {
    //     lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
    //   },
    //   where: {
    //     lineId: null,
    //   },
    // });

    const applications = await prisma.submittedApplication.findMany();
    return res.code(200).send({ applications });
  });
};
