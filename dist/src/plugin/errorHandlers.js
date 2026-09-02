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
const errors_1 = require("../errors/errors");
const errorHandlerPlugin = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.setErrorHandler((error, request, reply) => {
        var _a, _b;
        // The app boots WITHOUT a Fastify logger, so fastify.log.error was a
        // silent sink — prod 500s left zero trace. Log unexpected errors for
        // real, with the route and a compact body, so the platform logs name
        // the culprit instead of a bare status code.
        const status = error instanceof errors_1.AppError
            ? error.statusCode
            : ((_a = error.statusCode) !== null && _a !== void 0 ? _a : 500);
        if (!status || status >= 500) {
            let bodyPreview = "";
            try {
                bodyPreview = JSON.stringify(request.body).slice(0, 600);
            }
            catch (_c) {
                /* body not serializable */
            }
            console.error(`[500] ${request.method} ${request.url} — ${error.message}\n` +
                ((_b = error.stack) !== null && _b !== void 0 ? _b : "") +
                (bodyPreview ? `\n[500] body: ${bodyPreview}` : ""));
        }
        fastify.log.error(error);
        // Handle specific error types
        if (error instanceof errors_1.AppError) {
            return reply.status(error.statusCode).send({
                statusCode: error.statusCode,
                error: error.name,
                message: error.message,
                code: error.code,
            });
        }
        // Handle validation errors
        if (error.validation) {
            return reply.status(400).send({
                statusCode: 400,
                error: "ValidationError",
                message: "Validation failed",
                details: error.validation,
            });
        }
        // Handle 404 errors
        if (error.code === "FST_ERR_NOT_FOUND") {
            const notFoundError = new errors_1.NotFoundError();
            return reply.status(notFoundError.statusCode).send({
                statusCode: notFoundError.statusCode,
                error: notFoundError.name,
                message: notFoundError.message,
                code: notFoundError.code,
            });
        }
        // Default error handler — pass the real message through so field
        // reports (mobile queue rows, toasts) say what actually failed
        // instead of a generic "Something went wrong".
        reply.status(500).send({
            statusCode: 500,
            error: "InternalServerError",
            message: error.message || "Something went wrong",
        });
    });
});
exports.default = errorHandlerPlugin;
