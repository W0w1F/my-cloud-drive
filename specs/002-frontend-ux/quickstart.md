# Quickstart: 云盘文件管理系统验证指南

**Feature**: 002-frontend-ux | **Date**: 2026-06-09

## Prerequisites

- MySQL 8.0+ (InnoDB, Event Scheduler enabled)
- Node.js 18+ (for API gateway)
- Modern browser (Chrome/Firefox/Safari/Edge, last 2 years)
- `mysqldump` and `mysql` CLI in PATH

---

## 1. Database Setup

```bash
# 1.1 Create database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS cloud_drive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 1.2 Enable Event Scheduler
mysql -u root -p -e "SET GLOBAL event_scheduler = ON;"

# 1.3 Run schema
mysql -u root -p cloud_drive < backend/sql/001-schema.sql

# 1.4 Run DCL (users + grants + audit_logs)
mysql -u root -p cloud_drive < backend/sql/002-dcl.sql

# 1.5 Run stored procedures
mysql -u root -p cloud_drive < backend/sql/003-stored-procedures.sql

# 1.6 Run functions
mysql -u root -p cloud_drive < backend/sql/004-functions.sql

# 1.7 Run triggers
mysql -u root -p cloud_drive < backend/sql/005-triggers.sql

# 1.8 Run events
mysql -u root -p cloud_drive < backend/sql/006-events.sql

# 1.9 Apply indexes
mysql -u root -p cloud_drive < backend/sql/007-indexes.sql
```

## 2. Verify DCL

```bash
# Confirm drive_app has no DELETE on audit_logs
mysql -u drive_app -p cloud_drive -e "DELETE FROM audit_logs LIMIT 1;"
# Expected: ERROR 1142 (42000): DELETE command denied

# Confirm drive_app cannot create tables
mysql -u drive_app -p cloud_drive -e "CREATE TABLE test (id INT);"
# Expected: ERROR 1142 (42000): CREATE command denied

# Confirm drive_admin can create tables
mysql -u drive_admin -p cloud_drive -e "CREATE TABLE IF NOT EXISTS _test (id INT); DROP TABLE _test;"
# Expected: Query OK
```

## 3. Verify Stored Procedures

```sql
-- 3.1 Test sp_upload_file (first upload)
CALL sp_upload_file(
    1,           -- p_owner_id
    NULL,        -- p_parent_id (root)
    'test.txt',  -- p_file_name
    1024,        -- p_file_size
    'da39a3ee5e6b4b0d3255bfef95601890afd80709',  -- p_sha1_hash
    '/storage/blocks/da/39/test.txt'              -- p_real_path
);
-- Expected: New file_nodes row (id=1) + physical_blocks row (ref_count=1)

-- 3.2 Test sp_upload_file (dedup — same hash, different owner)
CALL sp_upload_file(
    2,           -- different owner
    NULL,
    'test_copy.txt',
    1024,
    'da39a3ee5e6b4b0d3255bfef95601890afd80709',  -- same hash
    '/storage/blocks/da/39/test.txt'
);
-- Expected: New file_nodes row, physical_blocks.ref_count = 2 (no duplicate block)

-- 3.3 Verify dedup
SELECT sha1_hash, ref_count FROM physical_blocks WHERE sha1_hash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
-- Expected: 1 row, ref_count = 2

-- 3.4 Test fn_get_node_full_path
-- First create nested structure: root > docs > reports
INSERT INTO file_nodes (name, type, owner_id, parent_id) VALUES ('docs', 'directory', 1, NULL);
INSERT INTO file_nodes (name, type, owner_id, parent_id) VALUES ('reports', 'directory', 1, 2);
SELECT fn_get_node_full_path(3);
-- Expected: '/docs/reports'
```

## 4. Verify Triggers

```sql
-- 4.1 Soft delete triggers audit log
CALL sp_soft_delete_node(1, 1);  -- delete node_id=1, operator_id=1
SELECT * FROM audit_logs WHERE target_node_id = 1;
-- Expected: 1 row, operation_type='DELETE_FILE', old_value contains status='active'

-- 4.2 Physical delete triggers ref_count update
-- (after evt_clean_recycle_bin runs)
SELECT ref_count FROM physical_blocks WHERE sha1_hash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
-- Expected: ref_count decreased by 1
```

