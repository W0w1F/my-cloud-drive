# Feature Specification: 虚拟文件系统——文件与目录管理

**Feature Branch**: `001-virtual-filesystem`

**Created**: 2026-06-09

**Status**: Draft

**Input**: User description: "实体与元数据：用户（ID、用户名）、虚拟文件/目录节点（名称、大小、哈希值、父目录ID、修改时间、删除状态）、物理文件块（哈希值、大小、真实路径、引用计数）。基础操作：支持文件的上传、下载、移动（更改父目录）、搜索（按名称/类型模糊匹配）；支持目录的新建、重命名、级联软删除。验收标准：虚拟文件层（file_nodes）与物理存储层（file_blocks）完全解耦；目录结构设计必须完美支持无限层级目录树的演进。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 文件上传与去重存储 (Priority: P1)

用户选择一个本地文件上传至云盘的指定目录。系统接收文件后计算其 SHA-1 哈希值：
若该哈希值对应的物理文件块已存在（无论属于哪个用户），则仅创建一条虚拟文件节点
记录并递增物理块的引用计数，实现秒传效果；若哈希值不存在，则完整写入物理存储后
再创建虚拟节点与物理块记录。上传完成后用户可在目标目录中立即看到新文件。

**Why this priority**: 上传是云盘系统的核心入口功能。去重存储直接决定存储成本和
多用户场景下的用户体验（秒传）。没有上传能力，系统无法提供任何价值。

**Independent Test**: 可通过上传一个文件到根目录并验证文件出现在目录列表中完全
测试。进一步可上传相同内容的文件到不同目录，验证引用计数递增而非重复存储。

**Acceptance Scenarios**:

1. **Given** 用户已登录且目标目录为空，**When** 用户上传一个大小为 10MB 的 PDF
   文件到该目录，**Then** 文件成功存储，目录中出现该文件的虚拟节点记录（名称、
   大小、修改时间为上传时刻），物理存储中新增一条引用计数为 1 的物理块记录。
2. **Given** 物理存储中已存在 SHA-1 值为 `abc123` 的文件块（ref_count=3），
   **When** 另一用户上传一个内容相同（SHA-1 同为 `abc123`）的文件到其个人目录，
   **Then** 系统不重复写入物理存储，仅创建新的虚拟文件节点，物理块 ref_count
   更新为 4，上传操作在 1 秒内完成（秒传）。
3. **Given** 用户上传过程中网络中断，**When** 传输未完成，**Then** 系统不创建
   任何虚拟节点或物理块记录，已传输的部分数据被清理，用户收到明确的失败提示。

---

### User Story 2 - 文件下载 (Priority: P1)

用户在目录视图中选择一个文件并触发下载。系统根据虚拟文件节点定位到对应的物理
文件块，读取真实存储路径后以流式方式将文件内容返回给用户。下载过程中若物理文件
块缺失或损坏，系统应给出明确的错误提示。

**Why this priority**: 下载是上传的对称操作，构成云盘基础闭环。用户上传文件的
唯一目的就是后续能够取回。

**Independent Test**: 上传一个测试文件后，通过其路径触发下载，验证下载内容与原
文件逐字节一致。

**Acceptance Scenarios**:

1. **Given** 虚拟文件节点 `report.pdf` 有效关联至物理块 `blk_001`（真实路径
   `/storage/blocks/ab/c3/abc123...`），**When** 用户请求下载该文件，**Then**
   系统以流式传输返回完整文件内容，HTTP 响应头包含正确的 `Content-Type` 和
   `Content-Length`。
2. **Given** 虚拟文件节点指向的物理块文件在磁盘上被意外删除，**When** 用户请求
   下载该文件，**Then** 系统返回明确错误信息"文件数据不可用"，并记录异常日志。

---

### User Story 3 - 目录管理：新建、重命名与级联软删除 (Priority: P2)

用户可以在任意已有目录下创建子目录，也可以对目录进行重命名。当用户删除一个目录
时，系统将该目录及其所有子孙节点（文件和子目录）的 `status` 标记为 `deleted`，
数据本身保留不物理删除。被标记为删除的目录和文件在默认列表视图中不可见。

**Why this priority**: 目录树是用户组织文件的唯一手段。没有目录管理，用户无法
在文件数量增长后维持结构化的数据组织。级联软删除直接实现宪章 I "数据安全性优先"
原则。

**Independent Test**: 创建一个三层目录结构 `A/B/C`，在 C 中上传文件 `f.txt`，
然后软删除目录 A。验证 A、B、C、f.txt 的状态均为 `deleted`，且物理块 ref_count
未归零时不会被清理。

