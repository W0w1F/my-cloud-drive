-- DCL Scripts: 用户、权限与审计表
-- Feature: 002-frontend-ux | Date: 2026-06-09
-- Constitution: IV (Least Privilege), V (Audit Compliance)

-- ============================================================================
-- 1. 创建用户
-- ============================================================================

-- 全局管理员: DDL + 维护操作 (Schema 变更、索引创建、备份)
CREATE USER IF NOT EXISTS 'drive_admin'@'localhost'
    IDENTIFIED BY '[CHANGE_ME_STRONG_PASSWORD]';

-- 业务用户: 仅 SELECT/INSERT/UPDATE/EXECUTE (最小权限原则)
CREATE USER IF NOT EXISTS 'drive_app'@'%'
    IDENTIFIED BY '[CHANGE_ME_STRONG_PASSWORD]';

-- ============================================================================
-- 2. 创建审计表
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    operator_id     INT UNSIGNED NOT NULL,
    operation_type  ENUM(
        'DELETE_FILE', 'RESTORE_FILE',
        'MOVE_FILE', 'MOVE_DIRECTORY',
        'RENAME_DIRECTORY', 'PHYSICAL_DELETE'
    ) NOT NULL,
    target_node_id  INT UNSIGNED NOT NULL,
    old_value       JSON NULL,
    new_value       JSON NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_audit_created (created_at),
    INDEX idx_audit_operator (operator_id),
    INDEX idx_audit_target (target_node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. 分配权限 (GRANT)
-- ============================================================================

-- drive_admin: DDL + 全表访问 (仅在迁移/维护时使用)
GRANT CREATE, ALTER, DROP, INDEX, SELECT, INSERT, UPDATE, DELETE
    ON cloud_drive.* TO 'drive_admin'@'localhost';

GRANT EXECUTE
    ON cloud_drive.* TO 'drive_admin'@'localhost';

GRANT EVENT
    ON cloud_drive.* TO 'drive_admin'@'localhost';

-- drive_app: 最小权限 (宪章 IV)
-- 业务表: SELECT + INSERT + UPDATE (软删除用 UPDATE status, 不禁 DELETE 语法但通过
-- 存储过程封装确保业务代码无法直接 DELETE)
GRANT SELECT, INSERT, UPDATE
    ON cloud_drive.file_nodes TO 'drive_app'@'%';

GRANT SELECT, INSERT, UPDATE
    ON cloud_drive.physical_blocks TO 'drive_app'@'%';

GRANT SELECT
    ON cloud_drive.users TO 'drive_app'@'%';

-- audit_logs: 仅追加 (宪章 V)
GRANT SELECT, INSERT
    ON cloud_drive.audit_logs TO 'drive_app'@'%';
-- 明确撤销 UPDATE/DELETE (只追加，不可篡改)
REVOKE UPDATE, DELETE
    ON cloud_drive.audit_logs FROM 'drive_app'@'%';

-- 存储过程/函数: 仅 EXECUTE (不暴露源码)
GRANT EXECUTE
    ON cloud_drive.* TO 'drive_app'@'%';

-- 明文禁止: drive_app 无 DDL 权限、无 DROP 权限、无 GRANT 权限

-- ============================================================================
-- 4. 验证
-- ============================================================================

-- 确认 drive_app 权限:
-- SHOW GRANTS FOR 'drive_app'@'%';
-- 预期输出: SELECT, INSERT, UPDATE on file_nodes/physical_blocks;
--            SELECT, INSERT on audit_logs;
--            SELECT on users;
--            EXECUTE on all routines;
--            NO DELETE, NO DROP, NO ALTER, NO GRANT

FLUSH PRIVILEGES;
