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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.test = void 0;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../barrel/prisma");
const handelApiTest = (api) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield axios_1.default.get(api);
    if (response.status !== 200) {
        throw new Error("Failed ");
    }
    return response.data;
});
const test = (fastify) => {
    fastify.get("/test", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const regions = yield handelApiTest("https://psgc.gitlab.io/api/regions/");
            const province = yield handelApiTest("https://psgc.gitlab.io/api/regions/170000000/provinces/");
            const municipalities = yield handelApiTest("https://psgc.gitlab.io/api/provinces/174000000/municipalities/");
            const barangay = yield handelApiTest("https://psgc.gitlab.io/api/municipalities/174003000/barangays/");
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
        }
        catch (error) {
            console.log(error);
            res.code(500).send({ message: "Internal Server" });
        }
    }));
    fastify.post("/testOne", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const sg = yield prisma_1.prisma.salaryGrade.createManyAndReturn({
                data: Array.from({ length: 33 }).map((_, i) => {
                    return {
                        grade: i + 1,
                        amount: 1,
                    };
                }),
            });
            yield prisma_1.prisma.$transaction([
                prisma_1.prisma.salaryGradeHistory.createMany({
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
        }
        catch (error) {
            console.log(error);
            res.code(500).send({ message: "Inernal Server Error" });
        }
    }));
    fastify.get("/areas", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const regions = yield prisma_1.prisma.region.findMany();
            const provinces = yield prisma_1.prisma.province.findMany();
            const municipalities = yield prisma_1.prisma.municipal.findMany();
            const barangays = yield prisma_1.prisma.barangay.findMany();
            return {
                regions,
                provinces,
                municipalities,
                barangays,
            };
        }
        catch (error) {
            console.log(error);
        }
    }));
    fastify.get("/test-quality", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            yield prisma_1.prisma.suppliesQuality.createMany({
                data: data.map((item) => {
                    return {
                        quality: item.quality,
                        perQuality: item.perQuality,
                    };
                }),
            });
            res.code(200).send({ message: "OK" });
        }
        catch (error) {
            console.log(error);
        }
    }));
    fastify.post("/application/upload", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        const parts = request.parts();
        const files = [];
        const data = {};
        try {
            for (var _d = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _d = true) {
                _c = parts_1_1.value;
                _d = false;
                const part = _c;
                if (part.type === "file") {
                    // Handle file
                    const buffer = yield part.toBuffer();
                    files.push({
                        filename: part.filename,
                        mimetype: part.mimetype,
                        data: buffer,
                        fieldname: part.fieldname,
                    });
                }
                else {
                    // Handle regular fields
                    data[part.fieldname] = part.value;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return {
            message: "Files and data received",
            data,
            files: files.map((f) => ({
                filename: f.filename,
                fieldname: f.fieldname,
            })),
        };
    }));
    fastify.get("/test/env", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const applications = yield prisma_1.prisma.submittedApplication.findMany();
        return res.code(200).send({ applications });
    }));
    fastify.get("/test/notification", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const response = yield prisma_1.prisma.supplyBatchOrder.findMany();
            return res.code(200).send({ list: response });
        }
        catch (error) {
            console.log(error);
        }
    }));
};
exports.test = test;
