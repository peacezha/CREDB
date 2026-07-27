# CREDB — Cis-Regulatory Elements Database

## 项目概述

CREDB（Cis-Regulatory Elements Database）是一个面向生物信息学研究的 Web 应用平台，用于存储、查询、可视化和分析主要作物物种中的顺式调控元件（cis-regulatory elements, CREs）。该平台由华中农业大学功能基因组学实验室开发，旨在为研究人员提供染色质可及性区域（ACRs）的高分辨率图谱。

- **项目名称**：credb
- **版本**：2.0.0
- **技术栈**：React 18 + TypeScript + Vite + Tailwind CSS 3 + React Router 6（前端）；Node.js + MySQL（后端）

> 2.0 重构要点：构建工具 CRA → Vite；Tailwind CDN → PostCSS 构建；useState 路由 → React Router（HashRouter）；根目录 AI Studio 重复代码已删除，`src/` 是唯一源码；后端凭据环境变量化并修复了命令注入等安全问题。

---

## 目录结构

```
├── index.html                    # Vite 入口 HTML
├── vite.config.ts                # Vite 配置（dev 端口 3000，构建输出 build/）
├── tailwind.config.js            # 设计系统 token（paper/journal/navy/burgundy + 字体栈）
├── postcss.config.js             # Tailwind + autoprefixer
├── tsconfig.json                 # TS 配置（bundler 解析，仅 include src）
├── package.json
├── .env.example                  # 环境变量模板（无真实密码）
├── .gitignore
├── server.js                     # Node.js 后端（HTTP + MySQL，端口默认 8001）
├── bulk_import.js                # 批量数据导入工具
├── scripts/
│   ├── db_audit.js               # 数据库只读体检（npm run db:audit）
│   └── db_optimize.js            # 数据库优化迁移，dry-run / --apply
├── data/                         # 本地数据文件（gitignored）
├── public/
│   └── icon/                     # 物种图标（构建时原样拷贝）
├── build/                        # 构建产物（gitignored，由 server.js 托管）
└── src/                          # 前端唯一源码
    ├── index.tsx                 # React 入口，引入 index.css
    ├── index.css                 # Tailwind 指令 + 全局基础样式/组件类
    ├── App.tsx                   # HashRouter 路由表 + React.lazy 代码分割
    ├── types.ts                  # 全部共享类型定义
    ├── services/
    │   └── api.ts                # API 服务层（统一封装后端请求）
    ├── components/
    │   ├── Navbar.tsx            # 顶部导航（NavLink 驱动，完整 aria）
    │   ├── Footer.tsx            # 页脚（含 How to Cite 栏目）
    │   ├── DataGrid.tsx          # 数据表格（粘性列、分页、详情弹窗）
    │   ├── Modal.tsx             # 统一无障碍弹窗（ESC/遮罩/焦点管理）
    │   └── UploadModal.tsx       # 上传弹窗（可复用；Submit 页目前用内联表单）
    └── pages/
        ├── Home.tsx              # 首页仪表盘
        ├── DataViewer.tsx        # 数据搜索与浏览
        ├── Analysis.tsx          # 在线 ISM 预测分析
        ├── JBrowse.tsx           # JBrowse2 基因组浏览器嵌入
        ├── Download.tsx          # 数据下载
        ├── Submit.tsx            # 数据上传与管理
        └── Help.tsx              # 用户帮助指南
```

---

## 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                    浏览器（前端 SPA）                       │
│  React 18 + TS + Vite + Tailwind + React Router + Chart.js│
│  HashRouter：/#/  /#/data  /#/analysis  /#/jbrowse        │
│              /#/download  /#/submit  /#/help              │
│                          │                                │
│                 src/services/api.ts                       │
│     （AbortController / 超时 / 统一 ApiError / 环境变量）    │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP (REST API)
                           ▼
