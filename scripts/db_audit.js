#!/usr/bin/env node
/**
 * scripts/db_audit.js — CREDB 数据库只读体检脚本
 *
 * 用法: npm run db:audit
 *
 * 全部查询均为只读（SELECT / EXPLAIN / information_schema）。
 * 输出一份结构化报告，结尾按预期收益排序给出优化建议
 * （对应 scripts/db_optimize.js 的各个步骤）。
 */

require('dotenv').config();
const mysql = require('mysql2');

// ================== 数据库配置（与 server.js 一致，凭据来自环境变量）==================
if (!process.env.DB_PASSWORD) {
  console.error('❌ Missing DB_PASSWORD environment variable.');
  console.error('   请在项目根目录创建 .env 文件（参考 .env.example）或设置 DB_PASSWORD 环境变量后重试。');
  process.exit(1);
}

const DB_NAME = process.env.DB_NAME || 'atac_web';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '211.69.142.213',
  database: DB_NAME,
  user: process.env.DB_USER || 'ATAC_web',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 3,
  connectTimeout: 10000,
});
const promisePool = pool.promise();

// ================== 工具函数 ==================
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(2) + ' MB';
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(2) + ' KB';
  return n + ' B';
}

function pct(part, total) {
  part = Number(part) || 0;
  total = Number(total) || 0;
  if (total === 0) return '0.00%';
  return ((part / total) * 100).toFixed(2) + '%';
}

function banner(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`■ ${title}`);
  console.log('='.repeat(70));
}

// Run one report section; a failing section never aborts the whole report
async function section(title, fn) {
  banner(title);
  try {
    await fn();
  } catch (e) {
    console.log(`⚠️ 本节执行失败: ${e.message}`);
  }
}

