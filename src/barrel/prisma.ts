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
} from "@prisma/client";

const prisma = new PrismaClient();

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
