-- AlterTable
ALTER TABLE "HumanResourcesLogs" ADD COLUMN     "tab" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "InvitationLink" ADD COLUMN     "message" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "term" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "module" INTEGER NOT NULL,
    "platform" TEXT,
    "message" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "link" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLogs" (
    "id" TEXT NOT NULL,
    "ref" TEXT,
    "number" TEXT NOT NULL,
    "content" TEXT,
    "timestamp" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "messageTemplateId" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MessageLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittedApplication" (
    "id" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "firstname" TEXT NOT NULL,
    "middleName" TEXT DEFAULT 'N/A',
    "suffix" TEXT DEFAULT 'N/A',
    "birthDate" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "filipino" BOOLEAN NOT NULL,
    "dualCitizen" BOOLEAN NOT NULL,
    "byBirth" BOOLEAN NOT NULL,
    "byNatural" BOOLEAN NOT NULL,
    "cvilStatus" TEXT NOT NULL,
    "reshouseBlock" TEXT DEFAULT 'N/A',
    "resStreet" TEXT DEFAULT 'N/A',
    "resSub" TEXT DEFAULT 'N/A',
    "resBarangay" TEXT NOT NULL,
    "resCity" TEXT NOT NULL,
    "resProvince" TEXT NOT NULL,
    "resZipCode" TEXT NOT NULL,
    "permahouseBlock" TEXT DEFAULT 'N/A',
    "permaStreet" TEXT DEFAULT 'N/A',
    "permaSub" TEXT DEFAULT 'N/A',
    "permaBarangay" TEXT NOT NULL,
    "permaCity" TEXT NOT NULL,
    "permaProvince" TEXT NOT NULL,
    "permaZipCode" TEXT NOT NULL,
    "teleNo" TEXT NOT NULL,
    "mobileNo" TEXT NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "bloodType" TEXT DEFAULT 'N/A',
    "umidNo" TEXT DEFAULT 'N/A',
    "pagIbigNo" TEXT DEFAULT 'N/A',
    "philHealthNo" TEXT DEFAULT 'N/A',
    "philSys" TEXT DEFAULT 'N/A',
    "tinNo" TEXT DEFAULT 'N/A',
    "agencyNo" TEXT DEFAULT 'N/A',
    "spouseSurname" TEXT DEFAULT 'N/A',
    "spouseFirstname" TEXT DEFAULT 'N/A',
    "spouseMiddle" TEXT DEFAULT 'N/A',
    "spouseBusinessAddress" TEXT DEFAULT 'N/A',
    "spouseTelephone" TEXT DEFAULT 'N/A',
    "fatherSurname" TEXT DEFAULT 'N/A',
    "fatherFirstname" TEXT DEFAULT 'N/A',
    "fatherMiddlename" TEXT DEFAULT 'N/A',
    "fatherOccupation" TEXT DEFAULT 'N/A',
    "fatherAge" INTEGER NOT NULL,
    "fatherBirthday" TIMESTAMP(3),
    "fatherSuffix" TEXT DEFAULT 'N/A',
    "motherSurname" TEXT DEFAULT 'N/A',
    "motherFirstname" TEXT DEFAULT 'N/A',
    "motherMiddlename" TEXT DEFAULT 'N/A',
    "motherOccupation" TEXT DEFAULT 'N/A',
    "motherAge" INTEGER NOT NULL,
    "motherBirthday" TIMESTAMP(3),
    "children" JSONB[],
    "elementary" JSONB,
    "secondary" JSONB,
    "vocational" JSONB,
    "college" JSONB,
    "graduateCollege" JSONB,
    "civilService" JSONB[],
    "experience" JSONB[],
    "voluntaryWork" JSONB[],
    "learningDev" JSONB[],
    "otherInfo" JSONB[],
    "references" JSONB[],
    "govId" JSONB NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "lineId" TEXT NOT NULL,
    "applicationProfilePicId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT,

    CONSTRAINT "SubmittedApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSkillTags" (
    "id" TEXT NOT NULL,
    "tags" TEXT,
    "submittedApplicationId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSkillTags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAttachedFile" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" INTEGER NOT NULL,
    "file_size" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedApplicationId" TEXT,

    CONSTRAINT "ApplicationAttachedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationProfilePic" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" INTEGER NOT NULL,
    "file_size" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationProfilePic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationConvoAsset" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" INTEGER NOT NULL,
    "file_size" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationConversationId" TEXT,

    CONSTRAINT "ApplicationConvoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationResponseAsset" (
    "id" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" INTEGER NOT NULL,
    "file_size" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationResponseId" TEXT,

    CONSTRAINT "ApplicationResponseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationResponse" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timestmap" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedApplicationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApplicationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationConversation" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "submittedApplicationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "ApplicationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "test" BYTEA NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubmittedApplication_applicationProfilePicId_key" ON "SubmittedApplication"("applicationProfilePicId");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLogs" ADD CONSTRAINT "MessageLogs_messageTemplateId_fkey" FOREIGN KEY ("messageTemplateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedApplication" ADD CONSTRAINT "SubmittedApplication_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedApplication" ADD CONSTRAINT "SubmittedApplication_applicationProfilePicId_fkey" FOREIGN KEY ("applicationProfilePicId") REFERENCES "ApplicationProfilePic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedApplication" ADD CONSTRAINT "SubmittedApplication_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSkillTags" ADD CONSTRAINT "ApplicationSkillTags_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAttachedFile" ADD CONSTRAINT "ApplicationAttachedFile_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConvoAsset" ADD CONSTRAINT "ApplicationConvoAsset_applicationConversationId_fkey" FOREIGN KEY ("applicationConversationId") REFERENCES "ApplicationConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationResponseAsset" ADD CONSTRAINT "ApplicationResponseAsset_applicationResponseId_fkey" FOREIGN KEY ("applicationResponseId") REFERENCES "ApplicationResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationResponse" ADD CONSTRAINT "ApplicationResponse_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationResponse" ADD CONSTRAINT "ApplicationResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationResponse" ADD CONSTRAINT "ApplicationResponse_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConversation" ADD CONSTRAINT "ApplicationConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConversation" ADD CONSTRAINT "ApplicationConversation_submittedApplicationId_fkey" FOREIGN KEY ("submittedApplicationId") REFERENCES "SubmittedApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationConversation" ADD CONSTRAINT "ApplicationConversation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
