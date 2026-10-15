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
 * The bytes of a document's file.
 *
 * Kept as its own function even though it is now a one-liner: every place
 * that opens a PDF goes through here, so if documents ever move again
 * there is one thing to change rather than seven.
 *
 * It used to prefer the bucket and fall back to the `fileDecoded` column.
 * That column was dropped once every object had been verified in the
 * bucket, so there is nothing left to fall back to.
 */
const blobStore_1 = require("./blobStore");
const documentBytes = (_documentId, storageKey) => __awaiter(void 0, void 0, void 0, function* () { return (0, blobStore_1.readBlob)(storageKey); });
exports.documentBytes = documentBytes;
