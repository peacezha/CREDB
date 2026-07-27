# CREDB — Cis-Regulatory Elements Database

CREDB 是一个面向生物信息学研究的 Web 平台，用于存储、查询、可视化和分析主要作物物种中的顺式调控元件（cis-regulatory elements, CREs），提供染色质可及性区域（ACRs）的高分辨率图谱。由华中农业大学功能基因组学实验室开发。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Tailwind CSS 3 + React Router 6 + Chart.js 4（`src/`）
- **后端**：Node.js（纯 http 模块）+ mysql2（`server.js`，端口 8001）
- **数据库**：MySQL（主表 `cis_elements` 或 `peaks`，汇总表 `species_stats`）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env   # 然后编辑 .env 填入数据库密码等
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_HOST` | MySQL 主机 | `211.69.142.213` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USER` | 数据库用户 | `ATAC_web` |
| `DB_PASSWORD` | 数据库密码（**必填，无默认**） | — |
| `DB_NAME` | 数据库名 | `atac_web` |
| `PORT` | 后端监听端口 | `8001` |
| `CORS_ORIGINS` | 允许跨域的来源（逗号分隔） | `http://localhost:3000` |
| `VITE_API_BASE` | 前端 API 基地址（构建时注入） | `http://{hostname}:8001/api` |

> **安全提示**：数据库密码曾出现在仓库历史文件中，部署前请轮换密码，并只在服务器的 `.env` 中配置（`.env` 已被 gitignore）。

### 3. 启动

```bash
npm run server   # 后端 API，http://0.0.0.0:8001
npm run dev      # 前端开发服务器（Vite），http://localhost:3000
```

生产部署：

```bash
npm run build    # 输出到 build/，server.js 会直接托管该目录
npm run server
```

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 生产构建到 `build/` |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run server` | 启动后端 API |
| `npm run import` / `import-all` | 批量导入数据（bulk_import.js） |
| `npm run db:audit` | 数据库只读体检报告（scripts/db_audit.js） |
| `npm run db:optimize` | 数据库优化迁移，dry-run；加 `-- --apply` 实际执行 |

## 数据库优化

主表约 20GB。先在服务器上运行体检：

```bash
npm run db:audit
```

报告会输出表/索引现状、关键查询的 EXPLAIN、数据质量检查，以及按收益排序的优化建议。按报告指引执行迁移（默认 dry-run，确认无误后加 `--apply`）：

```bash
node scripts/db_optimize.js            # 只打印将执行的 SQL
node scripts/db_optimize.js --apply    # 实际执行（建议在维护窗口）
```

主要优化项：position 解析为 `chrom/start_pos/end_pos` 持久列 + 复合索引、数值列类型矫正、`peak_id`/`nearest_gene` 全文索引。

## ISM 在线分析的前提

`/api/predict` 依赖服务器上的 conda 环境（如 `wheat_ism`）与微调模型目录，详见 `PROJECT_OVERVIEW.md`。接口已做物种白名单校验、请求体大小限制与频率限制。

## 目录结构

```
├── index.html              # Vite 入口
├── vite.config.ts          # Vite 配置（构建输出 build/）
├── tailwind.config.js      # 设计系统 token（paper/journal/navy/burgundy）
├── postcss.config.js
├── server.js               # 后端 API + 静态托管
├── bulk_import.js          # 批量导入工具
├── scripts/
│   ├── db_audit.js         # 数据库只读体检
│   └── db_optimize.js      # 数据库优化迁移（dry-run/--apply）
├── public/icon/            # 物种图标
└── src/
    ├── index.tsx           # React 入口（HashRouter）
    ├── index.css           # Tailwind + 全局样式
    ├── App.tsx             # 路由表（React.lazy 代码分割）
    ├── types.ts            # 共享类型
    ├── services/api.ts     # API 服务层（AbortController/超时/统一错误）
    ├── components/         # Navbar / Footer / DataGrid / Modal / UploadModal
    └── pages/              # Home / DataViewer / Analysis / JBrowse / Download / Submit / Help
```
