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
Object.defineProperty(exports, "__esModule", { value: true });
exports.semaphoreService = exports.SemaphoreService = exports.semaphoreKey = void 0;
// services/semaphoreService.ts
const axios_1 = __importDefault(require("axios"));
exports.semaphoreKey = process.env.SEMAPHORE_API_KEY;
class SemaphoreService {
    constructor(apiKey) {
        this.baseURL = "https://api.semaphore.co/api/v4/messages";
        this.apiKey = apiKey;
    }
    sendSMS(options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            try {
                const { number, message, sendername = "SEMAPHORE" } = options;
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
                console.log("Success", number);
                return {
                    success: true,
                    data: response.data,
                    status: response.status,
                };
            }
            catch (error) {
                console.error("Semaphore SMS error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                return {
                    success: false,
                    error: ((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.message) || error.message,
                    status: ((_d = error.response) === null || _d === void 0 ? void 0 : _d.status) || 500,
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
