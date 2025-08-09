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
};