## 5. Verify Event Scheduler

```sql
-- Check event status
SHOW EVENTS FROM cloud_drive;
-- Expected: evt_clean_recycle_bin, Status=ENABLED, Interval=1 DAY, Starts=02:00:00

-- Check scheduler is ON
SHOW VARIABLES LIKE 'event_scheduler';
-- Expected: ON
```

## 6. Performance Verification

```sql
-- 6.1 EXPLAIN recursive CTE
EXPLAIN WITH RECURSIVE cte AS (
    SELECT id, name, parent_id, 1 AS depth
    FROM file_nodes WHERE id = 10  -- leaf node
    UNION ALL
    SELECT fn.id, fn.name, fn.parent_id, cte.depth + 1
    FROM file_nodes fn
    JOIN cte ON fn.id = cte.parent_id
)
SELECT GROUP_CONCAT(name ORDER BY depth DESC SEPARATOR '/') AS full_path FROM cte;
-- Expected: Using index on PRIMARY key in recursive term

-- 6.2 EXPLAIN file list query (most common)
EXPLAIN SELECT * FROM file_nodes WHERE parent_id = 1 AND status = 'active' ORDER BY name LIMIT 50;
-- Expected: Using idx_parent_status

-- 6.3 DENSE_RANK() analysis for large files
SELECT
    name,
    size,
    DENSE_RANK() OVER (ORDER BY size DESC) AS size_rank
FROM file_nodes
WHERE type = 'file' AND status = 'active'
ORDER BY size_rank
LIMIT 20;
-- Expected: Top 20 largest files ranked by size

-- 6.4 ANALYZE TABLE for statistics update
ANALYZE TABLE file_nodes, physical_blocks;
-- Expected: Table | Op | Msg_type | Msg_text: status OK
```

## 7. Monitoring

```sql
-- 7.1 Enable slow query log
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 0.1;  -- log queries >100ms
SET GLOBAL log_queries_not_using_indexes = ON;

-- 7.2 Check slow queries
-- mysql -u drive_admin -p -e "SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;"

-- 7.3 Check error log location
SHOW VARIABLES LIKE 'log_error';
-- Expected: path to error log file

-- 7.4 Check active connections
SHOW PROCESSLIST;
-- Expected: drive_app connections visible, no root connections
```

## 8. Frontend Validation

```bash
# Start API gateway
cd backend/api && npm start

# Open frontend in browser (double-click)
open frontend/src/index.html

# Or serve via simple HTTP server
cd frontend/src && python3 -m http.server 8080

# Playwright E2E smoke test
cd frontend/tests/e2e && npx playwright test smoke.spec.js
```

### E2E Smoke Test Checklist

- [ ] Page loads: left tree panel visible, right grid visible
- [ ] Directory tree: click folder → grid updates with skeleton → content loads
- [ ] Upload file: select file → upload progress card appears → file card rendered
- [ ] Upload same file again (dedup): Hero Reveal animation plays (400ms)
- [ ] Delete file: card slides out with damped animation → Snackbar appears
- [ ] Toggle dark mode: click theme toggle → colors transition smoothly (200ms)
- [ ] Resize to mobile (<768px): tree collapses to hamburger, grid fills width
- [ ] No AI Slop audit: open DevTools → verify no purple gradients, no emoji icons, no Inter font as display
- [ ] CSP headers present: `Content-Security-Policy: default-src 'self'; script-src 'self'`

## 9. Backup

```bash
# Logical backup (all tables + routines + events)
mysqldump -u drive_admin -p \
    --routines --events --triggers \
    --single-transaction \
    cloud_drive > backups/cloud_drive_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
grep -c "CREATE TABLE" backups/cloud_drive_*.sql
# Expected: >= 4 (users, file_nodes, physical_blocks, audit_logs)
```
