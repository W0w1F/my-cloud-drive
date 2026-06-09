# API Contracts: 云盘文件管理系统

**Feature**: 002-frontend-ux | **Date**: 2026-06-09

---

## REST API Endpoints

All endpoints return JSON. Base path: `/api/v1`.

### 1. Directory Tree

```
GET /api/v1/tree?parent_id={id}&owner_id={id}
```

**Response**:
```json
{
  "nodes": [
    {
      "id": 1,
      "name": "work",
      "type": "directory",
      "size": 0,
      "parent_id": null,
      "modified_at": "2026-06-09T10:00:00Z",
      "status": "active",
      "child_count": 3,
      "has_children": true
    }
  ]
}
```

**Backend**: Calls `fn_get_node_full_path(node_id)` via recursive CTE to resolve
path segments for the response.

---

### 2. File List (Grid)

```
GET /api/v1/files?parent_id={id}&owner_id={id}&offset={n}&limit={n}
```

**Response**:
```json
{
  "items": [
    {
      "id": 42,
      "name": "report.pdf",
      "type": "file",
      "size": 1048576,
      "hash": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      "parent_id": 1,
      "modified_at": "2026-06-09T09:30:00Z",
      "status": "active",
      "thumbnail_url": "/api/v1/thumb/42"
    }
  ],
  "total": 200,
  "offset": 0,
  "limit": 50
}
```

---

### 3. File Upload (Dedup)

```
POST /api/v1/files/upload
Content-Type: multipart/form-data

Fields:
  - file: (binary)
  - parent_id: (int)
  - owner_id: (int)
```

**Response** (200 OK):
```json
{
  "id": 43,
  "name": "report.pdf",
  "type": "file",
  "size": 1048576,
  "hash": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  "instant_upload": true,
  "ref_count": 4
}
```

**Backend**: Calls `sp_upload_file(p_owner_id, p_parent_id, p_file_name, p_file_size, p_sha1_hash, p_real_path)`
which encapsulates the full dedup flow in a transaction.

**`instant_upload: true`** triggers frontend Hero Reveal animation.

---

### 4. File Download

```
GET /api/v1/files/{id}/download
```

**Response**: Binary stream with headers:
- `Content-Type: application/octet-stream` (or specific MIME)
- `Content-Disposition: attachment; filename="report.pdf"`
- `Content-Length: 1048576`

**Backend**: Reads `file_nodes.hash → physical_blocks.real_path`, streams file.

---

### 5. Search

```
GET /api/v1/files/search?q={keyword}&owner_id={id}
```

**Response**: Same shape as file list. `q` supports `LIKE '%keyword%'` on `name`
and extension matching (e.g., `*.jpg`).

---

### 6. Soft Delete

```
POST /api/v1/files/{id}/delete
Body: { "operator_id": 1 }
```

**Response**:
```json
{
  "id": 42,
  "status": "deleted",
  "cascade_count": 15
}
```

**Backend**: Calls `sp_soft_delete_node(p_node_id, p_operator_id)` — cascading
status update + `audit_logs` INSERT via trigger.

**`cascade_count`**: Number of descendant nodes affected (for directories).

Frontend triggers damped slide-out animation, then Snackbar "已删除「filename」"。

---

### 7. Restore

```
POST /api/v1/files/{id}/restore
Body: { "operator_id": 1 }
```

**Response**:
```json
{
  "id": 42,
  "status": "active"
}
```

---

### 8. Move

```
POST /api/v1/files/{id}/move
Body: { "new_parent_id": 5, "operator_id": 1 }
```

**Response**:
```json
{
  "id": 42,
  "parent_id": 5
}
```

**Backend**: Validates no cycle (新 parent 不能是 node 的子孙)，inserts `audit_logs`
record with `operation_type = 'MOVE_FILE'`.

---

### 9. Directory Create

```
POST /api/v1/directories
Body: { "name": "reports", "parent_id": 1, "owner_id": 1 }
```

**Response**: Same shape as file list item, `type: "directory"`.

---

### 10. Rename

```
PATCH /api/v1/files/{id}
Body: { "name": "new_name" }
```

**Response**: Updated node with new `name` and `modified_at`.

---

## Error Response Format

```json
{
  "error": {
    "code": "CYCLE_DETECTED",
    "message": "不能将目录移动到其自身的子目录下"
  }
}
```

| Code | HTTP Status | Meaning |
|------|------------|---------|
| `CYCLE_DETECTED` | 400 | 目录移动会形成循环引用 |
| `MAX_DEPTH` | 400 | 目录深度已达 255 层上限 |
| `DUPLICATE_NAME` | 409 | 同目录下已有同名文件/目录 |
| `FILE_NOT_FOUND` | 404 | 节点不存在 |
| `BLOCK_MISSING` | 500 | 物理文件块丢失 |
| `UNAUTHORIZED` | 401 | 未认证或无权操作 |

---

## Frontend Contract: Skeleton Screen Layout

For every API-driven UI region, the skeleton MUST match this contract:

| API Region | Skeleton Structure |
|-----------|-------------------|
| Directory tree (loading) | Nested gray rectangles: each row = 1 indent spacer (20px×depth) + arrow placeholder (12×12) + text bar (120px×14px) |
| File grid (loading) | Grid of card skeletons: each = thumbnail rect (180×135) + two text bars (140px×14px + 80px×12px), gap 16px |
| Search results | Same as file grid skeleton |
| Upload progress | Card skeleton with real file name + `<progress>` bar |

All skeleton elements: `background: oklch(90% 0 0)` (light) / `oklch(25% 0 0)` (dark),
shimmer via `background: linear-gradient(90deg, ...)` animation.
