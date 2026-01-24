-- CreateTable
CREATE TABLE "Otp" (
    "code" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("code")
);
