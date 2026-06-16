<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Modified principles: None (existing I-III preserved verbatim)
Added principles:
  - IV. 权限与控制底线 (Least Privilege & Access Control)
  - V. 审计合规底线 (Audit Compliance)
  - VI. 高级对象规范 (Stored Procedures & Event-Driven Cleanup)
Added sections: None (new principles integrated into existing Core Principles list)
Modified sections:
  - AI 代码生成审计规则: expanded to cover stored procedure audit requirements
  - Governance: compliance review expanded to cover all six principles
Removed sections: None
Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ compatible (Constitution Check gate is generic)
  - .specify/templates/spec-template.md: ✅ compatible (no constitution-specific references)
  - .specify/templates/tasks-template.md: ✅ compatible (no constitution-specific references)
  - .specify/templates/commands/: N/A (no commands directory exists)
Follow-up TODOs: None
-->

# 云盘文件管理系统——目录树与去重存储 Constitution

## Core Principles

### I. 数据安全性优先 (Data Safety First)

所有文件与目录删除操作 MUST 采用软删除机制——通过 `status` 字段标记删除状态
（如 `active` / `deleted`），而非物理删除记录。物理 `DELETE` SQL 语句严禁出现在
AI 生成代码中；任何涉及物理删除的代码 MUST 经过人工审计并附书面批准。软删除记录
MUST 支持可配置的保留周期（默认永久保留），以便数据恢复与审计追溯。

**Rationale**: 云盘系统的核心资产是用户数据。物理删除不可逆，一旦误删或逻辑
出错将造成不可挽回的数据丢失。软删除机制确保数据可恢复，为运维和用户提供安全
保障。

### II. 存储成本控制优先 (Storage Cost Control First)

文件实体入库前 MUST 强制计算并验证 SHA-1 哈希值。系统 MUST 维护物理文件块
（physical block）的引用计数（`ref_count`），实现多用户/多目录间的秒传去重：
当多个用户或多次上传指向相同的 SHA-1 哈希时，仅增加引用计数而不复制底层存储。
引用计数归零时方可物理清除文件块，且此操作 MUST 经过审批审计。

**Rationale**: 云盘存储成本随用户规模线性增长。基于内容哈希的去重可以显著降低
冗余存储，引用计数机制确保多用户共享同一物理文件块时的计费与清理逻辑正确、安全。

### III. 高性能与原子性优先 (High Performance & Atomicity First)

所有涉及层级目录树的全路径查询 MUST 使用递归公共表表达式（Recursive CTE），
禁止在应用层逐层循环拼接路径。并发场景下的文件块分配（block allocation）、
引用计数更新（`ref_count` 增/减）MUST 包裹在强一致性事务锁（如
`SELECT ... FOR UPDATE`）中，确保读-改-写操作的原子性与隔离性。事务粒度 MUST
尽可能小，持有锁的时间 SHOULD 在毫秒级。

**Rationale**: 目录树的层级深度不确定，逐层拼接在深层嵌套下性能急剧退化。递归
CTE 利用数据库优化器在一次查询中完成全路径计算。引用计数的并发更新若无锁保护，
会导致竞态条件下的计数漂移，进而引发存储泄漏或过早删除。

### IV. 权限与控制底线 (Least Privilege & Access Control)

数据库连接 MUST 严格遵循最小权限原则（Principle of Least Privilege）。所有业务
操作（CRUD、去重上传、路径查询、软删除）MUST 通过应用层专用数据库用户
（`app_user`）执行，该用户仅持有 `SELECT`、`INSERT`、`UPDATE` 及存储过程/函数
的 `EXECUTE` 权限。严禁任何业务代码或 AI 生成代码使用 `root`、`postgres`、
`sa` 等超级管理员账户直连数据库。DDL 操作（Schema 变更、索引创建）MUST 由独立
的迁移专用账户在离线维护窗口执行，且与业务运行时账户完全隔离。

**Rationale**: 最小权限原则是纵深防御的第一道关口。超级管理员账户一旦泄露或
被代码注入利用，攻击面将覆盖全库。应用层专用用户的权限白名单将爆炸半径限制在
业务表范围内，即使应用层出现 SQL 注入也无法执行 DDL 或跨 Schema 攻击。

### V. 审计合规底线 (Audit Compliance)

任何涉及文件删除（`status` 变更）、目录移动（`parent_id` 变更）的 DML 操作 MUST
具备不可篡改的审计留痕能力。系统 MUST 维护 `audit_log` 表，记录以下字段：
操作时间戳、操作者 ID、操作类型（`DELETE_FILE`、`MOVE_DIRECTORY`、`RESTORE_FILE`
等）、目标资源 ID、变更前值（`old_value` JSON）、变更后值（`new_value` JSON）。
审计日志 MUST 通过数据库触发器或存储过程自动写入，禁止应用层绕过审计直接执行
DML。审计日志表 MUST 设置为只追加（`INSERT`-only），禁止 `UPDATE` 或 `DELETE`。