┌──────────────────────────────────────────────────────────┐
│               Node.js 后端服务器 (server.js)               │
│         监听 0.0.0.0:${PORT|8001}，纯 http 模块            │
│  /api/peaks /api/predict /api/upload /api/download ...    │
│  凭据来自 .env；predict 物种白名单 + 限流；CORS 白名单      │
│                   mysql2（连接池 20）                      │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              MySQL 数据库（atac_web）                      │
│   主表 cis_elements（优先）或 peaks；汇总表 species_stats   │
└──────────────────────────────────────────────────────────┘
```

生产部署时 `npm run build` 输出到 `build/`，`server.js` 直接托管该目录，前后端同源（8001 端口），无跨域问题。

---

## 前端设计系统

- **色板**（tailwind.config.js）：`paper`（米白底）、`journal-50..900`（米色大地系）、`navy-50..900`（藏青主色）、`burgundy-50..900`（酒红强调）。全站禁止 Tailwind 默认 indigo/slate/blue 色与内联颜色样式。
- **字体**：标题 `font-serif`（Times New Roman，学术感）；正文 `font-sans`（系统栈）；序列/数字 `font-mono` / `.tnum`（TNR 无等宽数字，数据列用等宽栈对齐）。
- **全局样式**（src/index.css）：h1–h4 serif 层级、`:focus-visible` 统一焦点环、`.card-hover`、`.academic-table`、`.fig-caption`、`.animate-fade-in(-up)`、窄滚动条（含 Firefox）。
- **弹窗**：统一 `components/Modal.tsx`（role=dialog、aria-modal、ESC/遮罩关闭、焦点进出管理、锁定背景滚动）。
- **导航**：Navbar 单一配置数组渲染桌面/移动两套布局，NavLink 自动 `aria-current`，汉堡菜单支持 ESC/路由变化关闭。

## 前端路由

React Router 6 **HashRouter**（静态托管无需服务端 rewrite）：

| 路径 | 页面 | 组件 |
|------|------|------|
| `/#/` | 首页仪表盘 | `Home`（首屏 bundle） |
| `/#/data` | 数据搜索 | `DataViewer`（lazy chunk） |
| `/#/analysis` | 在线分析 | `Analysis`（lazy chunk） |
| `/#/jbrowse` | 基因组浏览器 | `JBrowse`（lazy chunk） |
| `/#/download` | 数据下载 | `Download`（lazy chunk） |
| `/#/submit` | 数据提交 | `Submit`（lazy chunk） |
| `/#/help` | 帮助文档 | `Help`（lazy chunk） |

DataViewer 的筛选状态（species/tissue/chr/q/page/limit）全部同步在 URL query string，可分享、刷新/前进后退不丢。

## API 服务层（src/services/api.ts）

- 基地址：`VITE_API_BASE` 环境变量优先，默认 `http://{hostname}:8001/api`。
- 统一 `request<T>()`：支持 AbortSignal；默认 30s 超时（predict 5min、upload 2min）；超时/网络错误/HTTP 错误分类为 `ApiError.kind`；`describeError()` 生成用户可读文案；`isAbortError()` 用于 catch 中过滤主动取消。
- HTTP 4xx/5xx 一律抛错（不再静默返回空数组），UI 层据此区分"后端故障"与"真的没有数据"。
- 导出：`API_BASE_URL, ApiError, describeError, isAbortError, MAX_UPLOAD_BYTES(50MB), fetchOverview, fetchModels, fetchSpeciesList, fetchStats, fetchDashboardData, fetchFilters, fetchChromosomes, fetchData, runPrediction, uploadData, deleteSpecies, getDownloadUrl`。

---

## 核心功能模块

### 1. Home（pages/Home.tsx）
- Academic Header（摘要指向 major crop species）、物种切换气泡（button + tooltip 支持键盘 focus）、Species Detail（Table 1 统计表 + Figure 1 基因组注释横向条形图 + Figure 2 组织数据密度条形图，Chart.js 4 npm 版，useRef+useEffect 管理实例生命周期）、Module Overview 三卡片（Link 跳转）、空库/错误态（错误横幅+重试）。
- 竞态：dashboard 数据按物种打标存储，切换物种时旧数据不会渲染；所有 fetch 带 AbortController。
- 数字格式化：`<1000` 原样、`>=1000` Xk、`>=1e6` X.XM。

### 2. DataViewer（pages/DataViewer.tsx）
- 三级联筛选（物种/组织/染色体下拉）+ 400ms 防抖全局搜索（带清除按钮与搜索中指示）。
- 筛选状态全部入 URL（useSearchParams，replace 写回），切物种原子更新避免双请求；loadData AbortController 防竞态。
- 动态列：STANDARD_COLUMNS 15 列 ∪ 后端额外列（累计并集，换页不抖动），只显示当前页至少一行非空的列。
- DataGrid 展示（见下），错误横幅 + 重试；每页条数 15/30/50/100。

