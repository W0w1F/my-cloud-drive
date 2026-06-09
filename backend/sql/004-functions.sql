-- 004-functions.sql: User-Defined Functions
-- Feature: 002-frontend-ux | Constitution: III (Recursive CTE)

USE cloud_drive;

DROP FUNCTION IF EXISTS fn_get_node_full_path;

DELIMITER //

-- ============================================================================
-- fn_get_node_full_path: Recursive CTE full path computation
-- Constitution III: Recursive CTE in single query, no application-layer looping
-- Returns: VARCHAR(4096) — full path like '/docs/reports/file.txt'
-- ============================================================================
CREATE FUNCTION fn_get_node_full_path(p_node_id INT UNSIGNED)
RETURNS VARCHAR(4096)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_full_path VARCHAR(4096);

    WITH RECURSIVE path_cte AS (
        -- Anchor: start from target node
        SELECT id, name, parent_id, 1 AS depth
        FROM file_nodes
        WHERE id = p_node_id

        UNION ALL

        -- Recursive: walk up to root
        SELECT fn.id, fn.name, fn.parent_id, pc.depth + 1
        FROM file_nodes fn
        JOIN path_cte pc ON fn.id = pc.parent_id
    )
    SELECT CONCAT('/', GROUP_CONCAT(name ORDER BY depth DESC SEPARATOR '/'))
    INTO v_full_path
    FROM path_cte;

    RETURN v_full_path;
END //

DELIMITER ;
