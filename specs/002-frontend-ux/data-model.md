# Data Model: 云盘文件管理系统

**Feature**: 002-frontend-ux | **Date**: 2026-06-09

**Scope**: Unified data model covering both backend entities (spec 001) and frontend
display-layer models (spec 002).

---

## Backend Data Layer (MySQL 8.0+ / InnoDB)

### 1. `users`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | INT UNSIGNED AUTO_INCREMENT | PRIMARY KEY | 用户唯一 ID |
| `username` | VARCHAR(64) | UNIQUE, NOT NULL | 登录用户名 |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt 哈希 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 注册时间 |

### 2. `file_nodes`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | INT UNSIGNED AUTO_INCREMENT | PRIMARY KEY | 节点唯一 ID |
| `name` | VARCHAR(255) | NOT NULL | 文件/目录名 (禁止 `/` `\0`) |
| `type` | ENUM('file','directory') | NOT NULL | 节点类型 |
| `size` | BIGINT UNSIGNED | NOT NULL, DEFAULT 0 | 文件大小(byte), 目录=0 |
| `hash` | CHAR(40) | NULL (目录=NULL) | SHA-1 十六进制 (40 字符) |
| `parent_id` | INT UNSIGNED | NULL (根=NULL), FK→`file_nodes.id` | 父目录 ID |
| `owner_id` | INT UNSIGNED | NOT NULL, FK→`users.id` | 所有者 |
| `status` | ENUM('active','deleted') | NOT NULL, DEFAULT 'active' | 软删除状态 |
| `modified_at` | DATETIME | NOT NULL, DEFAULT NOW() ON UPDATE NOW() | 最后修改时间 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 创建时间 |

**Indexes**:
- `INDEX idx_parent_status (parent_id, status)` — 目录列表查询
- `INDEX idx_owner_status (owner_id, status)` — 用户文件搜索
- `INDEX idx_name_search (name(255), status)` — 模糊搜索前缀
- `INDEX idx_hash (hash)` — 去重查重 JOIN

**Integrity**:
- 外键 `parent_id → file_nodes.id` (级联: ON DELETE RESTRICT)
- 外键 `owner_id → users.id` (级联: ON DELETE RESTRICT)
- CHECK 约束: `type='directory'` 时 `hash IS NULL AND size = 0`

### 3. `physical_blocks`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `sha1_hash` | CHAR(40) | PRIMARY KEY | SHA-1 哈希 (唯一) |
| `size` | BIGINT UNSIGNED | NOT NULL | 物理文件大小 |
| `real_path` | VARCHAR(1024) | NOT NULL | 磁盘绝对路径 |
| `ref_count` | INT UNSIGNED | NOT NULL, DEFAULT 1, CHECK (ref_count >= 0) | 引用计数 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 首次入库时间 |

**Integrity**: `CHECK (ref_count >= 0)`

### 4. `audit_logs`

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | PRIMARY KEY | 审计记录 ID |
| `operator_id` | INT UNSIGNED | NOT NULL, FK→`users.id` | 操作者 |
| `operation_type` | ENUM('DELETE_FILE','RESTORE_FILE','MOVE_FILE','MOVE_DIRECTORY','RENAME_DIRECTORY','PHYSICAL_DELETE') | NOT NULL | 操作类型 |
| `target_node_id` | INT UNSIGNED | NOT NULL | 目标节点 ID |
| `old_value` | JSON | NULL | 变更前值 |
| `new_value` | JSON | NULL | 变更后值 |
| `created_at` | DATETIME | NOT NULL, DEFAULT NOW() | 操作时间 |

**Integrity**:
- 仅 INSERT 和 SELECT 权限授予 `drive_app`
- 无 UPDATE / DELETE 权限 (只追加，不可篡改)
- INDEX `idx_audit_created (created_at)` — 时间范围查询

### Entity Relationship Diagram

```
users (1) ────< (N) file_nodes (N) >──── (1) file_nodes (self-ref: parent_id)
                            |
                            | (N:1 via hash)
                            v
                      physical_blocks

users (1) ────< (N) audit_logs
```

---

## Frontend Display Layer (Client-Side Models)

### 5. `DirectoryTreeNode` (JS)

| Property | Type | Source |
|----------|------|--------|
| `id` | number | `file_nodes.id` |
| `name` | string | `file_nodes.name` |
| `depth` | number | computed (recursive) |
| `isExpanded` | boolean | client state |
| `childCount` | number | `COUNT(child_nodes)` |
| `isSelected` | boolean | client state |

**Anti-Slop**: 无 `icon`, `color`, `badge` 属性

### 6. `FileCard` (JS)

| Property | Type | Source |
|----------|------|--------|
| `id` | number | `file_nodes.id` |
| `fileName` | string | `file_nodes.name` (截断+省略号) |
| `fileType` | string | 扩展名提取 |
| `fileSize` | string | human-readable (`1.2 MB`) |
| `modifiedTime` | string | relative time (`2 小时前`) |
| `thumbnailUrl` | string\|null | 图片: 后端缩略图 URL; 非图片: null |
| `isUploading` | boolean | client upload state |

**Anti-Slop**: 无 `accentColor`, `icon`, `stats`

### 7. `SkeletonState` (JS)

| Property | Type | Values |
|----------|------|--------|
| `state` | enum | `loading` / `loaded` / `empty` / `error` |
| `minDisplayMs` | number | 300 |
| `shimmerActive` | boolean | true during `loading` |

**Anti-Slop**: 骨架不包含假文字、假图标、假数据

### 8. `AnimationIntent` (JS)

| Property | Type | Values |
|----------|------|--------|
| `type` | enum | `hero_reveal` / `damped_slide_out` / `slide_in_restore` |
| `duration` | number | ms |
| `easing` | string | `expo-out` / `ease-out` |

**Anti-Slop**: 无 `hover_scale`, `click_ripple`, `loading_spin`

---

## State Transitions

### `file_nodes.status`

```
active ──[sp_soft_delete_node]──> deleted
deleted ──[sp_restore_node]──────> active
deleted ──[evt_clean_recycle_bin (>30d)]──> (physical DELETE)
```

### `physical_blocks.ref_count`

```
0 ──[sp_upload_file: first upload]──> 1
N ──[sp_upload_file: dedup hit]─────> N+1
N ──[sp_soft_delete_node]───────────> N-1 (if file, when status→deleted)
N ──[tg_after_node_physical_delete]──> N-1 (on physical DELETE)
0 ──[evt_clean_recycle_bin]─────────> physical file removal + row DELETE
```

### Frontend SkeletonState

```
loading ──[API success + data.length > 0]──> loaded
loading ──[API success + data.length == 0]──> empty
loading ──[API error / timeout]─────────────> error
error   ──[user click retry]────────────────> loading
```
