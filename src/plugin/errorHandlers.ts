import {
  FastifyInstance,
  FastifyError,
  FastifyPluginAsync,
} from "../barrel/fastify";
import { AppError, NotFoundError } from "../errors/errors";

const errorHandlerPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    // The app boots WITHOUT a Fastify logger, so fastify.log.error was a
    // silent sink — prod 500s left zero trace. Log unexpected errors for
    // real, with the route and a compact body, so the platform logs name
    // the culprit instead of a bare status code.
    const status =
      error instanceof AppError
        ? error.statusCode
        : ((error as FastifyError).statusCode ?? 500);
    if (!status || status >= 500) {
      let bodyPreview = "";
      try {
        bodyPreview = JSON.stringify(request.body).slice(0, 600);
      } catch {
        /* body not serializable */
      }
      console.error(
        `[500] ${request.method} ${request.url} — ${error.message}\n` +
          (error.stack ?? "") +
          (bodyPreview ? `\n[500] body: ${bodyPreview}` : ""),
      );
    }
    fastify.log.error(error);

    // Handle specific error types
    if (error instanceof AppError) {
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
      const notFoundError = new NotFoundError();
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
};

export default errorHandlerPlugin;