**Acceptance Scenarios**:

1. **Given** 用户处于目录 `/work` 下，**When** 用户创建名为 `reports` 的子目录，
   **Then** 系统在 `/work/reports` 路径下创建新目录节点，`status` 为 `active`，
   `parent_id` 指向 `/work`。
2. **Given** 目录 `/work/old_name` 存在，**When** 用户将其重命名为 `new_name`，
   **Then** 目录节点名称更新为 `new_name`，修改时间更新，所有子孙节点的全路径
   查询结果自动反映新名称。
3. **Given** 目录树 `/project/src` 包含文件 `main.py` 和子目录 `lib/`（含
   `util.py`），**When** 用户执行软删除 `/project`，**Then** `/project`、
   `/project/src`、`/project/src/main.py`、`/project/src/lib`、
   `/project/src/lib/util.py` 全部节点的 `status` 同步变更为 `deleted`，操作在
   一笔事务内完成。

---

### User Story 4 - 文件移动与搜索 (Priority: P3)

用户可以将文件从一个目录移动到另一个目录（更改 `parent_id`），也可以按文件名或
文件类型（扩展名）进行模糊搜索，快速定位目标文件。

**Why this priority**: 移动和搜索是提升日常使用效率的辅助功能。在基础的上传下载
和目录管理就绪后，这些功能显著改善用户体验。

**Independent Test**: 上传文件 `photo.jpg` 到 `/tmp`，将其移动至 `/photos`，
验证文件不再出现在 `/tmp` 而出现在 `/photos`。搜索 `photo` 应返回该文件，
搜索 `*.jpg` 同样应返回该文件。

**Acceptance Scenarios**:

1. **Given** 文件 `/tmp/draft.md` 存在，**When** 用户将其移动到 `/docs/`，
   **Then** `draft.md` 的 `parent_id` 更新为 `/docs` 的节点 ID，修改时间更新，
   在 `/tmp` 下不再可见，在 `/docs` 下可见。操作记录写入 `audit_log`（操作类型
   `MOVE_FILE`）。
2. **Given** 目录下有 `report.pdf`、`photo.jpg`、`notes.txt` 三个文件，**When**
   用户搜索关键词 `port`，**Then** 系统返回 `report.pdf`（名称包含 "port"）。
3. **Given** 同上文件列表，**When** 用户搜索 `*.jpg`（按扩展名模糊匹配），
   **Then** 系统返回 `photo.jpg`。
4. **Given** 用户试图将目录 `/A` 移动到其自身的子目录 `/A/B/` 下，**When**
   移动操作提交，**Then** 系统检测到循环引用并拒绝操作，返回明确的错误提示。

---

### Edge Cases

- 同一用户在同一目录下上传同名文件时，系统如何处理？（假设：拒绝并提示"文件已
  存在"，或提供覆盖选项——默认拒绝。）
- 上传 0 字节空文件：系统是否允许？物理块如何处理？（假设：允许，SHA-1 仍计算，
  物理块大小为 0 但正常记录。）
- 文件/目录名包含特殊字符（`/`、`\0`、emoji）：是否允许？（假设：允许 Unicode，
  禁止 `/` 和 `\0` 字符，名称长度限制 1-255 字符。）
- 搜索无结果时返回空列表还是错误？（假设：返回空列表，HTTP 200。）
- 并发上传相同新文件（SHA-1 尚不存在于 physical_blocks）：两个事务同时发现
  哈希缺失并尝试插入——需通过唯一索引 + 事务重试或 `ON CONFLICT` 保证最终一致。
- 目录深度达到 255 层上限时继续创建子目录：拒绝并提示"目录层级已达上限"。
- 被软删除的目录下不能创建新文件/子目录：操作前 MUST 检查祖先节点状态链。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 支持用户注册与登录，用户实体包含唯一 ID 和用户名。
- **FR-002**: 系统 MUST 为每个文件/目录维护一条 `file_nodes` 记录，包含：名称、
  大小（目录为 0）、SHA-1 哈希值（目录为空）、父目录 ID（根目录为 `NULL`）、
  节点类型（`file` / `directory`）、修改时间、删除状态（`active` / `deleted`）。
- **FR-003**: 系统 MUST 为每个唯一文件内容维护一条 `file_blocks` 记录，包含：
  SHA-1 哈希值、文件大小、物理存储路径、引用计数（`ref_count`）。
