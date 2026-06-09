-- 007-indexes.sql: Composite Indexes for Query Performance
-- Feature: 002-frontend-ux | Constitution: III (High Performance)
-- Research decision: composite indexes for common query patterns

USE cloud_drive;

-- Primary query pattern: list active files in a directory
-- Used by: GET /api/v1/files?parent_id=X
CREATE INDEX idx_parent_status ON file_nodes(parent_id, status);

-- User's active files for search and listing
-- Used by: GET /api/v1/files/search?q=keyword&owner_id=X
CREATE INDEX idx_owner_status ON file_nodes(owner_id, status);

-- Fuzzy file name search (prefix index on first 255 chars)
-- Used by: GET /api/v1/files/search?q=keyword
CREATE INDEX idx_name_search ON file_nodes(name(255), status);

-- Audit log time-range queries
-- Used by: audit report queries
-- idx_audit_created already created in 001-schema.sql; skip duplicate

-- Hash lookup for dedup check in sp_upload_file
-- (Primary key already provides B-tree index, but explicit for clarity)
-- CREATE INDEX idx_hash_lookup ON file_nodes(hash);  -- already exists from schema