// ================== 主流程 ==================
async function main() {
  console.log('\n🔍 CREDB Database Audit (read-only)');
  console.log(`   Host: ${process.env.DB_HOST || '211.69.142.213'}:${parseInt(process.env.DB_PORT, 10) || 3306}  DB: ${DB_NAME}`);

  // ---- 连接 + MySQL 版本 ----
  let version = 'unknown';
  try {
    const [rows] = await promisePool.query('SELECT VERSION() AS version');
    version = rows[0].version;
    console.log(`   MySQL version: ${version}`);
  } catch (e) {
    console.error(`\n❌ 无法连接数据库: ${e.message}`);
    console.error('   请检查: 1) .env 中的 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD 是否正确; 2) 本机到数据库的网络是否可达。');
    process.exit(1);
  }

  // ---- 库内各表概况 ----
  await section('1. 表概况（行数 / 数据大小 / 索引大小 / 引擎 / 字符集）', async () => {
    const [tables] = await promisePool.query(
      `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY DATA_LENGTH DESC`,
      [DB_NAME]
    );
    if (tables.length === 0) { console.log('   (库中没有表)'); return; }
    const rows = tables.map(t => ({
      table: t.TABLE_NAME,
      engine: t.ENGINE,
      charset: (t.TABLE_COLLATION || '').split('_')[0],
      rows_estimate: Number(t.TABLE_ROWS).toLocaleString(),
      data_size: fmtBytes(t.DATA_LENGTH),
      index_size: fmtBytes(t.INDEX_LENGTH),
    }));
    console.table(rows);
    console.log('   注: TABLE_ROWS 为 InnoDB 估算值，仅供量级参考。');
  });

  // ---- 主表探测（与 server.js 一致：cis_elements 优先，否则 peaks）----
  let activeTable = null;
  await section('2. 主表探测', async () => {
    const [tables] = await promisePool.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    if (tableNames.includes('cis_elements')) activeTable = 'cis_elements';
    else if (tableNames.includes('peaks')) activeTable = 'peaks';
    if (!activeTable) throw new Error("未找到 'cis_elements' 或 'peaks' 表");
    console.log(`   主表: ${activeTable}`);
  });
  if (!activeTable) {
    console.error('\n❌ 无主表可审计，报告终止。');
    await pool.end();
    process.exit(1);
  }

  // ---- 主表列类型分布 ----
  let existingCols = new Set();
  await section(`3. 主表 ${activeTable} 列类型分布`, async () => {
    const [cols] = await promisePool.query(
      `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [DB_NAME, activeTable]
    );
    cols.forEach(c => existingCols.add(c.COLUMN_NAME));
    const dist = {};
    for (const c of cols) dist[c.DATA_TYPE] = (dist[c.DATA_TYPE] || 0) + 1;
    const rows = Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => ({ data_type: type, columns: n }));
    console.table(rows);
    const longtextCols = cols.filter(c => c.DATA_TYPE === 'longtext').map(c => c.COLUMN_NAME);
    console.log(`   LONGTEXT 列 (${longtextCols.length}): ${longtextCols.join(', ') || '(无)'}`);
  });

  // ---- 现有索引及基数 ----
  await section(`4. 主表 ${activeTable} 现有索引及基数`, async () => {
    const [stats] = await promisePool.query(
      `SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, CARDINALITY, INDEX_TYPE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [DB_NAME, activeTable]
    );
    if (stats.length === 0) { console.log('   (没有任何索引)'); return; }
    console.table(stats.map(s => ({
      index: s.INDEX_NAME,
      seq: s.SEQ_IN_INDEX,
      column: s.COLUMN_NAME + (s.SUB_PART ? `(${s.SUB_PART})` : ''),
      type: s.INDEX_TYPE,
      cardinality: Number(s.CARDINALITY).toLocaleString(),
    })));
  });

  // ---- 代表性查询 EXPLAIN ----
  await section('5. 代表性查询 EXPLAIN', async () => {
    const explain = async (label, sql, params) => {
      console.log(`\n   ── ${label}`);
      console.log(`      SQL: ${sql.replace(/\s+/g, ' ')}${params ? '  [params: ' + JSON.stringify(params) + ']' : ''}`);
      const [rows] = await promisePool.query(`EXPLAIN ${sql}`, params);
      console.table(rows.map(r => ({
        type: r.type,
        possible_keys: r.possible_keys,
        key: r.key,
        rows: r.rows,
        Extra: r.Extra,
      })));
    };

    // a) 无筛选分页（首页）
    await explain('a) 无筛选 LIMIT 15 OFFSET 0',
      `SELECT * FROM \`${activeTable}\` LIMIT 15 OFFSET 0`);

    // b) species + tissue 等值筛选（取一个真实样本值）
    if (existingCols.has('species') && existingCols.has('tissue')) {
      const [sample] = await promisePool.query(
        `SELECT species, tissue FROM \`${activeTable}\` WHERE species IS NOT NULL AND tissue IS NOT NULL LIMIT 1`
      );
      const sp = sample[0] ? sample[0].species : 'Example_species';
      const ti = sample[0] ? sample[0].tissue : 'Example_tissue';
      await explain('b) WHERE species = ? AND tissue = ?',
        `SELECT * FROM \`${activeTable}\` WHERE species = ? AND tissue = ? LIMIT 15`, [sp, ti]);
    } else {
      console.log('\n   ── b) 跳过（缺少 species/tissue 列）');
    }

    // c) LIKE 前缀匹配 vs 前导通配符
    if (existingCols.has('position')) {
      await explain("c1) WHERE position LIKE 'chr1:%'（前缀匹配，可走索引）",
        `SELECT * FROM \`${activeTable}\` WHERE position LIKE 'chr1:%' LIMIT 15`);
    }
    if (existingCols.has('peak_id')) {
      await explain("c2) WHERE peak_id LIKE '%xxx%'（前导通配符，走不了索引）",
        `SELECT * FROM \`${activeTable}\` WHERE peak_id LIKE '%xxx%' LIMIT 15`);
    }

    console.log(`
   说明: B-Tree 索引按列值从左到右排序，'chr1:%' 这类前缀匹配可以定位到
   索引中的一个连续区间（range scan）；而 '%xxx%' 的前导通配符使匹配起点
   不确定，优化器只能放弃索引做全表扫描。关键词包含搜索应改用 FULLTEXT
   索引 + MATCH ... AGAINST（见 db_optimize.js 步骤 3）。`);
  });

  // ---- 数据质量 ----
  await section('6. 数据质量（全表扫描，大表可能需要几分钟）', async () => {
    const t0 = Date.now();
    const keyCols = ['species', 'tissue', 'position', 'peak_id', 'nearest_gene'];
    const selects = ['COUNT(*) AS total_rows'];
    if (existingCols.has('species')) selects.push('COUNT(DISTINCT species) AS species_count');
    if (existingCols.has('position')) {
      selects.push("SUM(CASE WHEN `position` REGEXP '^[^:]+:[0-9]+-[0-9]+$' THEN 1 ELSE 0 END) AS position_parseable");
    }
    for (const c of keyCols) {
      if (existingCols.has(c)) {
        selects.push(`SUM(CASE WHEN \`${c}\` IS NULL OR \`${c}\` = '' THEN 1 ELSE 0 END) AS \`${c}_empty\``);
      }
    }
    const [rows] = await promisePool.query(`SELECT ${selects.join(', ')} FROM \`${activeTable}\``);
    const r = rows[0];
    const total = Number(r.total_rows) || 0;
    console.log(`   总行数:            ${total.toLocaleString()}  (耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (r.species_count !== undefined) console.log(`   species 数:        ${Number(r.species_count).toLocaleString()}`);
    if (r.position_parseable !== undefined) {
      console.log(`   position 可解析:   ${pct(r.position_parseable, total)}  (正则 ^[^:]+:[0-9]+-[0-9]+$)`);
    }
    console.log('   关键列 NULL/空串比例:');
    for (const c of keyCols) {
      const v = r[`${c}_empty`];
      if (v !== undefined) console.log(`     ${c.padEnd(14)} ${pct(v, total)}`);
    }
  });

  // ---- 优化建议（按预期收益排序）----
  banner('7. 优化建议（按预期收益排序，对应 scripts/db_optimize.js）');
  console.log(`
   [收益 高] 1) 步骤 2 — 新增 chrom/start_pos/end_pos 持久列并建
      (species, chrom, start_pos) 复合索引: 把染色体筛选和按位置排序
      从 LIKE 前缀扫描变成真正的索引范围扫描，分页 COUNT 也会快得多。
   [收益 高] 2) 步骤 3 — peak_id / nearest_gene 建 FULLTEXT 索引:
      搜索框的 '%keyword%' 前导通配符永远走不了 B-Tree 索引，
      改 MATCH ... AGAINST 后关键词搜索从全表扫描变为毫秒级。
   [收益 中] 3) 步骤 1 — to_tss 等数值列 LONGTEXT → DECIMAL(12,2):
      数值比较/排序语义正确，存储更小，可建数值索引。
   [收益 中] 4) 步骤 4 (--also-varchar) — species/tissue/position/peak_id/
      nearest_gene 从 LONGTEXT 转 VARCHAR(255): 索引更小、GROUP BY 更快。
      ⚠️ 会长时间锁表，必须在维护窗口执行。
   [收益 低] 5) 确认第 4 节列出的启动索引均已存在；缺失的索引 server.js
      下次启动时会在后台自动创建（不阻塞启动）。
`);

  await pool.end();
}

main().catch(async (e) => {
  console.error(`\n❌ 体检脚本执行失败: ${e.message}`);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
