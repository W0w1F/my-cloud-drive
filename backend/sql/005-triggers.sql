-- 005-triggers.sql: Audit & Ref-Count Triggers
-- Feature: 002-frontend-ux
-- Constitution V: Automatic audit trail via triggers (no application-layer bypass)
-- Constitution II: ref_count maintenance on physical delete

USE cloud_drive;

DELIMITER //

-- ============================================================================
-- tg_audit_node_change: AFTER UPDATE audit trigger
-- Constitution V: All status/parent_id changes automatically logged
-- Covers: DELETE_FILE, RESTORE_FILE, MOVE_FILE, MOVE_DIRECTORY, RENAME_DIRECTORY
-- ============================================================================
CREATE TRIGGER tg_audit_node_change
AFTER UPDATE ON file_nodes
FOR EACH ROW
BEGIN
    -- Detect status change (soft-delete or restore)
    IF OLD.status != NEW.status THEN
        INSERT INTO audit_logs (operator_id, operation_type, target_node_id,
                                old_value, new_value, created_at)
        VALUES (
            @current_operator_id,  -- set by application via SET @current_operator_id = ?
            CASE
                WHEN NEW.status = 'deleted' THEN 'DELETE_FILE'
                WHEN NEW.status = 'active'   THEN 'RESTORE_FILE'
            END,
            NEW.id,
            JSON_OBJECT('status', OLD.status, 'modified_at', OLD.modified_at),
            JSON_OBJECT('status', NEW.status, 'modified_at', NEW.modified_at),
            NOW()
        );
    END IF;

    -- Detect parent_id change (move file or directory)
    IF (OLD.parent_id <=> NEW.parent_id) = 0 THEN
        INSERT INTO audit_logs (operator_id, operation_type, target_node_id,
                                old_value, new_value, created_at)
        VALUES (
            @current_operator_id,
            CASE
                WHEN NEW.type = 'file'      THEN 'MOVE_FILE'
                WHEN NEW.type = 'directory' THEN 'MOVE_DIRECTORY'
            END,
            NEW.id,
            JSON_OBJECT('parent_id', OLD.parent_id),
            JSON_OBJECT('parent_id', NEW.parent_id),
            NOW()
        );
    END IF;

    -- Detect name change (rename)
    IF OLD.name != NEW.name THEN
        INSERT INTO audit_logs (operator_id, operation_type, target_node_id,
                                old_value, new_value, created_at)
        VALUES (
            @current_operator_id,
            'RENAME_DIRECTORY',
            NEW.id,
            JSON_OBJECT('name', OLD.name),
            JSON_OBJECT('name', NEW.name),
            NOW()
        );
    END IF;
END //

-- ============================================================================
-- tg_after_node_physical_delete: AFTER DELETE ref_count maintenance
-- Constitution II: decrement ref_count when file node is permanently removed
-- Only fires when trash cleanup performs physical DELETE
-- ============================================================================
CREATE TRIGGER tg_after_node_physical_delete
AFTER DELETE ON file_nodes
FOR EACH ROW
BEGIN
    -- Only decrement ref_count for file-type nodes with a valid hash
    IF OLD.type = 'file' AND OLD.hash IS NOT NULL THEN
        UPDATE physical_blocks
        SET ref_count = IF(ref_count > 0, ref_count - 1, 0)
        WHERE sha1_hash = OLD.hash;

        -- Log the physical deletion
        INSERT INTO audit_logs (operator_id, operation_type, target_node_id,
                                old_value, new_value, created_at)
        VALUES (
            0,  -- system operation
            'PHYSICAL_DELETE',
            OLD.id,
            JSON_OBJECT('name', OLD.name, 'hash', OLD.hash, 'owner_id', OLD.owner_id),
            NULL,
            NOW()
        );
    END IF;
END //

DELIMITER ;
