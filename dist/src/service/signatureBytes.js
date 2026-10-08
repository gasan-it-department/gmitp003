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
exports.signatureBytes = void 0;
/**
 * A signature's image bytes, from wherever they live.
 *
 * Unlike a document, a signature is a PNG of a hundred kilobytes or so, and
 * the column is still SELECTed alongside the key as the fallback rather than
 * fetched lazily on a miss. A second query per signature would cost more
 * than the bytes it saved moving — the lazy path in `documentBytes` exists
 * because a PDF can be 77 MB, not as a general rule.
 *
 * Takes the row rather than an id so it works for every one of the shapes
 * the stamping code selects, including the ones that fetch many at once.
 */
const blobStore_1 = require("./blobStore");
const signatureBytes = (row) => __awaiter(void 0, void 0, void 0, function* () { var _a; return (0, blobStore_1.readBlob)((_a = row.storageKey) !== null && _a !== void 0 ? _a : null, row.signature); });
exports.signatureBytes = signatureBytes;
