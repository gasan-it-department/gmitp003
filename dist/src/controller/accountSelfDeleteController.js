"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.selfDeleteAccount = void 0;
const prisma_1 = require("../barrel/prisma");
const errors_1 = require("../errors/errors");
const argon2_1 = __importDefault(require("argon2"));
/**
 * Self-service account deletion.
 *
 * App Store Review 5.1.1(v) requires an app that has accounts to let the
 * person delete theirs from inside the app. This is that endpoint.
 *
 * What it does NOT do is erase the employee. This is a local-government HR
 * system: attendance, leave, payroll, signed documents and the audit trail
 * behind them are public records the LGU is obliged to keep, and an employee
 * cannot unilaterally destroy them. So:
 *
 *   deleted  — the login account. Credentials are gone, sessions are killed,
 *              push tokens are removed, and the app can no longer be used.
 *   retained — the employment record itself, under the LGU's records
 *              retention obligations.
 *
 * The app states this plainly before asking for confirmation. Apple accepts a
 * deletion that discloses legally-required retention; it does not accept a
 * button that quietly does nothing.
 *
 * The Account row is NEVER deleted, and that is deliberate:
 * `User.account` is declared `onDelete: Cascade`, so dropping the account row
 * takes the employee with it — and everything hanging off the employee:
 * attendance, leave, documents, signatures, the lot. A person tapping "delete
 * my account" must not be able to erase public records. Verified by
 * e2e_self_delete.ts, which failed loudly the first time this was written the
 * obvious way.
 *
 * Instead the account is permanently neutralised: the password is replaced
 * with a hash of a value nobody holds, the username is retired (freeing the
 * original), and the row is marked inactive. There is no way back in, and no
 * path that resurrects it — HR would have to issue a new account.
 */
const selfDeleteAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const body = ((_a = req.body) !== null && _a !== void 0 ? _a : {});
    const accountId = (_b = req.user) === null || _b === void 0 ? void 0 : _b.id;
    if (!accountId)
        throw new errors_1.UnauthorizedError("Not signed in");
    // Two deliberate speed bumps: the exact word, and the password. Deleting an
    // account is not something to lose to a mis-tap.
    if (((_c = body.confirm) !== null && _c !== void 0 ? _c : "").trim().toUpperCase() !== "DELETE")
        throw new errors_1.ValidationError('Type DELETE to confirm.');
    if (!body.password)
        throw new errors_1.ValidationError("Enter your password to confirm.");
    const account = yield prisma_1.prisma.account.findUnique({
        where: { id: accountId },
        select: {
            id: true,
            username: true,
            password: true,
            User: { select: { id: true } },
        },
    });
    if (!account)
        throw new errors_1.UnauthorizedError("Account not found");
    let valid = false;
    try {
        valid = yield argon2_1.default.verify(account.password, body.password);
    }
    catch (_f) {
        valid = false;
    }
    if (!valid)
        throw new errors_1.UnauthorizedError("That password is not correct.");
    const userId = (_e = (_d = account.User) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : null;
    // Stop the phone being reachable regardless of which branch we end up in.
    if (userId) {
        yield prisma_1.prisma.pushToken
            .deleteMany({ where: { userId } })
            .catch((e) => console.warn("[selfDelete] push token cleanup failed", e));
    }
    // Retire the credentials in place. See the note above: deleting the row
    // would cascade to the User and take the employment record with it.
    const retired = `deleted_${account.id.slice(0, 8)}_${Date.now()}`;
    yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
        yield tx.accountResetLink.deleteMany({ where: { accountId } });
        yield tx.account.update({
            where: { id: accountId },
            data: {
                // A hash of something nobody holds the input to. Not an empty string:
                // a blank password is the kind of value a later `if (!password)`
                // branch mistakes for "no password required".
                password: yield argon2_1.default.hash(`${account.id}:${Date.now()}:${Math.random()}`),
                username: retired,
                active: false,
                status: 2,
            },
        });
    }));
    if (userId) {
        try {
            const { notificationSocket } = yield Promise.resolve().then(() => __importStar(require("..")));
            notificationSocket.emitForceLogout(userId, "Your account has been deleted at your request.");
        }
        catch (e) {
            console.warn("[selfDelete] force-logout emit failed", e);
        }
    }
    return res.code(200).send({
        message: "OK",
        outcome: "deleted",
        // Said out loud so the app can repeat it rather than inventing wording.
        retained: "Employment records the LGU is required to keep are retained; your login has been removed.",
    });
});
exports.selfDeleteAccount = selfDeleteAccount;
