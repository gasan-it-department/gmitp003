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
exports.updateSalaryGrade = exports.saveNewSalaryGrade = exports.salaryGradeList = void 0;
const prisma_1 = require("../barrel/prisma");
//
const errors_1 = require("../errors/errors");
const salaryGradeList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { lastCursor, limit, id } = req.query;
    if (!id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const cursor = lastCursor ? { id: lastCursor } : undefined;
        const take = limit ? parseInt(limit, 10) : 10;
        const response = yield prisma_1.prisma.salaryGrade.findMany({
            where: {
                lineId: id,
            },
            cursor,
            take: take,
            skip: cursor ? 1 : 0,
            orderBy: {
                grade: "asc",
            },
            include: {
                _count: {
                    select: {
                        SalaryGradeHistory: true,
                        users: true,
                    },
                },
            },
        });
        const newLastCursor = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = response.length === take;
        return res
            .code(200)
            .send({ list: response, lastCursor: newLastCursor, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.salaryGradeList = salaryGradeList;
const saveNewSalaryGrade = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield prisma_1.prisma.salaryGrade.createMany({
            data: Array.from({ length: 33 }).map((_, i) => ({
                grade: i + 1,
                amount: 2.1,
                lineId: "c039c8fd-8058-4e07-820e-7a3f36dc108d",
            })),
            skipDuplicates: true,
        });
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_FAILED", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.saveNewSalaryGrade = saveNewSalaryGrade;
const updateSalaryGrade = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.amount || !body.lineId || !body.userId) {
        throw new errors_1.ValidationError("BAD_REQUEST");
    }
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const updatedSalaryGrade = yield tx.salaryGrade.update({
                data: {
                    amount: body.amount,
                },
                where: {
                    id: body.id,
                },
            });
            yield tx.salaryGradeHistory.create({
                data: {
                    salaryGradeId: body.id,
                    amount: body.amount,
                    userId: "",
                    effectiveDate: new Date(),
                },
            });
            yield tx.humanResourcesLogs.create({
                data: {
                    action: `Updated Salary Grade ${updatedSalaryGrade.grade} to ${updatedSalaryGrade.amount}`,
                    lineId: updatedSalaryGrade.lineId,
                    desc: `Salary Grade ${updatedSalaryGrade.grade} amount updated to ${updatedSalaryGrade.amount}`,
                    userId: body.userId,
                },
            });
            return true;
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send({
            message: "OK",
        });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.updateSalaryGrade = updateSalaryGrade;
