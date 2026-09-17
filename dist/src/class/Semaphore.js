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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.semaphoreService = exports.SemaphoreService = exports.readGatewayError = exports.SEMAPHORE_SENDER = exports.semaphoreKey = void 0;
// services/semaphoreService.ts
const axios_1 = __importDefault(require("axios"));
exports.semaphoreKey = process.env.SEMAPHORE_API_KEY;
/**
 * The sender name every message goes out under.
 *
 * Semaphore only accepts sender names REGISTERED to the account. Two call
 * sites were passing "Gasan", which is not one of ours, and every message
 * they sent came back "The selected sendername is invalid." — silently, see
 * below. Configurable because the registered name belongs to the account,
 * not to the code; "SEMAPHORE" is the universal default and always works.
 *
 * Check what this account may use:
 *   GET https://api.semaphore.co/api/v4/account/sendernames?apikey=…
 */
exports.SEMAPHORE_SENDER = ((_a = process.env.SEMAPHORE_SENDER_NAME) === null || _a === void 0 ? void 0 : _a.trim()) || "SEMAPHORE";
/**
 * Turn a Semaphore error body into one readable line.
 *
 * Failures come back as `{ field: ["what is wrong"] }` — for example
 * `{"number":["The number format is invalid."]}` — and NOT as
 * `{ message }`. Every reader of this service was looking for `message`,
 * found nothing, and fell back to a generic string, so the one piece of
 * information worth having was thrown away at the door.
 */
const readGatewayError = (data, fallback) => {
    if (typeof data === "string" && data.trim())
        return data.trim();
    if (data && typeof data === "object") {
        const d = data;
        if (typeof d.message === "string" && d.message.trim())
            return d.message;
        const parts = [];
        for (const [field, val] of Object.entries(d)) {
            const msgs = Array.isArray(val) ? val : [val];
            for (const m of msgs) {
                if (typeof m === "string" && m.trim()) {
                    parts.push(field === "message" ? m : `${field}: ${m}`);
                }
            }
        }
        if (parts.length)
            return parts.join("; ");
    }
    return fallback;
};
exports.readGatewayError = readGatewayError;
class SemaphoreService {
    constructor(apiKey) {
        this.baseURL = "https://api.semaphore.co/api/v4/messages";
        this.apiKey = apiKey;
    }
    sendSMS(options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            try {
                const { number, message, sendername = exports.SEMAPHORE_SENDER } = options;
                // Convert array to comma-separated string if needed
                const numberString = Array.isArray(number) ? number.join(",") : number;
                const response = yield axios_1.default.post(this.baseURL, null, {
                    params: {
                        apikey: this.apiKey,
                        number: numberString,
                        message,
                        sendername,
                    },
                    paramsSerializer: {
                        indexes: null, // Don't use array format for params
                    },
                });
                /**
                  * A 2xx is not automatically a delivery.
                  *
                  * Semaphore answers with one object per recipient; a rejected one
                  * carries status "Failed". Treating every 2xx as success reported
                  * messages as sent that the gateway had already given up on.
                  */
                const rows = Array.isArray(response.data)
                    ? response.data
                    : [response.data];
                const failed = rows.filter((m) => typeof (m === null || m === void 0 ? void 0 : m.status) === "string" && /fail|reject/i.test(m.status));
                if (rows.length > 0 && failed.length === rows.length) {
                    return {
                        success: false,
                        error: `Gateway reported ${(_b = (_a = failed[0]) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : "Failed"}`,
                        data: response.data,
                        status: response.status,
                    };
                }
                return {
                    success: true,
                    data: response.data,
                    status: response.status,
                };
            }
            catch (error) {
                console.error("Semaphore SMS error:", ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
                return {
                    success: false,
                    error: (0, exports.readGatewayError)((_d = error.response) === null || _d === void 0 ? void 0 : _d.data, error.message),
                    status: ((_e = error.response) === null || _e === void 0 ? void 0 : _e.status) || 500,
                };
            }
        });
    }
    // Send to multiple numbers (alias for sendSMS)
    sendBulkSMS(numbers, message, sendername) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendSMS({
                number: numbers,
                message,
                sendername,
            });
        });
    }
    // Send to single number
    sendSingleSMS(number, message, sendername) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendSMS({
                number,
                message,
                sendername,
            });
        });
    }
}
exports.SemaphoreService = SemaphoreService;
// Create singleton instance
exports.semaphoreService = new SemaphoreService(process.env.SEMAPHORE_API_KEY || "");
