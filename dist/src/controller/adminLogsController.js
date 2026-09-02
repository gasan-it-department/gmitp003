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
exports.adminLogs = exports.adminLogTypes = exports.LOG_TYPES = void 0;
const prisma_1 = require("../barrel/prisma");
const userSel = {
    select: { firstName: true, lastName: true, username: true },
};
const lineSel = { select: { name: true } };
const fullName = (u) => {
    if (!u)
        return "—";
    const n = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return n || u.username || "—";
};
// action int → label maps (documented in the schema where available).
const MED = ["Removed", "Added", "Updated", "Dispensed"];
const DOC = [
    "Removed",
    "Added",
    "Updated",
    "Archived",
    "Requested",
    "Approved",
    "Rejected",
];
const INV = ["Removed", "Added", "Transferred", "Adjusted", "Dispensed"];
const GEN = ["Removed", "Added", "Updated"];
const MSG = ["Pending", "Sent", "Failed"];
const lbl = (map, a) => { var _a; return (_a = map[a]) !== null && _a !== void 0 ? _a : `Action ${a}`; };
// The catalogue the admin panel shows as sub-tabs.
exports.LOG_TYPES = [
    { key: "hr", label: "Human Resources" },
    { key: "medicine", label: "Medicine" },
    { key: "document", label: "Documents" },
    { key: "activity", label: "Activity" },
    { key: "inventory", label: "Inventory" },
    { key: "inventoryAccess", label: "Inventory Access" },
    { key: "admin", label: "Admin" },
    { key: "message", label: "Messages (SMS)" },
    { key: "record", label: "User Records" },
    { key: "mobileUpload", label: "Mobile Uploads" },
];
const adminLogTypes = (_req, res) => __awaiter(void 0, void 0, void 0, function* () { return res.code(200).send({ types: exports.LOG_TYPES }); });
exports.adminLogTypes = adminLogTypes;
const adminLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const q = req.query;
    const type = q.type || "hr";
    const limit = q.limit ? parseInt(q.limit, 10) : 25;
    const cursor = q.lastCursor ? { id: q.lastCursor } : undefined;
    const skip = cursor ? 1 : 0;
    const search = ((_a = q.query) !== null && _a !== void 0 ? _a : "").trim();
    const like = { contains: search, mode: "insensitive" };
    try {
        const send = (list, rawLen) => res.code(200).send({
            list,
            lastCursor: list.length ? list[list.length - 1].id : null,
            hasMore: rawLen === limit,
        });
        switch (type) {
            case "hr": {
                const rows = yield prisma_1.prisma.humanResourcesLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search
                        ? { OR: [{ action: like }, { desc: like }] }
                        : undefined,
                    include: { user: userSel, line: lineSel },
                });
                return send(rows.map((r) => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: r.action,
                        description: r.desc,
                        actor: fullName(r.user),
                        line: (_b = (_a = r.line) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                    });
                }), rows.length);
            }
            case "medicine": {
                const rows = yield prisma_1.prisma.medicineLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search ? { message: like } : undefined,
                    include: { user: userSel, line: lineSel },
                });
                return send(rows.map((r) => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: lbl(MED, r.action),
                        description: r.message,
                        actor: fullName(r.user),
                        line: (_b = (_a = r.line) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                    });
                }), rows.length);
            }
            case "document": {
                const rows = yield prisma_1.prisma.documentActivityLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search
                        ? { OR: [{ title: like }, { desc: like }] }
                        : undefined,
                    include: { user: userSel, line: lineSel },
                });
                return send(rows.map((r) => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: lbl(DOC, r.action),
                        description: [r.title, r.desc].filter(Boolean).join(" — "),
                        actor: fullName(r.user),
                        line: (_b = (_a = r.line) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                    });
                }), rows.length);
            }
            case "activity": {
                const rows = yield prisma_1.prisma.activityLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search ? { desc: like } : undefined,
                    include: { user: userSel, line: lineSel },
                });
                return send(rows.map((r) => {
                    var _a, _b, _c;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: lbl(GEN, r.action),
                        description: (_a = r.desc) !== null && _a !== void 0 ? _a : "—",
                        actor: fullName(r.user),
                        line: (_c = (_b = r.line) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                    });
                }), rows.length);
            }
            case "inventory": {
                const rows = yield prisma_1.prisma.inventoryLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search ? { desc: like } : undefined,
                    include: { user: userSel, line: lineSel },
                });
                return send(rows.map((r) => {
                    var _a, _b, _c;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: lbl(INV, r.action),
                        description: (_a = r.desc) !== null && _a !== void 0 ? _a : "—",
                        actor: fullName(r.user),
                        line: (_c = (_b = r.line) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                    });
                }), rows.length);
            }
            case "inventoryAccess": {
                const rows = yield prisma_1.prisma.inventoryAccessLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search
                        ? { OR: [{ action: like }, { path: like }] }
                        : undefined,
                    include: { user: userSel },
                });
                return send(rows.map((r) => {
                    var _a;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: r.action,
                        description: (_a = r.path) !== null && _a !== void 0 ? _a : "—",
                        actor: fullName(r.user),
                        line: null,
                    });
                }), rows.length);
            }
            case "admin": {
                const rows = yield prisma_1.prisma.adminLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search ? { desc: like } : undefined,
                    include: { admin: { select: { username: true } } },
                });
                return send(rows.map((r) => {
                    var _a, _b, _c;
                    return ({
                        id: r.id,
                        timestamp: r.timestamp,
                        action: `Action ${r.action}`,
                        description: (_a = r.desc) !== null && _a !== void 0 ? _a : "—",
                        actor: (_c = (_b = r.admin) === null || _b === void 0 ? void 0 : _b.username) !== null && _c !== void 0 ? _c : "—",
                        line: null,
                    });
                }), rows.length);
            }
            case "message": {
                const rows = yield prisma_1.prisma.messageLogs.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search
                        ? { OR: [{ number: like }, { content: like }] }
                        : undefined,
                });
                return send(rows.map((r) => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        timestamp: (_a = r.timestamp) !== null && _a !== void 0 ? _a : null,
                        action: lbl(MSG, r.status),
                        description: (_b = r.content) !== null && _b !== void 0 ? _b : "—",
                        actor: r.number,
                        line: null,
                    });
                }), rows.length);
            }
            case "record": {
                const rows = yield prisma_1.prisma.logRecord.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { timestamp: "desc" },
                    where: search ? { action: like } : undefined,
                    include: { user: userSel },
                });
                return send(rows.map((r) => ({
                    id: r.id,
                    timestamp: r.timestamp,
                    action: r.action,
                    description: "—",
                    actor: fullName(r.user),
                    line: null,
                })), rows.length);
            }
            case "mobileUpload": {
                const rows = yield prisma_1.prisma.mobileUploadLog.findMany({
                    cursor,
                    take: limit,
                    skip,
                    orderBy: { createdAt: "desc" },
                    where: search
                        ? { OR: [{ kind: like }, { message: like }] }
                        : undefined,
                });
                return send(rows.map((r) => {
                    var _a, _b;
                    return ({
                        id: r.id,
                        timestamp: r.createdAt,
                        action: r.kind,
                        description: (_a = r.message) !== null && _a !== void 0 ? _a : "—",
                        actor: (_b = r.userId) !== null && _b !== void 0 ? _b : "—",
                        line: null,
                    });
                }), rows.length);
            }
            default:
                return res.code(400).send({ message: "Unknown log type" });
        }
    }
    catch (error) {
        console.error("[adminLogs]", error);
        return res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.adminLogs = adminLogs;
