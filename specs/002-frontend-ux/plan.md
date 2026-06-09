# Implementation Plan: 云盘文件管理系统——完整技术实施

**Branch**: `master` | **Date**: 2026-06-09 | **Spec**: [spec.md](../specs/002-frontend-ux/spec.md)

**Input**: 
- `specs/001-virtual-filesystem/spec.md` — backend data model & APIs
- `specs/002-frontend-ux/spec.md` — frontend Huashu Design UX
- User directive: 数据库 DCL + 高级对象编程 + 性能优化 + 监控日志

## Summary

构建一个「虚拟文件层与物理存储层完全解耦」的云盘文件管理系统。后端以 MySQL 8.0+
为数据引擎，通过存储过程封装去重上传、递归 CTE 路径计算等核心逻辑；前端采用
Huashu Design 反 AI Slop 哲学（衬线 display + 单一 accent 色 + 暗色双主题）。
系统遵循最小权限原则（`drive_app` 业务用户 + `drive_admin` 管理用户），所有敏感
操作通过 `audit_logs` 表留痕，清理任务由 MySQL Event Scheduler 自动化驱动。

## Technical Context

**Language/Version**: SQL (MySQL 8.0+), JavaScript/HTML/CSS (vanilla, 零框架依赖)

**Primary Dependencies**: MySQL 8.0+ (递归 CTE, Event Scheduler, JSON 类型), 浏览器
(chrome/firefox/safari/edge, 近 2 年版本)

**Storage**: MySQL InnoDB (业务数据) + 本地文件系统 (物理文件块存储)

**Testing**: MySQL 存储过程单元测试 (通过 `CALL` + 断言脚本), 前端 Playwright E2E

**Target Platform**: Linux server (MySQL) + 现代浏览器 (前端 SPA)

**Project Type**: Web application (backend: MySQL 存储过程层 + thin API gateway; frontend: vanilla HTML/CSS/JS)

**Performance Goals**: 
- 10 层深递归 CTE 路径查询 ≤ 50ms
- 秒传端到端 ≤ 500ms
- 5000 文件网格滚动 ≥ 55fps
- Hero Reveal 动画 60fps

**Constraints**: 
- 禁止 AI 生成物理 DELETE 语句
- 禁止 root/sa 直连数据库
- 禁止 Drop-in UI 组件库
- 文件全路径 ≤ 4096 字符, 目录深度 ≤ 255 层

**Scale/Scope**: 10,000+ 文件节点, 1,000+ 用户, 多用户秒传去重

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | Status | Evidence |
|-----------|------------|--------|----------|
| I. 数据安全性优先 | 软删除 (`status`), 禁止物理 DELETE | ✅ PASS | `sp_soft_delete_node` 仅 UPDATE status; `evt_clean_recycle_bin` 物理删除仅对 >30 天记录执行且由事件调度器自动化 |
| II. 存储成本控制优先 | SHA-1 哈希, ref_count 去重 | ✅ PASS | `sp_upload_file` 封装完整去重流程; `physical_blocks.sha1_hash` UNIQUE 索引 |
| III. 高性能与原子性 | 递归 CTE, SELECT...FOR UPDATE | ✅ PASS | `fn_get_node_full_path` 使用 CTE; `sp_upload_file` 事务内加锁 |
| IV. 权限与控制底线 | drive_app 最小权限, 禁止 root | ✅ PASS | DCL 脚本: `drive_app` 仅 SELECT/INSERT/UPDATE/EXECUTE; `drive_admin` 仅 DDL + 维护 |
| V. 审计合规底线 | audit_logs 只追加, 触发器自动写入 | ✅ PASS | `tg_audit_node_change` 触发器覆盖 status/parent_id 变更 |
| VI. 高级对象规范 | 存储过程, 事件调度器 | ✅ PASS | `sp_upload_file` + `fn_get_node_full_path` + `evt_clean_recycle_bin` |

**Gate Result**: ALL PASS — No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-frontend-ux/
├── plan.md              # This file
├── research.md          # Phase 0: technology decisions
├── data-model.md        # Phase 1: unified data model (backend + frontend entities)
├── quickstart.md        # Phase 1: validation guide
├── contracts/           # Phase 1: API contracts + DCL scripts
│   ├── api-rest.md      # REST API endpoints
│   └── dcl-scripts.sql  # DCL: users, grants, audit_logs
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Web application: backend (MySQL SQL scripts) + frontend (vanilla HTML/CSS/JS)
backend/
├── sql/
│   ├── 001-schema.sql           # DDL: tables, indexes, constraints
│   ├── 002-dcl.sql              # DCL: users, grants, audit_logs
│   ├── 003-stored-procedures.sql # sp_upload_file, sp_soft_delete_node, ...
│   ├── 004-functions.sql        # fn_get_node_full_path
│   ├── 005-triggers.sql         # tg_audit_node_change, tg_after_node_physical_delete
│   ├── 006-events.sql           # evt_clean_recycle_bin
│   ├── 007-indexes.sql          # Composite indexes
│   └── 008-maintenance.sql      # ANALYZE, EXPLAIN examples, backup script
├── api/
│   └── [thin API gateway — routes to stored procedures]
└── tests/
    └── sp-tests.sql             # CALL sp_* + assertion queries

frontend/
├── src/
│   ├── index.html               # Entry point
│   ├── css/
│   │   ├── tokens.css           # oklch() design tokens (light + dark)
│   │   ├── layout.css           # Double-pane layout
│   │   ├── tree.css             # Directory tree styles
│   │   ├── grid.css             # File grid + card styles
│   │   ├── skeleton.css         # Skeleton screen + shimmer
│   │   └── animations.css       # Hero Reveal + damped slide-out
│   ├── js/
│   │   ├── api.js               # REST client (fetch wrapper)
│   │   ├── state.js             # Client-side state machine
│   │   ├── tree.js              # Directory tree component
│   │   ├── grid.js              # File grid + virtual scroll
│   │   ├── skeleton.js          # Skeleton state manager
│   │   ├── upload.js            # Upload with progress + Hero Reveal trigger
│   │   ├── animations.js        # Animation orchestration
│   │   └── theme.js             # Dark/light mode toggle
│   └── assets/
│       └── fonts/               # Self-hosted serif display fonts
└── tests/
    └── e2e/                     # Playwright E2E tests
```

**Structure Decision**: Web application dual-layer — backend is SQL-first (MySQL stored
procedures as the authoritative business logic layer), frontend is vanilla HTML/CSS/JS
(zero framework, zero Drop-in UI libraries per FR-018).

## Complexity Tracking

> No violations — Constitution Check passed all gates.
