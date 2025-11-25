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

    // Default error handler
    reply.status(500).send({
      statusCode: 500,
      error: "InternalServerError",
      message: "Something went wrong",
    });
  });
};

export default errorHandlerPlugin;
