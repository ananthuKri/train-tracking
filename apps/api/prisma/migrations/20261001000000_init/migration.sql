-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TrackingSource" AS ENUM ('MANUAL', 'UPLOAD', 'MONITORING', 'API');

-- CreateEnum
CREATE TYPE "MonitoringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "EmailReportKind" AS ENUM ('REPORT', 'ALERT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "source" "TrackingSource" NOT NULL,
    "provider" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "validCount" INTEGER NOT NULL,
    "invalidCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainSnapshot" (
    "id" TEXT NOT NULL,
    "trackingRequestId" TEXT,
    "trainNumber" VARCHAR(5) NOT NULL,
    "journeyDate" VARCHAR(10) NOT NULL,
    "provider" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL,
    "trainName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "delayMinutes" INTEGER,
    "lastStationCode" TEXT,
    "nextStationCode" TEXT,
    "progressPercent" DOUBLE PRECISION,
    "positionKind" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "providerUpdatedAt" TIMESTAMPTZ(3),
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainRouteStop" (
    "id" TEXT NOT NULL,
    "trainNumber" VARCHAR(5) NOT NULL,
    "provider" TEXT NOT NULL,
    "trainName" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stationCode" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "day" INTEGER,
    "scheduledArrival" VARCHAR(5),
    "scheduledDeparture" VARCHAR(5),
    "haltMinutes" INTEGER,
    "isHalt" BOOLEAN NOT NULL DEFAULT true,
    "platform" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrainRouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trainNumber" VARCHAR(5) NOT NULL,
    "journeyDate" VARCHAR(10) NOT NULL,
    "trainName" TEXT,
    "intervalMinutes" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "recipients" TEXT[],
    "status" "MonitoringStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastAlertAt" TIMESTAMPTZ(3),
    "nextCheckAt" TIMESTAMPTZ(3),
    "lastKnown" JSONB,
    "firedAlerts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MonitoringSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "EmailReportKind" NOT NULL,
    "monitoringSubscriptionId" TEXT,
    "subject" TEXT NOT NULL,
    "fields" TEXT[],
    "trains" JSONB NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "delivery" TEXT NOT NULL DEFAULT 'smtp',
    "error" TEXT,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMPTZ(3),
    "sharedSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmailReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailReportRecipient" (
    "id" TEXT NOT NULL,
    "emailReportId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "messageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmailReportRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsageLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "trainNumber" VARCHAR(5),
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TrackingRequest_userId_createdAt_idx" ON "TrackingRequest"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TrackingRequest_createdAt_idx" ON "TrackingRequest"("createdAt");

-- CreateIndex
CREATE INDEX "TrainSnapshot_trainNumber_journeyDate_fetchedAt_idx" ON "TrainSnapshot"("trainNumber", "journeyDate", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "TrainSnapshot_fetchedAt_idx" ON "TrainSnapshot"("fetchedAt");

-- CreateIndex
CREATE INDEX "TrainRouteStop_stationCode_idx" ON "TrainRouteStop"("stationCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrainRouteStop_trainNumber_provider_sequence_key" ON "TrainRouteStop"("trainNumber", "provider", "sequence");

-- CreateIndex
CREATE INDEX "MonitoringSubscription_userId_status_idx" ON "MonitoringSubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "MonitoringSubscription_status_idx" ON "MonitoringSubscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailReport_shareTokenHash_key" ON "EmailReport"("shareTokenHash");

-- CreateIndex
CREATE INDEX "EmailReport_userId_createdAt_idx" ON "EmailReport"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EmailReport_monitoringSubscriptionId_idx" ON "EmailReport"("monitoringSubscriptionId");

-- CreateIndex
CREATE INDEX "EmailReportRecipient_emailReportId_idx" ON "EmailReportRecipient"("emailReportId");

-- CreateIndex
CREATE INDEX "ProviderUsageLog_provider_createdAt_idx" ON "ProviderUsageLog"("provider", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "TrackingRequest" ADD CONSTRAINT "TrackingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainSnapshot" ADD CONSTRAINT "TrainSnapshot_trackingRequestId_fkey" FOREIGN KEY ("trackingRequestId") REFERENCES "TrackingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSubscription" ADD CONSTRAINT "MonitoringSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailReport" ADD CONSTRAINT "EmailReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailReport" ADD CONSTRAINT "EmailReport_monitoringSubscriptionId_fkey" FOREIGN KEY ("monitoringSubscriptionId") REFERENCES "MonitoringSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailReportRecipient" ADD CONSTRAINT "EmailReportRecipient_emailReportId_fkey" FOREIGN KEY ("emailReportId") REFERENCES "EmailReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

