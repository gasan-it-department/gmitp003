"use strict";
// Thin wrapper around Expo's push notification HTTP API.
//
// Why Expo's service: it's the standard recommended path for SDK-based
// apps. We don't have to ship FCM/APNs keys to the backend; Expo fans
// the message out to both. Tokens are obtained client-side via
// `expo-notifications` and registered with our /push/register endpoint.
//
// Doc: https://docs.expo.dev/push-notifications/sending-notifications/
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
exports.sendPushToUser = void 0;
const prisma_1 = require("../barrel/prisma");
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const isExpoToken = (t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");
/**
 * Look up every push token for the given user and fire a push to each.
 * Returns silently if the user has no registered tokens — the in-app
 * socket path will still deliver while the app is open.
 *
 * Tokens that come back as "DeviceNotRegistered" are pruned from the
 * database so we don't keep retrying dead devices on every notification.
 */
const sendPushToUser = (userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const tokens = yield prisma_1.prisma.pushToken.findMany({
        where: { userId },
        select: { token: true },
    });
    if (tokens.length === 0)
        return;
    const valid = tokens.map((t) => t.token).filter(isExpoToken);
    if (valid.length === 0)
        return;
    const messages = valid.map((to) => {
        var _a, _b, _c, _d;
        return ({
            to,
            title: payload.title,
            body: payload.body,
            data: (_a = payload.data) !== null && _a !== void 0 ? _a : {},
            sound: (_b = payload.sound) !== null && _b !== void 0 ? _b : "default",
            priority: (_c = payload.priority) !== null && _c !== void 0 ? _c : "high",
            channelId: (_d = payload.channelId) !== null && _d !== void 0 ? _d : "default",
        });
    });
    try {
        const res = yield fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Accept-encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(messages),
        });
        if (!res.ok) {
            console.warn("[expoPush] HTTP", res.status, yield res.text().catch(() => ""));
            return;
        }
        const body = (yield res.json().catch(() => null));
        const tickets = (_a = body === null || body === void 0 ? void 0 : body.data) !== null && _a !== void 0 ? _a : [];
        const dead = [];
        tickets.forEach((ticket, idx) => {
            var _a;
            if ((ticket === null || ticket === void 0 ? void 0 : ticket.status) === "error" &&
                ((_a = ticket.details) === null || _a === void 0 ? void 0 : _a.error) === "DeviceNotRegistered") {
                dead.push(valid[idx]);
            }
            else if ((ticket === null || ticket === void 0 ? void 0 : ticket.status) === "error") {
                console.warn("[expoPush] ticket error", ticket);
            }
        });
        if (dead.length > 0) {
            yield prisma_1.prisma.pushToken
                .deleteMany({ where: { token: { in: dead } } })
                .catch((e) => console.warn("[expoPush] cleanup failed", e));
        }
    }
    catch (e) {
        console.warn("[expoPush] send failed", e);
    }
});
exports.sendPushToUser = sendPushToUser;
