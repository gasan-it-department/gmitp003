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
exports.removeRoomMember = exports.updateRoomMember = exports.addRoomMembers = exports.updateRoomConfig = exports.roomCandidates = exports.roomConfig = exports.roomMemberLabel = exports.ROOM_MEMBER_TYPES = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const handler_1 = require("../middleware/handler");
const notificationEvents_1 = require("../service/notificationEvents");
const encryption_1 = require("../service/encryption");
/**
 * Document room configuration.
 *
 * A ReceivingRoom is identified by `code` (its name, unique across the
 * system) and carries an `address` plus a membership list of
 * RoomAuthorizedUser rows. `type` distinguishes what a member may do:
 *
 *   0  owner       — created or was granted the room; full control
 *   1  signatory   — may sign documents in this room
 *   2  receiver    — may receive/act on documents routed here
 *
 * Everything here is scoped to the caller's line, and every membership change
 * notifies the person concerned: being made a signatory on a document room is
 * an authority change, not a silent bit-flip.
 */
exports.ROOM_MEMBER_TYPES = {
    owner: 0,
    signatory: 1,
    receiver: 2,
};
const roomMemberLabel = (type) => type === exports.ROOM_MEMBER_TYPES.owner
    ? "Owner"
    : type === exports.ROOM_MEMBER_TYPES.receiver
        ? "Receiver"
        : "Signatory";
