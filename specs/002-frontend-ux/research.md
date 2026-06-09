# Research: 云盘文件管理系统技术决策

**Feature**: 002-frontend-ux | **Date**: 2026-06-09

## 1. Database Engine

**Decision**: MySQL 8.0+ (InnoDB)

**Rationale**:
- 用户指令中明确使用 MySQL 专有特性: `mysqldump`, `ANALYZE TABLE`, Event Scheduler
- MySQL 8.0 引入递归 CTE (`WITH RECURSIVE`)，满足宪章 III 的全路径查询要求
- InnoDB 支持行级锁 (`SELECT ... FOR UPDATE`)，满足宪章 III 的强一致性事务锁需求
- JSON 原生类型支持 `audit_logs.old_value` / `new_value` 字段（宪章 V）

**Alternatives considered**:
- PostgreSQL 14+: 同样满足需求但用户指令中无 pg 特征词（如 `pg_cron`）
- SQLite: 不支持 Event Scheduler，不支持用户级权限细分

## 2. API Gateway Layer

**Decision**: Thin API gateway (Node.js/Python/Go — deferred to implementation)

**Rationale**:
- 宪章 VI 要求核心业务逻辑封装在存储过程中，API 层仅做路由转发和认证
- API 层不包含任何 SQL 拼接或 ORM 业务逻辑

**Alternatives considered**:
- Direct MySQL protocol: 不安全，无法做应用层认证
- Full ORM (Prisma/TypeORM): 违背宪章 VI（禁止应用层裸 SQL 拼接业务逻辑）

## 3. Frontend Architecture

**Decision**: Vanilla HTML/CSS/JS — 零框架依赖

**Rationale**:
- FR-018 禁止任何 Drop-in UI 组件库
- Huashu Design 要求"有作者意图的设计"，框架默认主题是 AI Slop 来源
- 虚拟滚动、骨架屏、动画编排均可通过原生 API 实现（IntersectionObserver,
  CSS @keyframes, CSS Grid）

**Alternatives considered**:
- React/Vue + custom design system: 过度工程化，且 React 默认无样式的组件模板
  容易滑向 AI Slop（空状态插画、默认 loading spinner）
- HTMX: 可接受但会丢失前端状态机灵活性

## 4. Display Font Selection

**Decision**: Source Serif 4 (开源, SIL OFL 许可)

**Rationale**:
- FR-016 要求衬线 display 字体（Newsreader / Source Serif 4 / EB Garamond）
- Source Serif 4 中文支持良好（与 Source Han Serif 同族），适合中英混排
- SIL OFL 许可可在项目中 self-host，无外部 CDN 依赖（符合 CSP 约束 FR-022）

**Alternatives considered**:
- Newsreader: 仅拉丁字符，中文 fallback 体验差
- EB Garamond: 经典但字重覆盖不足（仅 Regular + Bold）

## 5. Accent Color Selection

**Decision**: Rust 橙 `#C04A1A` (暖色)

**Rationale**:
- FR-015 提供二选一：rust 橙 `#C04A1A` 或墨绿 `#2D5A27`
- 橙色调在亮色/暗色双主题下均保持高对比度（亮色: `oklch(45% 0.18 40)`, 暗色: `oklch(65% 0.15 40)`)
- 暖色 accent 在文件管理系统中传达"可操作性"（上传、删除等 CTA 按钮），比冷色调墨绿更匹配交互密度

**Alternatives considered**:
- 墨绿 `#2D5A27`: 更冷静专业但 CTA 引导性弱

## 6. Virtual Scrolling Strategy

**Decision**: CSS `content-visibility: auto` + IntersectionObserver 懒加载

**Rationale**:
- 原生 CSS 属性 `content-visibility: auto` 让浏览器自动跳过视口外元素的渲染
- IntersectionObserver 按需加载卡片数据（骨架 → 真实内容）
- 无需引入第三方虚拟滚动库（遵守 FR-018）

**Alternatives considered**:
- react-virtual / react-window: 需要 React 框架，且增加捆绑体积
- 手动计算 scrollTop + absolute positioning: 复杂度高，易出边界 bug

## 7. Event Scheduler Cleanup Policy

**Decision**: 30 天软删除保留 + 每天凌晨 2:00 清理

**Rationale**:
- 用户指令明确 `evt_clean_recycle_bin` 每天凌晨 2 点物理删除 >30 天数据
- 30 天窗口满足 GDPR 数据删除请求的宽限期
- 夜间执行避免与业务高峰抢锁

**Alternatives considered**:
- 7 天保留: 窗口太短，用户可能误删后未及时恢复
- 90 天保留: 存储成本高，且宪章 I 的"默认永久"与物理清理存在张力——30 天是合理折中

## 8. Composite Index Strategy

**Decision**: 
- `idx_file_nodes_parent_status (parent_id, status)` — 加速目录列表查询
- `idx_file_nodes_owner_status (owner_id, status)` — 加速用户文件搜索
- `idx_file_nodes_name_search (name(255), status)` — 加速模糊搜索（前缀索引）
- `idx_physical_blocks_sha1 (sha1_hash)` UNIQUE — 去重查重主键（已含在 DDL）
- `idx_audit_logs_time (created_at)` — 加速审计日志时间范围查询

**Rationale**:
- `(parent_id, status)` 是最常见的查询模式（列出某目录下所有 active 文件）
- 宪章 III 要求全路径递归 CTE，但 CTE 锚点查询仍依赖 `parent_id` 索引
- 前缀索引 `name(255)` 对 `LIKE 'keyword%'` 有效，对 `LIKE '%keyword%'` 仅部分加速