**Rationale**: 数据删除与目录移动是用户数据生命周期中最敏感的操作。不可篡改的
审计轨迹既是合规刚需（如 GDPR 数据处理记录），也是事后追溯误操作或恶意行为的
唯一依据。触发器级审计确保即使应用层代码绕过业务逻辑也无法逃脱审计。

### VI. 高级对象规范 (Stored Procedures & Event-Driven Cleanup)

业务核心逻辑 MUST 封装在数据库存储过程（Stored Procedure）与函数（Function）
中，禁止在应用层以裸 SQL 或 ORM 拼接方式实现以下操作：

- 文件去重上传流程（SHA-1 比对 → 物理块分配 → 引用计数递增 → 逻辑文件创建）
- 目录树全路径计算（递归 CTE 路径拼接）
- 软删除级联标记（递归标记子孙节点 `status = 'deleted'`）
- 引用计数递减与物理块清理判定

清理逻辑（过期软删除记录清理、零引用物理块回收）MUST 由数据库事件调度器
（如 PostgreSQL `pg_cron`、MySQL Event Scheduler）自动化驱动，禁止依赖外部
cron 脚本或应用层定时任务。调度器配置 MUST 作为数据库迁移脚本的一部分纳入版本
控制。

**Rationale**: 存储过程将核心业务逻辑与数据库引擎原子化绑定，消除网络往返开销
与应用层-数据库状态不一致窗口。事件调度器确保清理任务不依赖应用进程存活，避免
单点故障导致的清理积压。两者结合将去重、路径计算、审计、清理四条关键链路收拢
至数据库端统一治理。

## 数据完整性约束 (Data Integrity Constraints)

- **SHA-1 哈希唯一性**: `physical_blocks.sha1_hash` 字段 MUST 建立唯一索引。
- **引用计数非负**: `physical_blocks.ref_count` MUST 具有
  `CHECK (ref_count >= 0)` 约束。
- **目录无环约束**: 目录树的父子关系 MUST 通过存储过程内事务校验，
  禁止形成循环引用（如目录不能将自己的祖先设为其子目录）。
- **路径深度限制**: 全路径总长度 MUST 不超过 4096 字符；单个目录层级深度 MUST
  不超过 255 层。
- **软删除级联**: 父目录被标记为 `deleted` 时，其所有子孙节点 MUST 同步标记为
  `deleted`（通过存储过程内递归 CTE 实现）。
- **审计日志不可变**: `audit_log` 表 MUST 仅授予 `INSERT` 和 `SELECT` 权限；
  `UPDATE` 与 `DELETE` 权限 MUST 被撤销。

## AI 代码生成审计规则 (AI Code Generation Audit Rules)

- AI 生成的 SQL 语句 MUST 通过关键词扫描：`DELETE FROM`、`DROP TABLE`、
  `TRUNCATE` 等破坏性语句出现时，代码审查必须标记为阻塞项。
- AI 生成的事务边界 MUST 包含显式 `BEGIN` / `COMMIT` / `ROLLBACK` 声明。
- 所有 AI 生成的数据库操作代码 MUST 附带注释说明其事务隔离级别与锁策略。
- AI 生成的哈希计算逻辑 MUST 使用标准库实现（禁止自行实现 SHA-1 算法），
  并通过已知向量测试验证。
- AI 生成的存储过程/函数定义 MUST 通过静态分析验证：不得包含动态 SQL
  （`EXECUTE IMMEDIATE` / `PREPARE`）除非有明确的参数化验证；不得包含
  `SECURITY DEFINER` 声明除非经安全评审批准。
- AI 不得生成使用超级管理员账户（`root`、`postgres`、`sa` 等）的连接字符串或
  连接配置。

## Governance

本宪章是项目所有开发实践的最高准则，任何代码实现、架构决策、技术选型均不得与其
抵触。

- **修订流程**: 宪章修订 MUST 以 Pull Request 形式提交，经项目负责人审批后方可
  合并。修订 MUST 更新版本号、最后修订日期，并在 Sync Impact Report 中记录变更。
- **版本策略**: 遵循语义化版本 (SemVer)。MAJOR：原则增删或重新定义；MINOR：
  新增章节或实质性扩展；PATCH：措辞澄清、修正笔误。
- **合规审查**: 每次功能实现的 Plan 阶段 MUST 包含 Constitution Check，逐一验证
  全部六项核心原则的遵循情况。Code Review 阶段 MUST 核查 AI 代码生成审计规则、
  权限底线（禁止 root 直连）及存储过程封装规范。
- **运行时指导**: 日常开发中，开发者 SHOULD 参考 `.specify/templates/` 目录下的
  模板文件获取具体工作流指导。

**Version**: 1.1.0 | **Ratified**: 2026-06-09 | **Last Amended**: 2026-06-09
