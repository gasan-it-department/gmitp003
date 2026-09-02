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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileType = exports.fileToBuffer = void 0;
exports.extractTextFromFile = extractTextFromFile;
const fileToBuffer = (file, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    const maxSizeBytes = ((options === null || options === void 0 ? void 0 : options.maxSizeMB) || 50) * 1024 * 1024; // Default 10MB
    const allowedTypes = (options === null || options === void 0 ? void 0 : options.allowedMimeTypes) || [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/png",
        "image/gif",
        "text/plain",
    ];
    // Validate file size
    if (file.file.bytesRead > maxSizeBytes) {
        throw new Error(`File too large. Max size: ${(options === null || options === void 0 ? void 0 : options.maxSizeMB) || 50}MB`);
    }
    // Validate mime type
    if (!allowedTypes.includes(file.mimetype)) {
        throw new Error(`File type ${file.mimetype} not allowed`);
    }
    // Convert stream to buffer
    const chunks = [];
    try {
        for (var _d = true, _e = __asyncValues(file.file), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
            _c = _f.value;
            _d = false;
            const chunk = _c;
            chunks.push(chunk);
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
        }
        finally { if (e_1) throw e_1.error; }
    }
    const buffer = Buffer.concat(chunks);
    // Optional: Extract text for abstract/search (for PDFs/DOCX)
    return {
        buffer, // Ready for PostgreSQL BYTEA column
        fileName: file.filename,
        mimeType: file.mimetype,
        fileSize: buffer.length,
        encoding: file.encoding,
        fields: file.fields,
    };
});
exports.fileToBuffer = fileToBuffer;
/**
 * More robust version with type assertion
 */
function extractTextFromFile(buffer, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // PDF files
            if (mimeType === "application/pdf") {
                // Use try-require pattern with type assertion
                const pdfParse = require("pdf-parse");
                const result = yield pdfParse(buffer);
                return result.text.substring(0, 100000);
            }
            // Word documents (.docx)
            if (mimeType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                const mammoth = require("mammoth");
                const result = yield mammoth.extractRawText({ buffer });
                return result.value.substring(0, 10000);
            }
            // Rest remains the same...
            if (mimeType.startsWith("text/")) {
                return buffer.toString("utf-8").substring(0, 10000);
            }
            return "";
        }
        catch (error) {
            console.error("Text extraction failed:", error);
            return "";
        }
    });
}
// Simple function to get file type from buffer or filename
const getFileType = (input) => {
    var _a;
    // If input has mimetype property, use it
    if ("mimetype" in input && input.mimetype) {
        return input.mimetype;
    }
    // Get the buffer to analyze
    const buffer = "buffer" in input ? input.buffer : input;
    if (!buffer || !Buffer.isBuffer(buffer)) {
        return "application/octet-stream";
    }
    // Check file signatures (magic numbers)
    const signatures = {
        // Images
        jpg: { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg", extension: "jpg" },
        png: {
            bytes: [0x89, 0x50, 0x4e, 0x47],
            mime: "image/png",
            extension: "png",
        },
        gif: { bytes: [0x47, 0x49, 0x46], mime: "image/gif", extension: "gif" },
        webp: {
            bytes: [0x52, 0x49, 0x46, 0x46],
            mime: "image/webp",
            extension: "webp",
        },
        // Documents
        pdf: {
            bytes: [0x25, 0x50, 0x44, 0x46],
            mime: "application/pdf",
            extension: "pdf",
        },
        doc: {
            bytes: [0xd0, 0xcf, 0x11, 0xe0],
            mime: "application/msword",
            extension: "doc",
        },
        docx: {
            bytes: [0x50, 0x4b, 0x03, 0x04],
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            extension: "docx",
        },
        xls: {
            bytes: [0xd0, 0xcf, 0x11, 0xe0],
            mime: "application/vnd.ms-excel",
            extension: "xls",
        },
        xlsx: {
            bytes: [0x50, 0x4b, 0x03, 0x04],
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            extension: "xlsx",
        },
        ppt: {
            bytes: [0xd0, 0xcf, 0x11, 0xe0],
            mime: "application/vnd.ms-powerpoint",
            extension: "ppt",
        },
        pptx: {
            bytes: [0x50, 0x4b, 0x03, 0x04],
            mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            extension: "pptx",
        },
        // Archives
        zip: {
            bytes: [0x50, 0x4b, 0x03, 0x04],
            mime: "application/zip",
            extension: "zip",
        },
        rar: {
            bytes: [0x52, 0x61, 0x72, 0x21],
            mime: "application/x-rar-compressed",
            extension: "rar",
        },
        "7z": {
            bytes: [0x37, 0x7a, 0xbc, 0xaf],
            mime: "application/x-7z-compressed",
            extension: "7z",
        },
        // Text
        txt: { bytes: [0xef, 0xbb, 0xbf], mime: "text/plain", extension: "txt" }, // UTF-8 BOM
    };
    // Check each signature
    for (const [type, sig] of Object.entries(signatures)) {
        const match = sig.bytes.every((byte, index) => buffer[index] === byte);
        if (match) {
            return sig.mime;
        }
    }
    // Try to determine from filename if available
    if ("filename" in input && input.filename) {
        const ext = (_a = input.filename.split(".").pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        if (ext) {
            const mimeMap = {
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                gif: "image/gif",
                pdf: "application/pdf",
                doc: "application/msword",
                docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                txt: "text/plain",
                zip: "application/zip",
                json: "application/json",
            };
            if (mimeMap[ext]) {
                return mimeMap[ext];
            }
        }
    }
    return "application/octet-stream";
};
exports.getFileType = getFileType;
