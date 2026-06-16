-- 002-dcl.sql: DCL — Users, Grants, Audit Logs
-- Feature: 002-frontend-ux
-- Constitution: IV (Least Privilege), V (Audit Compliance)

USE cloud_drive;

-- ============================================================================
-- 1. Create Users
-- ============================================================================

-- Global admin: DDL + maintenance operations
-- Used ONLY for schema migrations, index creation, backups
-- NEVER used by application code
CREATE USER IF NOT EXISTS 'drive_admin'@'localhost'
    IDENTIFIED BY 'CHANGE_ME_ADMIN_PASSWORD';

-- Application user: minimum privilege for business operations
-- Constitution IV: SELECT, INSERT, UPDATE + EXECUTE only
-- NO DELETE, NO DROP, NO ALTER, NO GRANT
CREATE USER IF NOT EXISTS 'drive_app'@'%'
    IDENTIFIED BY 'CHANGE_ME_APP_PASSWORD';

-- ============================================================================
-- 2. Grant Privileges — drive_admin
-- ============================================================================

GRANT CREATE, ALTER, DROP, INDEX,
      SELECT, INSERT, UPDATE, DELETE
    ON cloud_drive.* TO 'drive_admin'@'localhost';

GRANT EXECUTE ON cloud_drive.* TO 'drive_admin'@'localhost';
GRANT EVENT   ON cloud_drive.* TO 'drive_admin'@'localhost';

-- ============================================================================
-- 3. Grant Privileges — drive_app (Constitution IV: Least Privilege)
-- ============================================================================

-- Business tables: CRUD via UPDATE (soft-delete), no physical DELETE
GRANT SELECT, INSERT, UPDATE
    ON cloud_drive.file_nodes TO 'drive_app'@'%';

GRANT SELECT, INSERT, UPDATE
    ON cloud_drive.physical_blocks TO 'drive_app'@'%';

-- Users table: read + insert (registration)
-- NOTE: Both @'%' and @'localhost' need INSERT for local connection matching
GRANT SELECT, INSERT
    ON cloud_drive.users TO 'drive_app'@'%';
GRANT SELECT, INSERT
    ON cloud_drive.users TO 'drive_app'@'localhost';

-- Audit logs: INSERT + SELECT only (Constitution V: append-only, immutable)
GRANT SELECT, INSERT
    ON cloud_drive.audit_logs TO 'drive_app'@'%';

REVOKE UPDATE, DELETE
    ON cloud_drive.audit_logs FROM 'drive_app'@'%';

-- Stored procedures and functions: EXECUTE only (source code hidden)
GRANT EXECUTE
    ON cloud_drive.* TO 'drive_app'@'%';

-- ============================================================================
-- 4. Verify
-- ============================================================================

FLUSH PRIVILEGES;

-- Verification queries (run as root):
-- SHOW GRANTS FOR 'drive_admin'@'localhost';
-- SHOW GRANTS FOR 'drive_app'@'%';
-- Expected: drive_app has NO DELETE, NO DROP, NO ALTER, NO GRANT
-- Expected: drive_app has NO UPDATE/DELETE on audit_logs