#### DataGrid（components/DataGrid.tsx）
- 粘性前 3 列仅 `md:` 以上生效 + 表头 `sticky top-0`；宽度常量集中在 `STICKY_COL_CLASSES`。
- 页码输入本地 state，Enter/blur 提交并 clamp；非法值红环提示。
- 数字列 `.tnum`，整数不补小数；行 key 用 `peak_id ?? id`；行 hover 纯 CSS 且 sticky 单元格不透明。
- 三态：加载（保留旧数据 + 顶部细进度条）、错误（role=alert）、空数据；长文本截断 + Modal 详情（motif 标签云）。
- aria：caption、scope="col"、翻页/页码/页大小控件 aria-label。

### 3. Analysis（pages/Analysis.tsx）
- 两种输入：DNA 序列（FASTA 按行解析，丢弃 `>` header 行，只保留 ATCG；≥50bp）或基因组区域（chr+start+end 严格整数校验，end ≤ 染色体长度，跨度 ≤2000bp）。
- 等待体验：spinner + 已等待计时 + "首次推理约 1–2 分钟"提示 + Cancel（AbortController）；5 分钟超时。
- 结果：score 进度条（0.5 阈值刻度）+ Open/Closed 徽章 + 热力图预览（button 可聚焦）→ Modal 放大 + 下载高清 PNG；方法论文案随物种动态。

### 4. JBrowse（pages/JBrowse.tsx）
- iframe 嵌入 `http://yan-lab.hzau.edu.cn:3000/`；onLoad 前 spinner 占位；混合内容 amber 警告 + Open in New Tab；flex 布局撑满剩余高度。

### 5. Download（pages/Download.tsx）
- 物种数据集卡片（记录数 + TSV + updatedAt 真实更新时间）；下载经隐藏 `<a download>` 触发；错误态/空态严格区分；使用条款指向 Footer 的 How to Cite。

### 6. Submit（pages/Submit.tsx）
- 上传：物种名 trim 必填、扩展名 .tsv/.csv/.txt、大小 ≤50MB 前端校验；已选文件可移除；成功 inline 提示且管理区保持可见；目标物种已存在时提示追加语义。
- 管理：删除需**输入物种全名**匹配才能确认（行内确认区，无 window.confirm）；删除中 loading+disabled；结果 inline 消息。

### 7. Help（pages/Help.tsx）
- 六节内容（搜索/详情/外链/下载/ISM 分析/提交管理）+ 顶部目录（scrollIntoView 平滑跳转，避免改写 hash 路由）；术语与界面列名一致。

---

## 后端（server.js）

### 配置（全部来自环境变量，见 .env.example）

`DB_HOST / DB_PORT / DB_USER / DB_PASSWORD(必填) / DB_NAME / PORT / CORS_ORIGINS`。缺 `DB_PASSWORD` 启动即报错退出。`bulk_import.js` 同一套配置。

### 安全机制

- **凭据**：无硬编码密码（仓库已清理，部署前请轮换数据库密码）。
- **命令注入防护**：`/api/predict` 的 species 必须在 `PREDICT_SPECIES_WHITELIST`（MOTIF_DB_CONFIG ∪ GENOME_CONFIG 的 key）内，modelPath 只从白名单映射产生。
- **限流**：predict 每 IP 每 10 分钟 5 次（内存滑动窗口，429）；请求体限 1MB（413）。
- **错误脱敏**：5xx 统一 `{error:'Internal server error'}`，细节只进服务端日志；4xx 用户输入错误保留具体文案。
- **CORS**：白名单回显 Origin（默认 `http://localhost:3000`，生产用 `CORS_ORIGINS` 配置）；Methods 仅 `GET, POST, OPTIONS`；/api/delete 只接受 POST。
- SQL 全部参数化；动态表名/列名来自服务端缓存与 sanitize 白名单。

