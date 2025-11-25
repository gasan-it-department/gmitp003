import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";

import fs from "fs";
import path from "path";
import { pipeline } from "stream";
import * as fsConstants from "fs";
import XLXS from "xlsx";
import ExcelJs from "exceljs";
import { formatDate } from "../utils/date";
import { ValidationError } from "../errors/errors";

export const itemExcelFile = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    if (!req.isMultipart()) {
      return res.status(400).send({ error: "Request must be multipart" });
    }

    const file = await req.file();
    if (!file) {
      return res.code(400).send({ messge: "Bad request" });
    }

    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const filename = `${Date.now()}-${file.fieldname}`;
    const filepath = path.join(uploadDir, filename);
    console.log(filepath);

    const workbook = XLXS.readFile(filepath);
    const worksheet = workbook.SheetNames;

    for (let sheetName of worksheet) {
      const sheet = workbook.Sheets[sheetName];
    }
  } catch (error) {
    console.log(error);
  }
};

export const dataSetSupplies = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  try {
    const body = req.body as { id: string };

    if (!body.id) {
      return res.code(400).send({ message: "Bad Request" });
    }

    const response = await prisma.supplies.findMany({
      where: {
        suppliesDataSetId: body.id,
      },
    });

    if (response.length === 0) {
      return res.code(404).send({ message: "No data found" });
    }

    const workbook = new ExcelJs.Workbook();
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Items", {
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        showGridLines: true,
      },
      // headerFooter: {
      //   oddHeader: `&L&B$Items`,
      //   oddFooter: `&RGenerated on: ${formatDate(
      //     new Date().toLocaleDateString()
      //   )}`,
      // },
    });

    worksheet.columns = [
      { header: "No", key: "no", width: 5 },
      { header: "Item", key: "item", width: 10 },
      { header: "Ref. Number", key: "ref", width: 14 },
      { header: "Date Added", key: "date", width: 26 },
    ];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    const rows = response.map((item, i) => ({
      no: i + 1,
      item: item.item ?? "N/A",
      ref: item.code,
      date: formatDate(item.createdAt.toISOString()),
    }));

    worksheet.addRows(rows);

    // Set proper headers
    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.header(
      "Content-Disposition",
      "attachment; filename=SupporterReport.xlsx"
    );
    res.header("Access-Control-Expose-Headers", "Content-Disposition");

    // Get the buffer and send it
    const buffer = await workbook.xlsx.writeBuffer();
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.code(500).send({ message: "Internal server error" });
  }
};

// export const updateLoadProfile = async (
//   req: FastifyRequest,
//   res: FastifyReply
// ) => {
//   try {
//     const data = await req.file();
//     if (!data) {
//       res.code(400).send({ error: 'No file uploaded' });
//       return;
//     }

//     // Ensure directory exists
//     const uploadDir = 'D:/portal/profile';
//     try {
//       await fs.access(uploadDir, fsConstants.constants.W_OK);
//     } catch {
//       await fs.mkdir(uploadDir, { recursive: true });
//     }

//     // Create safe filename and path
//     const originalFilename = data.filename;
//     const ext = path.extname(originalFilename);
//     const basename = path.basename(originalFilename, ext);
//     const filename = `${basename}-${Date.now()}${ext}`;
//     const filePath = path.join(uploadDir, filename);

//     // Write file using stream to handle large files efficiently
//     await pipeline(data.file, fs.createWriteStream(filePath));

//     return {
//       success: true,
//       message: 'File uploaded successfully',
//       path: filePath,
//       filename: filename
//     };
//   } catch (error) {
//     if (error instanceof Error) {
//       req.log.error(error);
//       res.code(500).send({
//         error: 'File upload failed',
//         details: error.message
//       });
//     } else {
//       res.code(500).send({
//         error: 'Unknown error occurred'
//       });
//     }
//   }
// };
