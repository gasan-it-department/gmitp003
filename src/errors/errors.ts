// errors/appError.ts
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

// Specific error types
export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

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
export function dbError(error: unknown, action = "operation"): AppError {
  // Re-surface our own typed errors untouched.
  if (error instanceof AppError) return error;

  const anyErr = error as {
    name?: string;
    code?: string;
    message?: string;
    meta?: Record<string, unknown>;
  };
  const code = anyErr?.code;
  const meta = anyErr?.meta;

  // Prisma known-request errors carry a Pxxxx code.
  if (typeof code === "string" && /^P\d{4}$/.test(code)) {
    console.error(`[dbError] ${action} failed:`, code, JSON.stringify(meta));
    switch (code) {
      case "P2002": {
        const target = (meta?.target as string[] | string | undefined) ?? "field";
        return new ValidationError(
          `That ${Array.isArray(target) ? target.join(", ") : target} already exists.`,
        );
      }
      case "P2003": {
        const field = (meta?.field_name as string | undefined) ?? "reference";
        return new ValidationError(
          `A linked record is missing or invalid (${field}). ` +
            `Pick a valid value and try again.`,
        );
      }
      case "P2011":
        return new ValidationError("A required field was left empty.");
      case "P2025":
        return new NotFoundError(
          (meta?.cause as string | undefined) ?? "The record was not found.",
        );
      default:
        return new AppError(`Database error (${code}) while ${action}.`, 500, "DB_ERROR");
    }
  }

  // Prisma validation errors (unknown field, bad type) come as a class, no code.
  if (anyErr?.name === "PrismaClientValidationError") {
    console.error(`[dbError] ${action} — invalid query:`, anyErr.message);
    return new AppError(`Invalid request while ${action}.`, 400, "BAD_REQUEST");
  }

  console.error(`[dbError] ${action} — unexpected:`, error);
  return new AppError(`Something went wrong while ${action}.`, 500, "INTERNAL");
}