- **FR-004**: 系统 MUST 在文件上传时计算内容的 SHA-1 哈希值，并在
  `physical_blocks` 表中按哈希值查重：命中则只创建 `file_nodes` 记录并递增
  `ref_count`；未命中则写入物理存储后创建 `file_nodes` 与 `file_blocks` 记录。
- **FR-005**: 系统 MUST 通过 `file_nodes.hash → file_blocks.sha1_hash → file_blocks.real_path` 的三级映射实现虚拟文件层与物理存储层的完全解耦。
- **FR-006**: 系统 MUST 支持通过 `parent_id` 自引用实现无限层级目录树；全路径
  查询 MUST 使用递归 CTE 一次性完成。
- **FR-007**: 所有删除操作 MUST 为软删除（变更 `status` 字段为 `deleted`），
  严禁物理 `DELETE` 语句。
- **FR-008**: 目录级联软删除 MUST 将目标目录及其所有子孙节点的 `status` 同步
  标记为 `deleted`，操作 MUST 在一笔数据库事务内完成。
- **FR-009**: 系统 MUST 维护 `audit_log` 审计表，记录每次 `status` 变更（文件
  删除/恢复）和 `parent_id` 变更（文件/目录移动）的操作者、时间戳、变更前后值。
- **FR-010**: 用户 MUST 能够按文件名或文件扩展名进行模糊搜索，搜索结果仅包含
  当前未被软删除（`status = 'active'`）的文件和目录。
- **FR-011**: 文件移动操作 MUST 验证目标不是源节点的子孙节点，禁止形成循环引用。
- **FR-012**: 系统 MUST 防止并发上传相同新文件时产生重复物理块记录：依赖
  `physical_blocks.sha1_hash` 唯一索引 + 事务级冲突处理。

### Key Entities

- **User**: 系统用户。关键属性：`id`（唯一标识）、`username`（登录名）。与
  `file_nodes` 为 1:N 关系（所有者）。
- **FileNode**: 虚拟文件/目录节点。关键属性：`id`、`name`、`type`（file/dir）、
  `size`、`hash`（SHA-1，目录为空）、`parent_id`（自引用外键）、`owner_id`（→
  User）、`modified_at`、`status`（active/deleted）。通过 `hash` 关联至
  `PhysicalBlock`（文件类型时），通过 `parent_id` 自引用形成目录树。
- **PhysicalBlock**: 物理存储块。关键属性：`sha1_hash`（唯一）、`size`、
  `real_path`（磁盘绝对路径）、`ref_count`。一个物理块可被多个 `FileNode`
  引用（N:1）。
- **AuditLog**: 审计记录。关键属性：`id`、`timestamp`、`operator_id`（→ User）、
  `operation_type`（枚举：DELETE_FILE、RESTORE_FILE、MOVE_FILE、MOVE_DIRECTORY、
  RENAME_DIRECTORY）、`target_node_id`、`old_value`（JSON）、`new_value`（JSON）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 用户上传 100MB 文件时，从确认上传到文件出现在目录列表中的端到端
  耗时不超过 10 秒（不含网络传输时间）。
- **SC-002**: 相同内容的文件被不同用户上传时，第二次上传（秒传）的端到端耗时
  不超过 500 毫秒。
- **SC-003**: 在 10 层深的目录树下查询叶子节点的完整路径，响应时间不超过 50
  毫秒。
- **SC-004**: 级联软删除一个包含 1000 个子节点（文件+目录）的目录树，操作在
  3 秒内完成且所有节点状态一致。
- **SC-005**: 并发上传相同新文件（SHA-1 首次入库）时，物理块表中仅产生一条记录，
  引用计数等于并发上传数，无重复物理块或计数错误。
- **SC-006**: 用户在包含 10,000 个文件节点的目录树中按名称模糊搜索，结果在
  1 秒内返回。

## Assumptions

- 用户认证系统已由外部模块提供，本功能仅依赖用户 ID。
- 物理文件存储采用本地文件系统（或挂载卷），路径格式遵循 POSIX 标准。
- 数据库采用支持递归 CTE 的关系型数据库（如 PostgreSQL 14+ 或 MySQL 8.0+）。
- 文件上传通过 HTTP multipart/form-data 协议进行，下载通过 HTTP 流式响应。
- 默认文件/目录名长度限制为 255 字符，全路径深度限制为 255 层（值可配置）。
- 单个文件大小上限由部署配置决定（默认 10GB）。
- 软删除记录默认永久保留，清理策略由数据库事件调度器按可配置周期执行。
- 搜索为服务端模糊匹配（`LIKE '%keyword%'`），不涉及全文索引或搜索引擎。
