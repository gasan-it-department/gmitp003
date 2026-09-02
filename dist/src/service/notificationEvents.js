"use strict";
// Thin wrapper around `tx.notification.create` that also pushes a
// real-time `notification:user-new` event over the socket so the
// recipient's UI can update without polling.
//
// Lives in `service/` so controllers don't need to know about the socket
// instance — they just write notifications the way they always have, and
// the side-effect happens automatically.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.createUserNotification = createUserNotification;
/**
 * Create a Notification row inside the given transaction and emit it
 * over the socket once the row has an id and createdAt. The emit
 * happens *inside* the transaction callback, but Socket.IO is fire-and-
 * forget at the network layer, so a later transaction rollback won't
 * surface as a phantom "you got a notification" toast unless the client
 * acts on the payload speculatively (it doesn't — the UI invalidates
 * its query and re-reads).
 */
function createUserNotification(tx, data) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const row = yield tx.notification.create({
            data: {
                recipientId: data.recipientId,
                title: data.title,
                content: data.content,
                path: (_a = data.path) !== null && _a !== void 0 ? _a : null,
                senderId: (_b = data.senderId) !== null && _b !== void 0 ? _b : null,
            },
            select: {
                id: true,
                title: true,
                content: true,
                path: true,
                createdAt: true,
                isRead: true,
                recipientId: true,
            },
        });
        try {
            const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
            notificationSocket.emitUserNotification(row.recipientId, {
                id: row.id,
                title: row.title,
                content: row.content,
                path: row.path,
                createdAt: row.createdAt.toISOString(),
                isRead: row.isRead,
            });
        }
        catch (e) {
            // Socket failures must never break the DB transaction.
            console.warn("[notificationEvents] emit failed:", e);
        }
        // Fire OS-level push to every device the recipient has registered.
        // Runs after the socket emit so a slow push call doesn't delay the
        // in-app banner; we intentionally don't await so socket + push can
        // race and the transaction returns promptly.
        void (() => __awaiter(this, void 0, void 0, function* () {
            try {
                const { sendPushToUser } = yield Promise.resolve().then(() => __importStar(require("./expoPush")));
                yield sendPushToUser(row.recipientId, {
                    title: row.title,
                    body: row.content,
                    data: {
                        notificationId: row.id,
                        path: row.path,
                        createdAt: row.createdAt.toISOString(),
                    },
                });
            }
            catch (e) {
                console.warn("[notificationEvents] push failed:", e);
            }
        }))();
        return row;
    });
}
