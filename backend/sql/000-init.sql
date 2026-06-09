-- 000-init.sql: Database initialization
-- Feature: 002-frontend-ux | Constitution: All principles

CREATE DATABASE IF NOT EXISTS cloud_drive
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE cloud_drive;

-- Enable Event Scheduler (required by Constitution VI)
SET GLOBAL event_scheduler = ON;

-- Verify
SELECT 'Database cloud_drive created and Event Scheduler enabled' AS status;
SHOW VARIABLES LIKE 'event_scheduler';
