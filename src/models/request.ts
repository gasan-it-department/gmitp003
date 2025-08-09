import { FastifySchema } from "../barrel/fastify";

export const authSchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" },
    },
    required: ["username", "password"],
  },
};

export const registerSchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      level: { type: "number" },
    },
    required: ["username", "password", "firstName", "lastName", "level"],
  },
};

export const employeeSchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      page: { type: "number" },
      office: { type: "string" },
      sgFrom: { type: "number" },
      sgTo: { type: "number" },
      year: { type: "string" },
      dateApp: { type: "string" },
      dateLast: { type: "string" },
      lastCursorId: { type: "string" },
      query: { type: "string" },
    },
  },
};

export const regionListSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      lastCursor: { type: "string" },
    },
  },
};

export const personnelListSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      cursor: { type: "string" },
    },
  },
};

export const positionListSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      cursor: { type: "string" },
      limit: { type: "number" },
    },
  },
};

export const addPostionSchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      itemNumber: { type: "string" },
      title: { type: "string" },
      salaryGrade: { type: "string" },
      status: { type: "string" },
    },
  },
};

export const groupListSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      lastCursor: { type: "string" },
      limit: { type: "number" },
      line: { type: "string" },
    },
  },
};

export const announcementsSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      lastCursor: { type: "string" },
      limit: { type: "number" },
      line: { type: "string" },
      departmentId: { type: "string" },
      important: { type: "boolean" },
    },
  },
};

export const adminLoginScehma: FastifySchema = {
  body: {
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" },
    },
  },
};

export const controllerListSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      lastCursor: { type: "string" },
      limit: { type: "string" },
      line: { type: "string" },
      query: { type: "string" },
    },
  },
};

export const newDataSetSchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      title: { type: "string" },
      lineId: { type: "string" },
      inventoryBoxId: { type: "string" },
    },
  },
};

export const addNewSupplySchema: FastifySchema = {
  body: {
    type: "object",
    properties: {
      item: { type: "string" },
      lineId: { type: "string" },
      suppliesDataSetId: { type: "string" },
      description: { type: "string" },
      consumable: { type: "boolean" },
    },
  },
};

export const deleteSupplySchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      inventoryBoxId: { type: "string" },
    },
  },
};

export const inventoryAccessLogsSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      token: { type: "string" },
      last: { type: "string" },
      inventoryBoxId: { type: "string" },
    },
  },
};

export const listSchema: FastifySchema = {
  params: {
    type: "object",
    properties: {
      token: { type: "string" },
      lastCursor: { type: "string" },
      limit: { type: "number" },
      inventoryBoxId: { type: "string" },
    },
  },
};

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Define a custom error class (TypeScript)
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational: boolean = true
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}
