# 云盘文件管理系统

基于 Huashu Design 设计哲学的云盘文件管理系统，实现虚拟文件层与物理存储层完全解耦，支持 SHA-1 去重秒传、无限层级目录树。

## 当前部署

> 以下为示例部署信息，使用时请替换为自己的服务器地址。

| 角色 | 地址 |
|------|------|
| 🖥️ 服务器（后端 + 数据库） | `<服务器IP>` (Ubuntu 22.04 VM) |
| 💻 客户端（浏览器） | 任意内网机器访问 `http://<服务器IP>:8081` |

**配置步骤**：
1. 修改 `.env` 中的 `CORS_ORIGIN` 为你的服务器 IP
2. 启动服务后，浏览器访问 `http://<服务器IP>:8081`

## 功能

### 认证与安全
- **注册** — bcrypt 密码哈希，最小 8 位含字母+数字，拒绝弱密码
- **登录** — JWT 令牌认证（7 天有效期），客户端解析 exp 自动校验
- **登录守卫** — 未登录/过期令牌自动跳转登录页，401/403 自动重定向
- **速率限制** — 登录 10次/15min，上传 30次/15min，API 100次/15min
- **密码安全** — bcrypt rounds=10，长度 8-128 位，必须含字母和数字

### 文件操作
- **上传** — 流式 SHA-1 哈希计算，文件不读入内存，支持 10GB 大文件
- **秒传** — SHA-1 哈希命中时 ref_count+1，零字节拷贝，Hero Reveal 动画反馈
- **下载** — JWT 鉴权，Range 断点续传（206 Partial Content），自适应 Content-Type
- **预览** — 文本/图片/二进制自动识别，<5MB 文本在线查看
- **搜索** — MySQL FULLTEXT ngram 全文索引，中英文混合搜索，BOOLEAN 前缀匹配
- **排序** — 按名称/大小/时间升序降序排列

### 目录管理
- **新建目录** — 工具栏创建，同名检测防重复
- **层级导航** — 无限层级目录树，递归 CTE 支持
- **面包屑** — 网格顶部显示当前路径，点击「根目录」一键返回

### 安全过滤
- **文件类型** — 拒绝 .exe/.sh/.bat/.apk 等 15 种可执行文件
- **文件名消毒** — 自动替换路径穿越字符 / \ : NUL
- **CSP 安全头** — script-src 'self'，零内联脚本，零第三方 CDN
- **CORS 白名单** — Origin 回调校验，支持逗号分隔多域名

### 回收站
- **软删除** — 右键/长按删除，阻尼滑出动画 + 递归级联
- **恢复** — 单文件恢复 / 全部恢复（批量 API 一次请求）
- **清空** — 永久删除所有已删除文件
- **撤销** — 删除后 5 秒内底部 Snackbar 可撤销
- **自动清理** — MySQL Event Scheduler 每天清理 30 天前删除的文件

### 界面
- **双栏布局** — 左侧目录树 280px + 右侧文件网格
- **暗色模式** — 右上角一键切换，localStorage + 系统偏好
- **Huashu Design** — 锈橙 #C04A1A 主色调，oklch() 中性灰阶，Source Serif 4 衬线字体
- **渐进式渲染** — IntersectionObserver 分批加载，500 文件首屏秒开
- **骨架屏** — 300ms 最小显示时间，shimmer 动画加载反馈
- **Hero Reveal** — 秒传时进度卡片"绽放"为完整文件卡片

## 技术架构

```
┌─────────────────────────────────────────────┐
│  frontend/src/         Vanilla HTML/CSS/JS   │
│  ├── index.html        入口（双栏布局）         │
│  ├── login.html        登录/注册页面           │
│  ├── css/              7 个样式文件             │
│  │   ├── tokens.css    oklch() 设计令牌         │
│  │   ├── layout.css    双栏布局                 │
│  │   ├── tree.css      目录树                   │
│  │   ├── grid.css      文件网格                 │
│  │   ├── skeleton.css  骨架屏                   │
│  │   ├── animations.css  Hero Reveal + 滑出    │
│  │   └── fonts.css     字体定义                │
│  └── js/               11 个脚本文件            │
│      ├── api.js        REST 客户端 (JWT)       │
│      ├── auth.js       认证管理器              │
│      ├── state.js      事件驱动状态机           │
│      ├── utils.js      公共工具函数            │
│      ├── init.js       页面初始化              │
│      ├── theme.js      暗色模式切换            │
│      ├── skeleton.js   骨架屏管理器            │
│      ├── tree.js       目录树组件              │
│      ├── grid.js       文件网格 + 渐进式渲染    │
│      ├── upload.js     上传 + Hero Reveal      │
│      └── animations.js 动画编排器              │
├─────────────────────────────────────────────┤
│  backend/api/          Node.js API 网关       │
│  └── server.js         16 个 REST 端点         │
│      (含 JWT / CORS / CSP / 速率限制 / 优雅退出)│
├─────────────────────────────────────────────┤
│  backend/sql/          MySQL 存储过程层        │
│  ├── 000-init.sql      建库 + Event Scheduler  │
│  ├── 001-schema.sql    DDL (4 表)              │
│  ├── 002-dcl.sql       用户 + 最小权限          │
│  ├── 003-stored-procedures.sql  上传/删除/恢复  │
│  ├── 004-functions.sql 递归 CTE 路径计算        │
│  ├── 005-triggers.sql  审计日志 + 引用计数       │
│  ├── 006-events.sql    30 天自动清理            │
│  ├── 007-indexes.sql   复合索引                │
│  ├── 008-maintenance.sql 监控 + 备份           │
│  └── 009-fulltext.sql  FULLTEXT 全文索引       │
├─────────────────────────────────────────────┤
│  Dockerfile + docker-compose.yml              │
│  一键部署 (MySQL 8.0 + Node 20 Alpine)        │
└─────────────────────────────────────────────┘
```

