"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = exports.NotFoundError = exports.addAccessToListSchema = exports.listDataSchema = exports.containerOverviewSchema = exports.deleteOrderSchema = exports.deleteOrderItemSchema = exports.newOrderSchema = exports.deleteListSchema = exports.listSchema = exports.inventoryAccessLogsSchema = exports.deleteSupplySchema = exports.addNewSupplySchema = exports.newDataSetSchema = exports.controllerListSchema = exports.adminLoginScehma = exports.announcementsSchema = exports.groupListSchema = exports.addPostionSchema = exports.positionListSchema = exports.personnelListSchema = exports.regionListSchema = exports.employeeSchema = exports.registerSchema = exports.authSchema = void 0;
exports.authSchema = {
    body: {
        type: "object",
        properties: {
            username: { type: "string" },
            password: { type: "string" },
        },
        required: ["username", "password"],
    },
};
exports.registerSchema = {
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
exports.employeeSchema = {
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
exports.regionListSchema = {
    params: {
        type: "object",
        properties: {
            lastCursor: { type: "string" },
        },
    },
};
exports.personnelListSchema = {
    params: {
        type: "object",
        properties: {
            cursor: { type: "string" },
        },
    },
};
exports.positionListSchema = {
    params: {
        type: "object",
        properties: {
            cursor: { type: "string" },
            limit: { type: "number" },
        },
    },
};
exports.addPostionSchema = {
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
exports.groupListSchema = {
    params: {
        type: "object",
        properties: {
            lastCursor: { type: "string" },
            limit: { type: "number" },
            line: { type: "string" },
        },
    },
};
exports.announcementsSchema = {
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
exports.adminLoginScehma = {
    body: {
        type: "object",
        properties: {
            username: { type: "string" },
            password: { type: "string" },
        },
    },
};
exports.controllerListSchema = {
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
exports.newDataSetSchema = {
    body: {
        type: "object",
        properties: {
            title: { type: "string" },
            lineId: { type: "string" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.addNewSupplySchema = {
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
exports.deleteSupplySchema = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
            userId: { type: "string" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.inventoryAccessLogsSchema = {
    params: {
        type: "object",
        properties: {
            token: { type: "string" },
            last: { type: "string" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.listSchema = {
    params: {
        type: "object",
        properties: {
            token: { type: "string" },
            lastCursor: { type: "string" },
            limit: { type: "number" },
            inventoryBoxId: { type: "string" },
            id: { type: "string" },
        },
    },
};
exports.deleteListSchema = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
            userId: { type: "string" },
            containerId: { type: "string" },
        },
    },
};
exports.newOrderSchema = {
    body: {
        type: "object",
        properties: {
            title: { type: "string" },
            lastCursor: { type: "string" },
            limit: { type: "number" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.deleteOrderItemSchema = {
    params: {
        type: "object",
        properties: {
            ids: {
                type: "array",
                items: {
                    type: "string",
                },
            },
            userId: { type: "string" },
            orderId: { type: "string" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.deleteOrderSchema = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
            userId: { type: "string" },
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.containerOverviewSchema = {
    params: {
        type: "object",
        properties: {
            inventoryBoxId: { type: "string" },
        },
    },
};
exports.listDataSchema = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
        },
    },
};
exports.addAccessToListSchema = {
    body: {
        type: "object",
        properties: {
            userId: { type: "string" },
            containerId: { type: "string" },
            listId: { type: "string" },
        },
    },
};
class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "NotFoundError";
    }
}
exports.NotFoundError = NotFoundError;
// Define a custom error class (TypeScript)
class AppError extends Error {
    constructor(statusCode, message, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.message = message;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
