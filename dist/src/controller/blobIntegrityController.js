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
exports.blobIntegrity = void 0;
const blobIntegrity_1 = require("../service/blobIntegrity");
const blobIntegrity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    const lines = [];
    const report = yield (0, blobIntegrity_1.runBlobIntegrityCheck)({
        countOnly: q.count === "1",
        limit: q.limit ? Math.max(1, parseInt(q.limit, 10) || 1) : undefined,
        log: (l) => {
            lines.push(l);
            console.log("[blob-integrity]", l);
        },
    });
    return res.code(200).send(Object.assign(Object.assign({}, report), { log: lines.slice(-200) }));
});
exports.blobIntegrity = blobIntegrity;
