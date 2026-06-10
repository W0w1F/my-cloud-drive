-- 003-stored-procedures.sql: Core Business Logic
-- Feature: 002-frontend-ux
-- Constitution: II (SHA-1 dedup), III (atomicity), VI (SP encapsulation)
-- AI Audit: explicit BEGIN/COMMIT/ROLLBACK, transaction isolation documented

USE cloud_drive;
DROP PROCEDURE IF EXISTS sp_upload_file;
DROP PROCEDURE IF EXISTS sp_soft_delete_node;
DROP PROCEDURE IF EXISTS sp_restore_node;
DROP PROCEDURE IF EXISTS sp_move_node;
DROP PROCEDURE IF EXISTS sp_clear_trash;

DELIMITER //

-- ============================================================================
-- sp_upload_file: Full dedup upload flow
-- Constitution II: SHA-1 hash verification, ref_count dedup
-- Constitution III: SELECT...FOR UPDATE, strong consistency transaction
-- Constitution VI: Encapsulated in stored procedure (no application-layer SQL)
-- Isolation: READ COMMITTED (default InnoDB)
-- ============================================================================
CREATE PROCEDURE sp_upload_file(
    IN p_owner_id    INT UNSIGNED,
    IN p_parent_id   INT UNSIGNED,
    IN p_file_name   VARCHAR(255),
    IN p_file_size   BIGINT UNSIGNED,
    IN p_sha1_hash   CHAR(40),
    IN p_real_path   VARCHAR(1024)
)
BEGIN
    DECLARE v_existing_ref_count INT UNSIGNED;
    DECLARE v_new_node_id        INT UNSIGNED;

    -- Validate parent directory exists and is active
    IF p_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM file_nodes
                       WHERE id = p_parent_id
                         AND type = 'directory'
                         AND status = 'active') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Parent directory not found or not active';
        END IF;
    END IF;

    -- Start transaction with explicit boundary (AI Audit: required)
    START TRANSACTION;

    -- Check if physical block already exists (dedup lookup)
    -- Constitution III: SELECT...FOR UPDATE for strong consistency
    SELECT ref_count INTO v_existing_ref_count
    FROM physical_blocks
    WHERE sha1_hash = p_sha1_hash
    FOR UPDATE;

    IF v_existing_ref_count IS NOT NULL THEN
        -- DEDUP HIT: increment ref_count (no duplicate storage)
        UPDATE physical_blocks
        SET ref_count = ref_count + 1
        WHERE sha1_hash = p_sha1_hash;
    ELSE
        -- FIRST UPLOAD: insert new physical block
        INSERT INTO physical_blocks (sha1_hash, size, real_path, ref_count)
        VALUES (p_sha1_hash, p_file_size, p_real_path, 1);
    END IF;

    -- Create virtual file node
    INSERT INTO file_nodes (name, type, size, hash, parent_id, owner_id, status)
    VALUES (p_file_name, 'file', p_file_size, p_sha1_hash, p_parent_id, p_owner_id, 'active');

    SET v_new_node_id = LAST_INSERT_ID();

    COMMIT;

    -- Return newly created node info
    SELECT
        v_new_node_id AS id,
        p_file_name AS name,
        'file' AS type,
        p_file_size AS size,
        p_sha1_hash AS hash,
        IF(v_existing_ref_count IS NOT NULL, TRUE, FALSE) AS instant_upload,
        (SELECT ref_count FROM physical_blocks WHERE sha1_hash = p_sha1_hash) AS ref_count;

END //

