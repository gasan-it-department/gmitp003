import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  User,
  Barangay,
  Municipal,
  Province,
  Region,
  Line,
  InvitationLink,
  Department,
  Prisma,
  SupplyStockTrack,
  Prescription,
  SubmittedApplication,
} from "../../generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export {
  prisma,
  User,
  Barangay,
  Municipal,
  Province,
  Region,
  Line,
  InvitationLink,
  Department,
  Prisma,
  SupplyStockTrack,
  Prescription,
  SubmittedApplication,
};
