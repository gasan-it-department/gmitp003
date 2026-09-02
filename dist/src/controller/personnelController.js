"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.personnelList = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
/**
 * Paginated list of users assigned to a department/unit.
 *
 * Supports an optional `query` to filter by first/last/middle name or
 * email (case-insensitive). The previous version had a `hasMore` bug
 * (compared `response.length === 10` regardless of the requested limit)
 * and ignored search input entirely.
 */
const personnelList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lastCursor, query, limit, id } = req.query;
    if (!id)
        throw new errors_1.ValidationError("INVALID_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 20;
        const where = { departmentId: id };
        if (query && query.trim()) {
            const q = query.trim();
            where.OR = [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { middleName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
            ];
        }
        const response = yield prisma_1.prisma.user.findMany({
            where,
            cursor,
            take,
            skip: cursor ? 1 : 0,
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            select: {
                id: true,
                firstName: true,
                lastName: true,
                middleName: true,
                email: true,
                username: true,
                // `status` + `term` let the UI label provisional (non-plantilla) staff
                // with their employment type / contract end instead of "No position".
                status: true,
                term: true,
                Position: { select: { id: true, name: true } },
            },
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === take;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.error("[personnelList]", error);
        return res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.personnelList = personnelList;
