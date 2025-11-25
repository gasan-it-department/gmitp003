// utils/encryption.ts
import {
  scrypt,
  randomFill,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const randomFillAsync = promisify(randomFill);

const algorithm = "aes-192-cbc";
const password = process.env.JWT_SECRET || "your-secure-password";
console.log(password);

export interface EncryptedData {
  encryptedData: string;
  iv: string;
}

export class EncryptionService {
  static async encrypt(text: string): Promise<EncryptedData> {
    try {
      const key = (await scryptAsync(password, "salt", 24)) as Buffer;

      const iv = (await randomFillAsync(new Uint8Array(16))) as Uint8Array;

      const cipher = createCipheriv(algorithm, key, iv);

      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");

      return {
        encryptedData: encrypted,
        iv: Buffer.from(iv).toString("hex"),
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  static async decrypt(encryptedData: string, ivHex: string): Promise<string> {
    try {
      const key = (await scryptAsync(password, "salt", 24)) as Buffer;

      const iv = Buffer.from(ivHex, "hex");

      const decipher = createDecipheriv(algorithm, key, iv);

      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`);
    }
  }
}
