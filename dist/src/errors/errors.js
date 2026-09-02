"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnauthorizedError = exports.ValidationError = exports.NotFoundError = exports.AppError = void 0;
exports.dbError = dbError;
// errors/appError.ts
class AppError extends Error {
    constructor(message, statusCode = 500, code) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
    }
}
exports.AppError = AppError;
// Specific error types
class NotFoundError extends AppError {
    constructor(message = "Resource not found") {
        super(message, 404, "NOT_FOUND");
    }
}
exports.NotFoundError = NotFoundError;
class ValidationError extends AppError {
    constructor(message = "Validation failed") {
        super(message, 400, "VALIDATION_ERROR");
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends AppError {
    constructor(message = "Unauthorized") {
        super(message, 401, "UNAUTHORIZED");
    }
}
exports.UnauthorizedError = UnauthorizedError;
/**
 * Turn a caught Prisma error into a clear, thrown AppError — instead of the
 * opaque `DB_CONNECTION_EROR`/`DB_CONNECTION_FAILED` masks that hid the real
 * cause across the HR module. Logs the real Prisma code + meta (so it's in the
 * server logs) and maps the common ones to friendly 400s. Anything else becomes
 * a 500 that at least CARRIES the Prisma code.
 *
 * Usage in a controller catch:
 *   } catch (error) {
 *     if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
 *     throw dbError(error, "add position");
 *   }
 */
function dbError(error, action = "operation") {
    var _a, _b, _c;
    // Re-surface our own typed errors untouched.
    if (error instanceof AppError)
        return error;
    const anyErr = error;
    const code = anyErr === null || anyErr === void 0 ? void 0 : anyErr.code;
    const meta = anyErr === null || anyErr === void 0 ? void 0 : anyErr.meta;
    // Prisma known-request errors carry a Pxxxx code.
    if (typeof code === "string" && /^P\d{4}$/.test(code)) {
        console.error(`[dbError] ${action} failed:`, code, JSON.stringify(meta));
        switch (code) {
            case "P2002": {
                const target = (_a = meta === null || meta === void 0 ? void 0 : meta.target) !== null && _a !== void 0 ? _a : "field";
                return new ValidationError(`That ${Array.isArray(target) ? target.join(", ") : target} already exists.`);
            }
            case "P2003": {
                const field = (_b = meta === null || meta === void 0 ? void 0 : meta.field_name) !== null && _b !== void 0 ? _b : "reference";
                return new ValidationError(`A linked record is missing or invalid (${field}). ` +
                    `Pick a valid value and try again.`);
            }
            case "P2011":
                return new ValidationError("A required field was left empty.");
            case "P2025":
                return new NotFoundError((_c = meta === null || meta === void 0 ? void 0 : meta.cause) !== null && _c !== void 0 ? _c : "The record was not found.");
            default:
                return new AppError(`Database error (${code}) while ${action}.`, 500, "DB_ERROR");
        }
    }
    // Prisma validation errors (unknown field, bad type) come as a class, no code.
    if ((anyErr === null || anyErr === void 0 ? void 0 : anyErr.name) === "PrismaClientValidationError") {
        console.error(`[dbError] ${action} — invalid query:`, anyErr.message);
        return new AppError(`Invalid request while ${action}.`, 400, "BAD_REQUEST");
    }
    console.error(`[dbError] ${action} — unexpected:`, error);
    return new AppError(`Something went wrong while ${action}.`, 500, "INTERNAL");
}
