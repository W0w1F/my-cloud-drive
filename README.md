# 云盘文件管理系统

基于 Huashu Design 设计哲学的云盘文件管理系统，实现虚拟文件层与物理存储层完全解耦，支持 SHA-1 去重秒传、无限层级目录树。

## 功能

### 文件操作
- **上传** — 拖拽或点击上传，自动 SHA-1 哈希去重
- **下载** — 卡片底部下载按钮
- **秒传** — 相同文件瞬时完成 (Hero Reveal 动画)
- **搜索** — 文件名模糊匹配
- **排序** — 按名称 / 大小 / 时间排序

### 目录管理
- **新建目录** — 工具栏创建
- **层级导航** — 无限层级目录树，点击目录名跳转
- **文件跳转** — 点击左侧文件名直接跳转到所在目录

### 回收站
- **软删除** — 右键 / 长按删除，阻尼滑出动画
- **恢复** — 回收站内单文件恢复或全部恢复
- **清空** — 永久删除回收站全部文件
- **撤销** — 删除后 5 秒内底部 Snackbar 撤销

### 界面
- **双栏布局** — 左侧目录树 (280px) + 右侧文件网格
- **暗色模式** — 右上角一键切换
- **开屏动画** — 锈橙线条 + 云盘标题淡入
- **统一圆角** — 16px 大圆角卡片风格

## 技术架构

```
┌─────────────────────────────────────────────┐
│  frontend/src/         Vanilla HTML/CSS/JS   │
│  ├── index.html        入口 (CSP 安全头)       │
│  ├── css/              7 个样式文件             │
│  │   ├── tokens.css    oklch() 设计令牌         │
│  │   ├── layout.css    双栏布局                 │
│  │   ├── tree.css      目录树                   │
│  │   ├── grid.css      文件网格                 │
│  │   ├── skeleton.css  骨架屏                   │
│  │   └── animations.css  Hero Reveal + 滑出    │
│  └── js/               8 个脚本文件             │
│      ├── api.js        REST 客户端             │
│      ├── state.js      事件驱动状态机           │
│      ├── tree.js       目录树组件              │
│      ├── grid.js       文件网格组件            │
│      ├── skeleton.js   骨架屏管理器            │
│      ├── upload.js     上传 + Hero Reveal      │
│      └── animations.js 动画编排器              │
├─────────────────────────────────────────────┤
│  backend/api/          Node.js API 网关       │
│  └── server.js         10 个 REST 端点         │
├─────────────────────────────────────────────┤
│  backend/sql/          MySQL 存储过程层        │
│  ├── 001-schema.sql    DDL                    │
│  ├── 002-dcl.sql       用户 + 权限             │
│  ├── 003-stored-procedures.sql  核心业务逻辑    │
│  ├── 004-functions.sql fn_get_node_full_path  │
│  ├── 005-triggers.sql  审计 + 引用计数          │
│  ├── 006-events.sql    定时清理                │
│  ├── 007-indexes.sql   复合索引                │
│  └── 008-maintenance.sql 监控 + 备份           │
└─────────────────────────────────────────────┘
```

## 快速启动

### 1. 数据库

```bash
mysql -u root -p < backend/sql/000-init.sql
mysql -u root -p cloud_drive < backend/sql/001-schema.sql
mysql -u root -p cloud_drive < backend/sql/002-dcl.sql
mysql -u root -p cloud_drive < backend/sql/003-stored-procedures.sql
mysql -u root -p cloud_drive < backend/sql/004-functions.sql
mysql -u root -p cloud_drive < backend/sql/005-triggers.sql
mysql -u root -p cloud_drive < backend/sql/006-events.sql
mysql -u root -p cloud_drive < backend/sql/007-indexes.sql
```

### 2. API 网关

```bash
cd backend/api
npm install
node server.js
```

### 3. 浏览器

打开 `http://localhost:8081`

## 数据模型

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `users` | 用户 | id, username |
| `file_nodes` | 虚拟文件/目录 | name, type, hash, parent_id, status |
| `physical_blocks` | 物理存储块 | sha1_hash (UNIQUE), real_path, ref_count |
| `audit_logs` | 审计日志 (只追加) | operation_type, old_value, new_value (JSON) |

```
users 1──N file_nodes N──1 file_nodes (parent_id 自引用)
                     N──1 physical_blocks (via hash)
users 1──N audit_logs
```

## 权限模型

| 用户 | 权限 |
|------|------|
| `drive_app` | SELECT, INSERT, UPDATE, EXECUTE — 无 DELETE/DDL |
| `drive_admin` | 全部权限 — 仅用于迁移和维护 |

## 技术栈

- **数据库**: MySQL 8.0+ (递归 CTE, Event Scheduler, JSON)
- **后端**: Node.js + Express + mysql2
- **前端**: Vanilla HTML/CSS/JS (零框架)
- **字体**: Source Serif 4 (SIL OFL)
- **设计系统**: Huashu Design (锈橙 #C04A1A + oklch() 中性灰阶)
