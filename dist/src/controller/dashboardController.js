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
exports.humanResourcesOverall = exports.overall = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const overall = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [accounts, lines, barangays, municipals, provinces, regions] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.account.count(),
            prisma_1.prisma.line.count(),
            prisma_1.prisma.barangay.count(),
            prisma_1.prisma.municipal.count(),
            prisma_1.prisma.province.count(),
            prisma_1.prisma.region.count(),
        ]);
        return res
            .code(200)
            .send({ accounts, lines, barangays, municipals, provinces, regions });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error!" });
    }
});
exports.overall = overall;
const humanResourcesOverall = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.lineId)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const employees = yield tx.user.count({
                where: {
                    lineId: params.lineId,
                },
            });
            const applications = yield tx.submittedApplication.count({
                where: {
                    lineId: params.lineId,
                },
            });
            const postedJobs = yield tx.jobPost.count({
                where: {
                    lineId: params.lineId,
                },
            });
            const vacancies = yield tx.positionSlot.count({
                where: {
                    unitPosition: {
                        lineId: params.lineId,
                    },
                    userId: undefined,
                },
            });
            const announcementsLive = yield tx.announcement.count({
                where: {
                    lineId: params.lineId,
                },
            });
            const announcementDraft = yield tx.announcement.count({
                where: {
                    status: 0,
                },
            });
            return {
                employees,
                applications,
                postedJobs,
                vacancies,
                announcementsLive,
                announcementDraft,
            };
        }));
        if (!response) {
            throw new errors_1.ValidationError("TRANSACTION FAILED");
        }
        return res.code(200).send(response);
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_FAILED");
        }
        throw error;
    }
});
exports.humanResourcesOverall = humanResourcesOverall;