## 数据库

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `users` | 用户 | id, username, password_hash |
| `file_nodes` | 虚拟文件/目录 | name, type, hash, parent_id, status |
| `physical_blocks` | 物理存储块 | sha1_hash (UNIQUE), real_path, ref_count |
| `audit_logs` | 审计日志 (不可篡改) | operation_type, old_value, new_value (JSON) |

**权限模型**：`drive_app`（最小权限：仅 SELECT/INSERT/UPDATE/EXECUTE）｜ `drive_admin`（迁移维护）

## 快速启动

### Docker（推荐）

```bash
docker-compose up -d
# 打开 http://<服务器IP>:8081
```

### 手动启动（Ubuntu 22.04）

```bash
# 1. 安装依赖
sudo apt update
sudo apt install -y mysql-server nodejs npm

# 2. 安全初始化 MySQL
sudo mysql_secure_installation
# 设置 root 密码，权限策略选 LOW，其余全 Y

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入数据库配置，并将 CORS_ORIGIN 改为服务器地址
# - dev:   CORS_ORIGIN=http://localhost:8081
# - 部署:  CORS_ORIGIN=http://<你的IP>:8081

# 4. 数据库初始化（按顺序执行全部 SQL 文件）
for f in backend/sql/0*.sql; do
  sudo mysql -u root -proot < "$f" 2>/dev/null
done

# 5. 安装依赖并启动 API
cd backend/api && npm install && node server.js

# 6. 浏览器访问
# http://<服务器IP>:8081
```

> ⚠️ **注意**：MySQL 8.0 禁止 GRANT 隐式创建用户，`002-dcl.sql` 已为 `drive_app@%` 和 `drive_app@localhost` 明确执行 `CREATE USER`。

### 手动启动（Windows）

```bash
# 1. 确保 MySQL 8.0 服务运行中

# 2. 数据库初始化
mysql -u root -proot < backend/sql/000-init.sql
for f in backend/sql/001-schema.sql backend/sql/002-dcl.sql backend/sql/0*.sql; do
  mysql -u root -proot < "$f"
done

# 3. 启动 API
cd backend/api && npm install && node server.js

# 4. 浏览器
open http://localhost:8081
```

## 文件存储结构

上传的物理文件按 SHA-1 哈希值存储，实现虚拟层与物理层解耦：

```
backend/
├── uploads/              ← 临时上传目录（multer，处理后自动删除）
└── storage/blocks/       ← 最终物理存储（按哈希分两层目录）
    └── ab/               ← SHA-1 前 2 位
        └── cd/           ← SHA-1 第 3–4 位
            └── abcde...  ← 完整 40 位 SHA-1 哈希（无扩展名）
```

- 同一文件即使上传到不同目录，物理上只存一份（`ref_count` 计数）
- 虚拟层的文件名、目录结构全部在 MySQL `file_nodes` 表中

## 已知问题 / 排错

### MySQL 8.0 GRANT 权限错误

```
ERROR 1410 (42000): You are not allowed to create a user with GRANT
```

**原因**：MySQL 8.0+ 不允许 `GRANT` 隐式创建用户，必须先 `CREATE USER`。

**解决**：确保 `002-dcl.sql` 中为 `'drive_app'@'%'` 和 `'drive_app'@'localhost'` 都执行了 `CREATE USER IF NOT EXISTS ... IDENTIFIED BY ...`，`GRANT` 才能成功。

### `execute command denied to user 'drive_app'@'%'`

**原因**：DCL 脚本在中途报错中断后，`drive_app` 未获得存储过程的 `EXECUTE` 权限。

**解决**：
```sql
GRANT EXECUTE ON cloud_drive.* TO 'drive_app'@'%';
GRANT EXECUTE ON cloud_drive.* TO 'drive_app'@'localhost';
FLUSH PRIVILEGES;
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 数据库 | MySQL 8.0（递归 CTE / Event Scheduler / FULLTEXT ngram） |
| 认证 | JWT (jsonwebtoken) + bcryptjs |
| 后端 | Node.js + Express 5 + mysql2 |
| 安全 | CSP / CORS / rate-limit / multer 过滤 / 文件名消毒 |
| 前端 | Vanilla HTML/CSS/JS（零框架 / 零 CDN） |
| 字体 | Source Serif 4 SIL OFL（自托管 woff2） |
| 设计 | Huashu Design（锈橙 #C04A1A + oklch()） |
| 部署 | Docker + docker-compose |
| 测试 | Playwright E2E（12 个测试用例） |
