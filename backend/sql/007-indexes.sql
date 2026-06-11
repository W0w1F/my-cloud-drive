-- 007-indexes.sql: Composite Indexes for Query Performance
-- Feature: 002-frontend-ux | Constitution: III (High Performance)
-- Research decision: composite indexes for common query patterns
-- Usage: mysql -u drive_admin -p cloud_drive < backend/sql/007-indexes.sql

USE cloud_drive;

-- Primary query pattern: list files in a directory owned by user
-- Used by: GET /api/v1/files?parent_id=X  (owner_id from JWT)
-- Covers: WHERE parent_id = ? AND owner_id = ? AND status = 'active'
CREATE INDEX idx_parent_owner_status ON file_nodes(parent_id, owner_id, status);

-- User's active files / root tree listing
-- Used by: GET /api/v1/tree (root nodes), GET /api/v1/files/search
-- Covers: WHERE owner_id = ? AND status = 'active'
CREATE INDEX idx_owner_status_type ON file_nodes(owner_id, status, type);

-- Audit log time-range queries
-- Used by: audit report queries
-- idx_audit_created already created in 001-schema.sql; skip duplicate

-- Hash lookup for dedup check in sp_upload_file
-- (Primary key already provides B-tree index for physical_blocks.sha1_hash)

-- Hash-to-node reverse lookup for ref_count operations
-- Used by: triggers (tg_after_node_physical_delete)
CREATE INDEX idx_node_hash ON file_nodes(hash, status);

-- Verify all indexes
SHOW INDEX FROM file_nodes;
