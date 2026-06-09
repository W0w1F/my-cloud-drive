-- 001-schema.sql: DDL — Tables, Constraints
-- Feature: 002-frontend-ux | Constitution: I (soft-delete), II (SHA-1), III (CTE), V (audit)
-- Target: MySQL 8.0+ InnoDB

USE cloud_drive;

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(64) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. file_nodes — Virtual file/directory layer
-- Constitution I: status ENUM for soft-delete
-- Constitution III: parent_id self-ref for recursive CTE
-- ============================================================================
CREATE TABLE IF NOT EXISTS file_nodes (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    type        ENUM('file', 'directory') NOT NULL,
    size        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    hash        CHAR(40) NULL COMMENT 'SHA-1 hex, NULL for directories',
    parent_id   INT UNSIGNED NULL,
    owner_id    INT UNSIGNED NOT NULL,
    status      ENUM('active', 'deleted') NOT NULL DEFAULT 'active',
    modified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constitution: prevent cycles at app level (stored procedure validates)
    CONSTRAINT fk_file_parent
        FOREIGN KEY (parent_id) REFERENCES file_nodes(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_file_owner
        FOREIGN KEY (owner_id) REFERENCES users(id)
        ON DELETE RESTRICT,

    -- CHECK: directories have NULL hash and size 0
    CONSTRAINT chk_directory_attrs CHECK (
        (type = 'directory' AND hash IS NULL AND size = 0)
        OR (type = 'file' AND hash IS NOT NULL)
    ),

    -- Indexes for common queries (additional composite indexes in 007-indexes.sql)
    INDEX idx_hash (hash),
    INDEX idx_owner (owner_id),
    INDEX idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. physical_blocks — Physical storage layer
-- Constitution II: SHA-1 UNIQUE, ref_count for dedup
-- ============================================================================
CREATE TABLE IF NOT EXISTS physical_blocks (
    sha1_hash   CHAR(40) PRIMARY KEY,
    size        BIGINT UNSIGNED NOT NULL,
    real_path   VARCHAR(1024) NOT NULL,
    ref_count   INT UNSIGNED NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_ref_count_non_negative CHECK (ref_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. audit_logs — Immutable audit trail
-- Constitution V: INSERT-only, trigger-automated
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
