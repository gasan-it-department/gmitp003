import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma, Prisma } from "../barrel/prisma";
import { ValidationError, AppError, NotFoundError } from "../errors/errors";
import { sendEmail, generateOTPCode } from "../middleware/handler";
import { EncryptionService } from "../service/encryption";

export const sendOtpViaEmail = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.query as { applicationId: string };
  console.log({ body });

  if (!body.applicationId) {
    throw new ValidationError("Application ID is required");
  }

  try {
    // Find the application
    const application = await prisma.submittedApplication.findUnique({
      where: {
        id: body.applicationId,
      },
      include: {
        forPosition: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Decrypt email
    const email = application.emailIv
      ? await EncryptionService.decrypt(application.email, application.emailIv)
      : undefined;

    if (!email) {
      throw new ValidationError("Failed to retrieve applicant email");
    }

    // Generate OTP code
    const code = await generateOTPCode();
    if (!code) {
      throw new ValidationError("Failed to generate OTP code");
    }

    await prisma.otpVerification.create({
      data: {
        submittedApplicationId: application.id,
        code: code,
        status: 0,
      },
    });

    // Prepare email content
    const applicantName = `${application.firstname} ${application.lastname}`;
    const positionName = application.forPosition?.name || "the position";

    const emailSubject = `Your Verification Code - Application for ${positionName}`;

    const emailText = `
Application Verification Code

Dear ${applicantName},

Thank you for applying for the ${positionName} position.

To continue with your application process, please use the following One-Time Password (OTP):

${code}

Important: This code will expire in 10 minutes. Do not share this code with anyone.

If you did not request this verification code, please ignore this email.

Best regards,
HR Department

This is an automated message. Please do not reply to this email.
    `;

    // Send email
    await sendEmail("OTP", email, emailText, emailSubject);

    // Log the OTP send event (optional)

    return res.code(200).send({
      message: "Verification code sent successfully",
      expiresIn: "10 minutes",
    });
  } catch (error) {
    // Log the error
    console.error("OTP sending failed:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database connection failed", 500, "DB_ERROR");
    }

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    throw new AppError(
      "Failed to send verification code",
      500,
      "EMAIL_SEND_FAILED"
    );
  }
};

export const sendOTPViaPhneNumber = async (
  req: FastifyRequest,
  res: FastifyReply
) => {
  const body = req.body as { applicationId: string };

  if (!body.applicationId) {
    throw new ValidationError("Application ID is required");
  }

  try {
    // Find the application
    const application = await prisma.submittedApplication.findUnique({
      where: {
        id: body.applicationId,
      },
      include: {
        forPosition: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Decrypt email
    const email = application.emailIv
      ? await EncryptionService.decrypt(application.email, application.emailIv)
      : undefined;

    if (!email) {
      throw new ValidationError("Failed to retrieve applicant email");
    }

    // Generate OTP code
    const code = await generateOTPCode();
    if (!code) {
      throw new ValidationError("Failed to generate OTP code");
    }

    await prisma.otpVerification.create({
      data: {
        submittedApplicationId: application.id,
        code: code,
      },
    });

    // Prepare email content
    const applicantName = `${application.firstname} ${application.lastname}`;
    const positionName = application.forPosition?.name || "the position";

    const emailSubject = `Your Verification Code - Application for ${positionName}`;

    const emailText = `
Application Verification Code

Dear ${applicantName},

Thank you for applying for the ${positionName} position.

To continue with your application process, please use the following One-Time Password (OTP):

${code}

Important: This code will expire in 10 minutes. Do not share this code with anyone.

If you did not request this verification code, please ignore this email.

Best regards,
HR Department

This is an automated message. Please do not reply to this email.
    `;

    // Send email
    await sendEmail("OTP", email, emailText, emailSubject);

    // Log the OTP send event (optional)

    return res.code(200).send({
      message: "Verification code sent successfully",
      expiresIn: "10 minutes",
    });
  } catch (error) {
    // Log the error

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database connection failed", 500, "DB_ERROR");
    }

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    throw new AppError(
      "Failed to send verification code",
      500,
      "EMAIL_SEND_FAILED"
    );
  }
};

export const verifyOTPCode = async (req: FastifyRequest, res: FastifyReply) => {
  const body = req.body as { code: number; applicationID: string };
  console.log({ body });

  if (!body.code || !body.applicationID)
    throw new ValidationError("INVALID_REQUIRED_ID");
  try {
    const response = await prisma.$transaction(async (tx) => {
      const otp = await tx.otpVerification.findUnique({
        where: {
          code: body.code,
        },
      });

      if (!otp) throw new ValidationError("INVALID OTP CODE");
      console.log(otp);

      const token = await res.jwtSign({
        id: body.code,
        username: body.applicationID,
      });
      await tx.otpVerification.update({
        where: {
          code: otp.code,
        },
        data: {
          status: 1,
        },
      });
      return token;
    });

    if (!response) throw new ValidationError("FAILED_TO_GENERATE");
    return res.code(200).send({ message: "OK", token: response });
  } catch (error) {
    console.log("F", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError("Database connection failed", 500, "DB_ERROR");
    }

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    throw new AppError(
      "Failed to send verification code",
      500,
      "EMAIL_SEND_FAILED"
    );
  }
};
