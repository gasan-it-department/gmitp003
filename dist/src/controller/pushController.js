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
exports.unregisterPushToken = exports.registerPushToken = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
/**
 * Mobile sends its Expo push token here after each successful login.
 * Idempotent: if the same token was previously registered (possibly
 * under a different user, e.g. shared device), we just rewrite the
 * userId and touch lastSeenAt.
 */
const registerPushToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.token) || !(body === null || body === void 0 ? void 0 : body.userId)) {
        throw new errors_1.ValidationError("BAD_REQUEST: token and userId are required");
    }
    if (!body.token.startsWith("ExponentPushToken[") &&
        !body.token.startsWith("ExpoPushToken[")) {
        throw new errors_1.ValidationError("BAD_REQUEST: not a valid Expo push token");
    }
    const row = yield prisma_1.prisma.pushToken.upsert({
        where: { token: body.token },
        create: {
            token: body.token,
            userId: body.userId,
            platform: (_a = body.platform) !== null && _a !== void 0 ? _a : null,
            deviceName: (_b = body.deviceName) !== null && _b !== void 0 ? _b : null,
        },
        update: {
            userId: body.userId,
            platform: (_c = body.platform) !== null && _c !== void 0 ? _c : null,
            deviceName: (_d = body.deviceName) !== null && _d !== void 0 ? _d : null,
            lastSeenAt: new Date(),
        },
        select: { id: true, lastSeenAt: true },
    });
    return res.code(200).send({ ok: true, id: row.id, lastSeenAt: row.lastSeenAt });
});
exports.registerPushToken = registerPushToken;
/**
 * Called on logout (or when the mobile detects the token has been
 * revoked). Best-effort — if the token isn't found we still 200.
 */
const unregisterPushToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.token)) {
        throw new errors_1.ValidationError("BAD_REQUEST: token is required");
    }
    yield prisma_1.prisma.pushToken
        .deleteMany({ where: { token: body.token } })
        .catch(() => undefined);
    return res.code(200).send({ ok: true });
});
exports.unregisterPushToken = unregisterPushToken;
