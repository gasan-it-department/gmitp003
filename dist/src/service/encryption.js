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
exports.EncryptionService = void 0;
// utils/encryption.ts
const node_crypto_1 = require("node:crypto");
const node_util_1 = require("node:util");
const scryptAsync = (0, node_util_1.promisify)(node_crypto_1.scrypt);
const randomFillAsync = (0, node_util_1.promisify)(node_crypto_1.randomFill);
const algorithm = "aes-192-cbc";
const password = process.env.JWT_SECRET || "your-secure-password";
class EncryptionService {
    static encrypt(text) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const key = (yield scryptAsync(password, "salt", 24));
                const iv = (yield randomFillAsync(new Uint8Array(16)));
                const cipher = (0, node_crypto_1.createCipheriv)(algorithm, key, iv);
                let encrypted = cipher.update(text, "utf8", "hex");
                encrypted += cipher.final("hex");
                return {
                    encryptedData: encrypted,
                    iv: Buffer.from(iv).toString("hex"),
                };
            }
            catch (error) {
                throw new Error(`Encryption failed: ${error}`);
            }
        });
    }
    static decrypt(encryptedData, ivHex) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const key = (yield scryptAsync(password, "salt", 24));
                const iv = Buffer.from(ivHex, "hex");
                const decipher = (0, node_crypto_1.createDecipheriv)(algorithm, key, iv);
                let decrypted = decipher.update(encryptedData, "hex", "utf8");
                decrypted += decipher.final("utf8");
                return decrypted;
            }
            catch (error) {
                throw new Error(`Decryption failed: ${error}`);
            }
        });
    }
}
exports.EncryptionService = EncryptionService;
