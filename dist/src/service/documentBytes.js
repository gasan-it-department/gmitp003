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
exports.documentBytes = void 0;
/**
 * The bytes of a document's file, from wherever they actually live.
 *
 * One function so that every caller behaves the same way: the bucket once
 * the row has been migrated, the `fileDecoded` column until then, and the
 * column is never SELECTed unless it is genuinely needed. Spreading that
 * rule across the seven places that open a PDF is how one of them ends up
 * still pulling 77 MB through Postgres a year from now.
 */
const prisma_1 = require("../barrel/prisma");
const blobStore_1 = require("./blobStore");
const documentBytes = (documentId, storageKey) => __awaiter(void 0, void 0, void 0, function* () {
    return (0, blobStore_1.readBlobLazy)(storageKey, () => __awaiter(void 0, void 0, void 0, function* () {
        const row = yield prisma_1.prisma.decodedFile.findUnique({
            where: { documentId },
            select: { fileDecoded: true },
        });
        return row === null || row === void 0 ? void 0 : row.fileDecoded;
    }));
});
exports.documentBytes = documentBytes;
