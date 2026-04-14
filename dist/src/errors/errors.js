"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnauthorizedError = exports.ValidationError = exports.NotFoundError = exports.AppError = void 0;
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
