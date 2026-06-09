-- 008-maintenance.sql: Database Maintenance & Performance
-- Feature: 002-frontend-ux | User directive §3, §4

USE cloud_drive;

-- ============================================================================
-- 1. ANALYZE TABLE — Update optimizer statistics
-- Run after bulk inserts or periodically
-- ============================================================================
ANALYZE TABLE file_nodes, physical_blocks, audit_logs;

-- ============================================================================
-- 2. EXPLAIN: Recursive CTE full-path query analysis
-- Constitution III: verify CTE uses PRIMARY key index
-- ============================================================================
EXPLAIN WITH RECURSIVE path_cte AS (
    SELECT id, name, parent_id, 1 AS depth
    FROM file_nodes WHERE id = 42  -- replace with actual node ID
    UNION ALL
    SELECT fn.id, fn.name, fn.parent_id, pc.depth + 1
    FROM file_nodes fn
    JOIN path_cte pc ON fn.id = pc.parent_id
)
SELECT CONCAT('/', GROUP_CONCAT(name ORDER BY depth DESC SEPARATOR '/')) AS full_path
FROM path_cte;

-- Expected: "Using index" on PRIMARY key in recursive term

-- ============================================================================
-- 3. EXPLAIN: Common directory listing query
-- ============================================================================
EXPLAIN SELECT id, name, type, size, hash, modified_at
FROM file_nodes
WHERE parent_id = 1 AND status = 'active'
ORDER BY name
LIMIT 50;

-- Expected: "Using index" on idx_parent_status

-- ============================================================================
-- 4. DENSE_RANK(): Large file space analysis
-- Identify largest files and their space ranking
-- ============================================================================
SELECT
    DENSE_RANK() OVER (ORDER BY size DESC) AS size_rank,
    name,
    CONCAT(ROUND(size / 1048576, 2), ' MB') AS size_mb,
    owner_id,
    modified_at
FROM file_nodes
WHERE type = 'file' AND status = 'active'
ORDER BY size_rank
LIMIT 20;

-- Expected: Top 20 largest files ranked by size, no gaps in ranking for ties

-- ============================================================================
-- 5. Slow Query Log Configuration (Constitution §4)
-- ============================================================================

-- Enable slow query log
SET GLOBAL slow_query_log = ON;

-- Log queries taking >100ms
SET GLOBAL long_query_time = 0.1;

-- Log queries not using indexes (for optimization discovery)
SET GLOBAL log_queries_not_using_indexes = ON;

-- Check slow query log file location
SHOW VARIABLES LIKE 'slow_query_log_file';

-- View recent slow queries:
-- SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;

-- ============================================================================
-- 6. Error Log Location
-- ============================================================================
SHOW VARIABLES LIKE 'log_error';

-- ============================================================================
-- 7. Active Connection Check
-- Constitution IV: verify no root connections from application
-- ============================================================================
SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE
FROM information_schema.PROCESSLIST
WHERE USER NOT IN ('event_scheduler', 'system user');

-- Expected: drive_app connections visible, NO root, NO drive_admin in app context

-- ============================================================================
-- 8. Verify Event Scheduler Status
-- ============================================================================
SHOW EVENTS FROM cloud_drive;
-- Expected: evt_clean_recycle_bin, Status=ENABLED, Interval=1 DAY

-- ============================================================================
-- 9. Index Verification
-- ============================================================================
SHOW INDEX FROM file_nodes;
-- Expected: PRIMARY, idx_hash, idx_owner, idx_parent, idx_parent_status,
--            idx_owner_status, idx_name_search

-- ============================================================================
-- 10. mysqldump Backup Command (template — run from shell, not SQL)
-- ============================================================================
/*
mysqldump -u drive_admin -p \
    --routines --events --triggers \
    --single-transaction \
    --set-gtid-purged=OFF \
    cloud_drive > backups/cloud_drive_$(date +%Y%m%d_%H%M%S).sql

# Verify backup integrity:
# grep -c "CREATE TABLE" backups/cloud_drive_*.sql
# Expected: >= 4 (users, file_nodes, physical_blocks, audit_logs)
*/