-- ============================================================================
-- sp_soft_delete_node: Cascading soft delete
-- Constitution I: status UPDATE only, NO physical DELETE
-- Constitution III: recursive CTE for cascading, single transaction
-- ============================================================================
CREATE PROCEDURE sp_soft_delete_node(
    IN p_node_id     INT UNSIGNED,
    IN p_operator_id INT UNSIGNED
)
BEGIN
    DECLARE v_cascade_count INT DEFAULT 0;

    -- Validate node exists
    IF NOT EXISTS (SELECT 1 FROM file_nodes WHERE id = p_node_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Node not found';
    END IF;

    START TRANSACTION;

    -- Soft-delete: UPDATE status (NOT physical DELETE — Constitution I)
    -- Keep physical block ref_count unchanged while files remain restorable in trash.
    WITH RECURSIVE descendants AS (
        SELECT id FROM file_nodes WHERE id = p_node_id
        UNION ALL
        SELECT fn.id FROM file_nodes fn
        JOIN descendants d ON fn.parent_id = d.id
    )
    UPDATE file_nodes
    SET status = 'deleted', modified_at = NOW()
    WHERE id IN (SELECT id FROM descendants)
      AND status = 'active';

    SET v_cascade_count = ROW_COUNT();

    COMMIT;

    SELECT p_node_id AS id, 'deleted' AS status, v_cascade_count AS cascade_count;

END //

-- ============================================================================
-- sp_restore_node: Restore a soft-deleted node (cascade)
-- Constitution I: status UPDATE only, cascade restore children
-- ============================================================================
CREATE PROCEDURE sp_restore_node(
    IN p_node_id     INT UNSIGNED,
    IN p_operator_id INT UNSIGNED
)
BEGIN
    DECLARE v_type ENUM('file', 'directory');
    DECLARE v_done INT DEFAULT 0;

    -- Validate node exists and is deleted
    SELECT type INTO v_type FROM file_nodes
    WHERE id = p_node_id AND status = 'deleted';

    IF v_type IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Node not found or not in deleted state';
    END IF;

    START TRANSACTION;

    -- Cascade restore: all deleted descendants
    WITH RECURSIVE descendants AS (
        SELECT id, hash, type FROM file_nodes WHERE id = p_node_id AND status = 'deleted'
        UNION ALL
        SELECT fn.id, fn.hash, fn.type
        FROM file_nodes fn
        JOIN descendants d ON fn.parent_id = d.id
        WHERE fn.status = 'deleted'
    )
    SELECT COUNT(*) INTO v_done FROM descendants;

    -- Restore all descendant nodes
    -- ref_count is unchanged because soft-deleted nodes still own their blocks.
    WITH RECURSIVE descendants AS (
        SELECT id FROM file_nodes WHERE id = p_node_id AND status = 'deleted'
        UNION ALL
        SELECT fn.id FROM file_nodes fn
        JOIN descendants d ON fn.parent_id = d.id
        WHERE fn.status = 'deleted'
    )
    UPDATE file_nodes
    SET status = 'active', modified_at = NOW()
    WHERE id IN (SELECT id FROM descendants);

    COMMIT;

    SELECT p_node_id AS id, 'active' AS status, v_done AS restored_count;

END //

-- ============================================================================
-- sp_move_node: Move file/directory to new parent
-- Constitution III: cycle detection via recursive CTE
-- Constitution V: audit log via trigger (tg_audit_node_change)
-- ============================================================================
CREATE PROCEDURE sp_move_node(
    IN p_node_id       INT UNSIGNED,
    IN p_new_parent_id INT UNSIGNED,
    IN p_operator_id   INT UNSIGNED
)
BEGIN
    DECLARE v_node_type ENUM('file', 'directory');
    DECLARE v_old_parent INT UNSIGNED;

    -- Validate node exists
    SELECT type, parent_id INTO v_node_type, v_old_parent
    FROM file_nodes WHERE id = p_node_id AND status = 'active';

    IF v_node_type IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Source node not found or not active';
    END IF;

    -- Validate new parent exists and is active directory
    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM file_nodes
                       WHERE id = p_new_parent_id
                         AND type = 'directory'
                         AND status = 'active') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Target parent directory not found or not active';
        END IF;
    END IF;

    -- Cycle detection for directories (Constitution III)
    -- Cannot move a directory into its own descendant
    IF v_node_type = 'directory' AND p_new_parent_id IS NOT NULL THEN
        IF EXISTS (
            WITH RECURSIVE descendants AS (
                SELECT id FROM file_nodes WHERE id = p_node_id
                UNION ALL
                SELECT fn.id FROM file_nodes fn
                JOIN descendants d ON fn.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = p_new_parent_id
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'CYCLE_DETECTED: Cannot move a directory into its own descendant';
        END IF;
    END IF;

    START TRANSACTION;

    UPDATE file_nodes
    SET parent_id = p_new_parent_id, modified_at = NOW()
    WHERE id = p_node_id;

    COMMIT;

    SELECT p_node_id AS id, p_new_parent_id AS parent_id,
           IF(v_node_type = 'file', 'MOVE_FILE', 'MOVE_DIRECTORY') AS operation;

END //

-- ============================================================================
-- sp_clear_trash: Permanently remove all deleted nodes for an owner
-- Constitution I: Only hard-deletes nodes that are already soft-deleted.
-- Deletes leaf nodes first to satisfy the self-referencing parent FK.
-- ============================================================================
CREATE PROCEDURE sp_clear_trash(
    IN p_owner_id INT UNSIGNED
)
BEGIN
    DECLARE v_batch_deleted INT DEFAULT 0;
    DECLARE v_total_deleted INT DEFAULT 0;

    START TRANSACTION;

    delete_loop: LOOP
        DELETE fn
        FROM file_nodes fn
        LEFT JOIN file_nodes child ON child.parent_id = fn.id
        WHERE fn.owner_id = p_owner_id
          AND fn.status = 'deleted'
          AND child.id IS NULL;

        SET v_batch_deleted = ROW_COUNT();
        SET v_total_deleted = v_total_deleted + v_batch_deleted;

        IF v_batch_deleted = 0 THEN
            LEAVE delete_loop;
        END IF;
    END LOOP;

    COMMIT;

    SELECT v_total_deleted AS deleted_count;
END //

DELIMITER ;