### API 一览

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/overview` | 所有物种概览（读 species_stats） |
| GET | `/api/models` | 可用 ISM 模型列表 |
| GET | `/api/species` | 物种列表 |
| GET | `/api/stats` | 全局统计（breakdown 含 updatedAt） |
| GET | `/api/dashboard?species=` | 物种仪表盘数据 |
| GET | `/api/filters?species=` | 组织/染色体筛选项 |
| GET | `/api/chromosomes?species=` | 染色体列表（基因组 FAI） |
| GET | `/api/peaks?page&limit&q&species&tissue&chr` | 分页查询 |
| GET | `/api/download?species=` | TSV 流式下载 |
| POST | `/api/predict` | ISM 预测（白名单+限流+1MB） |
| POST | `/api/upload?species=` | 上传数据（≤200MB 服务端限） |
| POST | `/api/delete?species=` | 删除物种数据 |
| POST | `/api/refresh-stats` | 重建汇总统计 |

### 数据库设计

- 主表：`cis_elements`（优先）或 `peaks`；非预定义列 LONGTEXT，上传时自动 `ALTER TABLE ADD COLUMN`。
- 汇总表：`species_stats`（species PK, total_peaks, tissue_dist/context_dist/type_dist/gene_dist/chr_dist JSON, updated_at），仪表盘/概览/计数全部读它，避免扫 20GB 主表。
- 索引（启动时后台补建，按名跳过）：`idx_species`、`idx_tissue`、`idx_position`、`idx_peak_id`、`idx_nearest_gene`（前缀 100），复合索引 `idx_species_tissue (species, tissue(100))`、`idx_species_position (species, position(100))`。
- 运行时统计缓存落盘 `.api_cache.json`（gitignored）。

### 数据库优化脚本

- `npm run db:audit`（scripts/db_audit.js，只读）：表/索引现状、列类型分布、关键查询 EXPLAIN、数据质量（position 可解析率、NULL 比例）、按收益排序的建议。
- `npm run db:optimize`（scripts/db_optimize.js，默认 dry-run，`-- --apply` 执行）：
  1. `to_tss` 等数值列 LONGTEXT → DECIMAL（先验证数据合规）；
  2. 新增 `chrom/start_pos/end_pos` 持久列并分批回填（可中断重跑）+ `(species, chrom, start_pos)` 复合索引；
  3. `peak_id`/`nearest_gene` FULLTEXT 索引（搜索可升级 MATCH AGAINST）；
  4. `--also-varchar` 可选：关键列转 VARCHAR(255)（长时间锁表，维护窗口执行）。

### ISM 预测流程

前端 `POST /api/predict`（`{species, sequence}` 或 `{species, chr, start, end}`）→ 服务器校验物种白名单 → 生成临时 Python 脚本 → `conda run -n wheat_ism` 执行（DNABERT 微调模型逐位突变 + FIMO motif 分析）→ matplotlib/seaborn 热力图（300DPI PNG）→ base64 返回 `{score, classification, heatmapBase64}` → 清理临时文件。依赖服务器上的 conda 环境与 `/data2/analysis` 等 Linux 路径。

---

## 运行方式

```bash
npm install
cp .env.example .env   # 填入 DB_PASSWORD 等
npm run server         # 后端 http://0.0.0.0:8001
npm run dev            # 前端开发 http://localhost:3000
npm run build          # 生产构建到 build/
npm run typecheck      # TS 类型检查
```

前提：Node.js；可访问的 MySQL；（ISM 功能）服务器 conda 环境 `wheat_ism` 与微调模型目录。

## 注意事项

1. **密码轮换**：数据库密码曾以明文存在于旧仓库文件，部署前务必轮换，并只放在服务器的 `.env`（已 gitignore）。
2. **CORS**：前端若部署在非 `localhost:3000` 的源，必须在 `.env` 配置 `CORS_ORIGINS`，否则浏览器会拦截跨域请求。
3. **限流以 IP 为键**：若日后加 nginx 反代，需改用 `X-Forwarded-For` 作为限流键。
4. **HTTP/HTTPS 混合内容**：JBrowse 与默认 API 均为 HTTP，站点上 HTTPS 时需同步升级或在反向代理层终结 TLS。
5. **物种图标**：`public/icon/` 约 55MB（单张最大 7.4MB），建议后续压缩为 WebP/缩略图以加速首屏物种切换区加载。