exports.roomMemberLabel = roomMemberLabel;
const dec = (d, iv) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!d)
        return "";
    if (!iv)
        return d;
    try {
        return (_a = (yield encryption_1.EncryptionService.decrypt(d, iv))) !== null && _a !== void 0 ? _a : "";
    }
    catch (_b) {
        return d;
    }
});
const callerLine = (req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const accountId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    if (!accountId)
        return null;
    const a = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { lineId: true, User: { select: { lineId: true } } },
    });
    return (_d = (_b = a === null || a === void 0 ? void 0 : a.lineId) !== null && _b !== void 0 ? _b : (_c = a === null || a === void 0 ? void 0 : a.User) === null || _c === void 0 ? void 0 : _c.lineId) !== null && _d !== void 0 ? _d : null;
});
/** Resolves a room the caller's line actually owns. */
const ownedRoom = (req, roomId) => __awaiter(void 0, void 0, void 0, function* () {
    const lineId = yield callerLine(req);
    if (!lineId)
        throw new errors_1.UnauthorizedError("No line for this account");
    const room = yield prisma_1.prisma.receivingRoom.findFirst({
        where: { id: roomId, lineId },
        select: { id: true, code: true, address: true, lineId: true, status: true },
    });
    if (!room)
        throw new errors_1.NotFoundError("Document room not found");
    return { room, lineId };
});
/** Best-effort notify + email. Never lets a delivery failure undo the change. */
const tellMember = (userId, actorId, title, content) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        yield (0, notificationEvents_1.createUserNotification)(prisma_1.prisma, {
            recipientId: userId,
            title,
            content,
            senderId: actorId,
        });
    }
    catch (e) {
        console.warn("[roomConfig] notification failed:", e);
    }
    try {
        const u = yield prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, lastName: true, email: true, emailIv: true },
        });
        const to = yield dec(u === null || u === void 0 ? void 0 : u.email, u === null || u === void 0 ? void 0 : u.emailIv);
        if (!to)
            return;
        yield (0, handler_1.sendEmail)(title, to, `Good day ${(_a = u === null || u === void 0 ? void 0 : u.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = u === null || u === void 0 ? void 0 : u.lastName) !== null && _b !== void 0 ? _b : ""},

${content}

You can see the room in the portal under Document Room.

Human Resources Office
LGU Gasan`, "Gasan LGU HR");
    }
    catch (e) {
        console.warn("[roomConfig] email failed:", e);
    }
});
// ── Read ───────────────────────────────────────────────────────────────────
/** GET /document/room/config?roomId= — the room plus its membership. */
const roomConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const { roomId } = req.query;
    if (!roomId)
        throw new errors_1.ValidationError("roomId is required");
    const { room } = yield ownedRoom(req, roomId);
    const members = yield prisma_1.prisma.roomAuthorizedUser.findMany({
        where: { receivingRoomId: room.id, status: 1 },
        select: {
            id: true,
            type: true,
            timestamp: true,
            userId: true,
            user: {
                select: {
                    id: true,
                    firstName: true,
                    firstNameIv: true,
                    lastName: true,
                    lastNameIv: true,
                    username: true,
                    profilePicture: true,
                    Position: { select: { name: true } },
                    department: { select: { name: true } },
                },
            },
        },
        orderBy: [{ type: "asc" }, { timestamp: "asc" }],
    });
    const list = [];
    for (const m of members) {
        const first = yield dec((_a = m.user) === null || _a === void 0 ? void 0 : _a.firstName, (_b = m.user) === null || _b === void 0 ? void 0 : _b.firstNameIv);
        const last = yield dec((_c = m.user) === null || _c === void 0 ? void 0 : _c.lastName, (_d = m.user) === null || _d === void 0 ? void 0 : _d.lastNameIv);
        list.push({
            id: m.id,
            userId: m.userId,
            type: m.type,
            role: (0, exports.roomMemberLabel)(m.type),
            addedAt: m.timestamp,
            name: `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() ||
                ((_e = m.user) === null || _e === void 0 ? void 0 : _e.username) ||
                "Unnamed",
            position: (_h = (_g = (_f = m.user) === null || _f === void 0 ? void 0 : _f.Position) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
            office: (_l = (_k = (_j = m.user) === null || _j === void 0 ? void 0 : _j.department) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : null,
            profilePicture: (_o = (_m = m.user) === null || _m === void 0 ? void 0 : _m.profilePicture) !== null && _o !== void 0 ? _o : null,
        });
    }
    return res.code(200).send({ room, members: list });
});
exports.roomConfig = roomConfig;
/**
 * GET /document/room/config/candidates?roomId=&query=
 *
 * Line staff who could be added. People already in the room are marked rather
 * than hidden, so HR can see why someone is missing from the results.
 */
/**
 * Which OTHER room each of these people already belongs to.
 *
 * A person belongs to one document room. Their room is where their work
 * arrives and where their signature authority sits, so being in two makes
 * "route this to them" ambiguous and quietly splits their queue in half.
 *
 * `exceptRoomId` is the room being edited: membership there is not a clash,
 * and neither is a membership that was removed (status 0) — re-adding
 * someone you took out has to keep working.
 */
const otherRoomOf = (userIds, exceptRoomId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const out = new Map();
    if (!userIds.length)
        return out;
    const rows = yield prisma_1.prisma.roomAuthorizedUser.findMany({
        where: {
            userId: { in: userIds },
            status: 1,
            receivingRoomId: { not: null },
            NOT: { receivingRoomId: exceptRoomId },
        },
        select: {
            userId: true,
            receivingRoom: { select: { id: true, code: true } },
        },
    });
    for (const r of rows) {
        if (!r.userId || !r.receivingRoom)
            continue;
        if (out.has(r.userId))
            continue;
        out.set(r.userId, {
            id: r.receivingRoom.id,
            code: (_a = r.receivingRoom.code) !== null && _a !== void 0 ? _a : "another room",
        });
    }
    return out;
});
const roomCandidates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const q = req.query;
    if (!q.roomId)
        throw new errors_1.ValidationError("roomId is required");
    const { room, lineId } = yield ownedRoom(req, q.roomId);
    const term = (q.query || "").trim().toLowerCase();
    const already = new Set((yield prisma_1.prisma.roomAuthorizedUser.findMany({
        where: { receivingRoomId: room.id, status: 1 },
        select: { userId: true },
    }))
        .map((r) => r.userId)
        .filter((x) => !!x));
    const users = yield prisma_1.prisma.user.findMany({
        where: { lineId, active: 1, archivedAt: null },
        select: {
            id: true,
            firstName: true,
            firstNameIv: true,
            lastName: true,
            lastNameIv: true,
            username: true,
            profilePicture: true,
            Position: { select: { name: true } },
            department: { select: { name: true } },
        },
        take: 600,
    });
    // Anyone already in a different room cannot be added here, so the list
    // says so instead of offering them and failing on save.
    const taken = yield otherRoomOf(users.map((u) => u.id), room.id);
    const out = [];
    for (const u of users) {
        const first = yield dec(u.firstName, u.firstNameIv);
        const last = yield dec(u.lastName, u.lastNameIv);
        const name = `${last}, ${first}`.replace(/^,\s*|,\s*$/g, "").trim() ||
            u.username ||
            "Unnamed";
        if (term &&
            !`${name} ${(_b = (_a = u.Position) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = u.department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : ""}`
                .toLowerCase()
                .includes(term))
            continue;
        out.push({
            id: u.id,
            name,
            position: (_f = (_e = u.Position) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : null,
            office: (_h = (_g = u.department) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null,
            profilePicture: (_j = u.profilePicture) !== null && _j !== void 0 ? _j : null,
            added: already.has(u.id),
            /** The room they are already in, if it is not this one. */
            inRoom: (_k = taken.get(u.id)) !== null && _k !== void 0 ? _k : null,
        });
        if (out.length >= 200)
            break;
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.code(200).send({ candidates: out });
});
exports.roomCandidates = roomCandidates;
// ── Rename / re-address ────────────────────────────────────────────────────
/** PATCH /document/room/config { roomId, code?, address? } */
const updateRoomConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const b = req.body;
    if (!b.roomId)
        throw new errors_1.ValidationError("roomId is required");
    const { room, lineId } = yield ownedRoom(req, b.roomId);
    const actorId = yield (0, handler_1.callerUserId)(req);
    const data = {};
    if (b.code !== undefined) {
        const code = b.code.trim();
        if (!code)
            throw new errors_1.ValidationError("The room needs a name");
        if (code.length > 80)
            throw new errors_1.ValidationError("That room name is too long");
        // `code` is globally unique — catch the clash here so the user gets a
        // sentence instead of a Prisma P2002.
        if (code.toLowerCase() !== room.code.toLowerCase()) {
            const clash = yield prisma_1.prisma.receivingRoom.findUnique({
                where: { code },
                select: { id: true },
            });
            if (clash && clash.id !== room.id)
                throw new errors_1.ValidationError(`Another document room is already named "${code}".`);
        }
        data.code = code;
    }
    if (b.address !== undefined)
        data.address = b.address.trim() || null;
    if (!Object.keys(data).length)
        throw new errors_1.ValidationError("Nothing to change");
    try {
        const updated = yield prisma_1.prisma.receivingRoom.update({
            where: { id: room.id },
            data,
            select: { id: true, code: true, address: true },
        });
        yield prisma_1.prisma.humanResourcesLogs
            .create({
            data: {
                action: "UPDATE",
                desc: `DOCUMENT ROOM updated -> ${room.code}${data.code ? ` renamed to ${updated.code}` : ""}`,
                lineId,
                userId: actorId !== null && actorId !== void 0 ? actorId : "",
            },
        })
            .catch((e) => console.warn("[roomConfig] log failed:", e));
        return res.code(200).send(updated);
    }
    catch (e) {
        if (e instanceof prisma_1.Prisma.PrismaClientKnownRequestError)
            throw (0, errors_1.dbError)(e);
        throw e;
    }
});
exports.updateRoomConfig = updateRoomConfig;
// ── Membership ─────────────────────────────────────────────────────────────
/** POST /document/room/config/members { roomId, userIds[], type } */
const addRoomMembers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const b = req.body;
    if (!b.roomId)
        throw new errors_1.ValidationError("roomId is required");
    const { room, lineId } = yield ownedRoom(req, b.roomId);
    const actorId = yield (0, handler_1.callerUserId)(req);
    const type = Number((_a = b.type) !== null && _a !== void 0 ? _a : exports.ROOM_MEMBER_TYPES.signatory);
    if (![0, 1, 2].includes(type))
        throw new errors_1.ValidationError("Pick signatory or receiver");
    const ids = [...new Set(Array.isArray(b.userIds) ? b.userIds : [])];
    if (!ids.length)
        throw new errors_1.ValidationError("Pick at least one person");
    // The candidate list already hides these, but a list is a hint and this
    // is the rule: one person, one room.
    const taken = yield otherRoomOf(ids, room.id);
    let added = 0;
    const notified = [];
    /** Who was refused, and which room already has them. */
    const skipped = [];
    for (const userId of ids) {
        // Line-scoped: a room can never be handed to someone from another office.
        const u = yield prisma_1.prisma.user.findFirst({
            where: { id: userId, lineId },
            select: { id: true },
        });
        if (!u)
            continue;
        const clash = taken.get(userId);
        if (clash) {
            skipped.push({ userId, room: clash.code });
            continue;
        }
        const existing = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
            where: { receivingRoomId: room.id, userId },
            select: { id: true, type: true, status: true },
        });
        if (existing) {
            // Re-adding someone who was removed reinstates them; changing their role
            // updates it. Either way it is one membership row, never a duplicate.
            if (existing.status === 1 && existing.type === type)
                continue;
            yield prisma_1.prisma.roomAuthorizedUser.update({
                where: { id: existing.id },
                data: { type, status: 1 },
            });
        }
        else {
            yield prisma_1.prisma.roomAuthorizedUser.create({
                data: { receivingRoomId: room.id, userId, type, status: 1 },
            });
        }
        added++;
        notified.push(userId);
    }
    // Notify outside the write loop so a slow mail server cannot stall the save.
    for (const userId of notified) {
        void tellMember(userId, actorId, `Added to ${room.code}`, `You have been added to the document room "${room.code}" as a ${(0, exports.roomMemberLabel)(type).toLowerCase()}.`);
    }
    yield prisma_1.prisma.humanResourcesLogs
        .create({
        data: {
            action: "CREATE",
            desc: `DOCUMENT ROOM ${room.code} -> added ${added} ${(0, exports.roomMemberLabel)(type).toLowerCase()}(s)`,
            lineId,
            userId: actorId !== null && actorId !== void 0 ? actorId : "",
        },
    })
        .catch(() => undefined);
    return res.code(200).send({ added, notified: notified.length, skipped });
});
exports.addRoomMembers = addRoomMembers;
/** PATCH /document/room/config/member { roomId, memberId, type } */
const updateRoomMember = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const b = req.body;
    if (!b.roomId || !b.memberId)
        throw new errors_1.ValidationError("roomId and memberId are required");
    const { room } = yield ownedRoom(req, b.roomId);
    const actorId = yield (0, handler_1.callerUserId)(req);
    const type = Number(b.type);
    if (![0, 1, 2].includes(type))
        throw new errors_1.ValidationError("Unknown role");
    const member = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
        where: { id: b.memberId, receivingRoomId: room.id },
        select: { id: true, userId: true, type: true },
    });
    if (!member)
        throw new errors_1.NotFoundError("That person is not in this room");
    if (member.type === type)
        return res.code(200).send({ message: "OK" });
    // Never leave a room with nobody who can administer it.
    if (member.type === exports.ROOM_MEMBER_TYPES.owner) {
        const owners = yield prisma_1.prisma.roomAuthorizedUser.count({
            where: {
                receivingRoomId: room.id,
                type: exports.ROOM_MEMBER_TYPES.owner,
                status: 1,
            },
        });
        if (owners <= 1)
            throw new errors_1.ValidationError("This is the room's only owner. Make someone else an owner first.");
    }
    yield prisma_1.prisma.roomAuthorizedUser.update({
        where: { id: member.id },
        data: { type },
    });
    if (member.userId)
        void tellMember(member.userId, actorId, `Your role in ${room.code} changed`, `You are now a ${(0, exports.roomMemberLabel)(type).toLowerCase()} in the document room "${room.code}".`);
    return res.code(200).send({ message: "OK", type });
});
exports.updateRoomMember = updateRoomMember;
/** DELETE /document/room/config/member?roomId=&memberId= */
const removeRoomMember = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.roomId || !q.memberId)
        throw new errors_1.ValidationError("roomId and memberId are required");
    const { room } = yield ownedRoom(req, q.roomId);
    const actorId = yield (0, handler_1.callerUserId)(req);
    const member = yield prisma_1.prisma.roomAuthorizedUser.findFirst({
        where: { id: q.memberId, receivingRoomId: room.id },
        select: { id: true, userId: true, type: true },
    });
    if (!member)
        throw new errors_1.NotFoundError("That person is not in this room");
    if (member.type === exports.ROOM_MEMBER_TYPES.owner) {
        const owners = yield prisma_1.prisma.roomAuthorizedUser.count({
            where: {
                receivingRoomId: room.id,
                type: exports.ROOM_MEMBER_TYPES.owner,
                status: 1,
            },
        });
        if (owners <= 1)
            throw new errors_1.ValidationError("This is the room's only owner — the room would be left with nobody in charge.");
    }
    // Soft-remove: their signatures and past actions in this room stay
    // attributable. A hard delete would cascade the audit trail away.
    yield prisma_1.prisma.roomAuthorizedUser.update({
        where: { id: member.id },
        data: { status: 0 },
    });
    if (member.userId)
        void tellMember(member.userId, actorId, `Removed from ${room.code}`, `You no longer have access to the document room "${room.code}".`);
    return res.code(200).send({ message: "OK" });
});
exports.removeRoomMember = removeRoomMember;
