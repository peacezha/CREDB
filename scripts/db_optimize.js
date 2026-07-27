#!/usr/bin/env node
/**
 * scripts/db_optimize.js — CREDB 主表结构迁移脚本
 *
 * 用法:
 *   node scripts/db_optimize.js                # dry-run（默认）：只打印 SQL / 影响 / 回滚，不执行
 *   node scripts/db_optimize.js --apply        # 逐步执行并打印每步耗时
 *   node scripts/db_optimize.js --apply --also-varchar
 *                                              # 追加执行步骤 4（LONGTEXT → VARCHAR(255)，长时间锁表）
 *   node scripts/db_optimize.js --only 3       # 只跑指定步骤（可配合 --apply 或 dry-run）
 *   node scripts/db_optimize.js --steps 1,3    # 跑多个指定步骤
 *
 * 步骤:
 *   1. to_tss 等数值列 LONGTEXT → DECIMAL(12,2)（先验证数据全部可转换，否则跳过）
 *   2. 新增 chrom/start_pos/end_pos 持久列，从 position 分批回填（每批 50000 行），
 *      然后建 (species, chrom, start_pos) 复合索引
 *   3. peak_id / nearest_gene 建 FULLTEXT 索引（搜索可改 MATCH ... AGAINST）
 *   4. 可选: 关键列 LONGTEXT → VARCHAR(255)（需维护窗口）
 *
 * 表名探测与 server.js 一致：cis_elements 优先，否则 peaks。
 */

require('dotenv').config();
const mysql = require('mysql2');

const APPLY = process.argv.includes('--apply');
const ALSO_VARCHAR = process.argv.includes('--also-varchar');

// 步骤过滤: --only 3 只跑步骤 3; --steps 1,3 跑多步; 不传全跑
function parseSteps() {
  const args = process.argv.slice(2);
  let raw;
  const onlyIdx = args.indexOf('--only');
  const stepsIdx = args.indexOf('--steps');
  if (onlyIdx !== -1) raw = args[onlyIdx + 1];
  else if (stepsIdx !== -1) raw = args[stepsIdx + 1];
  if (raw === undefined) return null; // 未指定 = 全跑
  const steps = new Set(
    String(raw).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  );
  if (steps.size === 0) {
    console.error(`❌ 无效的步骤参数: "${raw}"（应为 1-4 的数字，如 --only 3 或 --steps 1,3）`);
    process.exit(1);
  }
  return steps;
}
const STEPS = parseSteps();
const shouldRun = (n) => !STEPS || STEPS.has(n);

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

// ================== 可配置项 ==================
// 步骤 1: 需要从 LONGTEXT 转为数值类型的列（按需追加，如 summit）
const NUMERIC_COLUMNS = [
  { col: 'to_tss', type: 'DECIMAL(12,2)' },
];
// 步骤 1 验证用正则：整数或小数（可带负号）
const NUMERIC_REGEXP = '^-?[0-9]+(\\.[0-9]+)?$';
// 步骤 4: --also-varchar 时转换的列
const VARCHAR_COLUMNS = ['species', 'tissue', 'position', 'peak_id', 'nearest_gene'];
const BACKFILL_BATCH = 50000;

// ================== 工具函数 ==================
function banner(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`■ ${title}`);
  console.log('='.repeat(70));
}

function printPlan({ impact, sqls, rollback }) {
  if (impact) console.log(`   影响: ${impact}`);
  console.log('   将执行的 SQL:');
  for (const s of [].concat(sqls)) console.log(`     ${s}`);
  if (rollback) {
    console.log('   回滚 SQL:');
    for (const s of [].concat(rollback)) console.log(`     ${s}`);
  }
}

async function getColumnInfo(table, col) {
  const [rows] = await promisePool.query(
    `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS maxlen FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, col]
  );
  return rows[0] || null;
}

async function hasIndex(table, indexName) {
  const [rows] = await promisePool.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [DB_NAME, table, indexName]
  );
  return rows.length > 0;
}

async function runSql(sql, params) {
  const t0 = Date.now();
  const [result] = await promisePool.query(sql, params);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`     ✅ done (${secs}s)`);
  return result;
}

// ================== 主流程 ==================
async function main() {
  console.log('\n🛠  CREDB Database Optimize');
  console.log(`   Mode: ${APPLY ? '⚠️  APPLY（将真正执行 DDL/DML）' : 'dry-run（只打印，不执行）'}${ALSO_VARCHAR ? ' + --also-varchar' : ''}`);
  console.log(`   Steps: ${STEPS ? [...STEPS].sort((a, b) => a - b).join(', ') : 'all (1-4)'}`);
  console.log(`   Host: ${process.env.DB_HOST || '211.69.142.213'}:${parseInt(process.env.DB_PORT, 10) || 3306}  DB: ${DB_NAME}`);

  // ---- 连接 & 主表探测（与 server.js 一致）----
  let table = null;
  try {
    const [tables] = await promisePool.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    if (tableNames.includes('cis_elements')) table = 'cis_elements';
    else if (tableNames.includes('peaks')) table = 'peaks';
  } catch (e) {
    console.error(`\n❌ 无法连接数据库: ${e.message}`);
    console.error('   请检查: 1) .env 中的 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD 是否正确; 2) 本机到数据库的网络是否可达。');
    process.exit(1);
  }
  if (!table) {
    console.error("\n❌ 未找到 'cis_elements' 或 'peaks' 表，终止。");
    await pool.end();
    process.exit(1);
  }
  console.log(`   主表: ${table}`);

  const stepStart = Date.now();

  // ================== 步骤 1: 数值列 LONGTEXT → DECIMAL ==================
  banner('步骤 1: 数值列类型转换（LONGTEXT → DECIMAL）');
  if (!shouldRun(1)) {
    console.log('   ⏭ 被 --only/--steps 过滤，跳过');
  }
  if (shouldRun(1)) for (const { col, type } of NUMERIC_COLUMNS) {
    const info = await getColumnInfo(table, col);
    if (!info) { console.log(`\n   ── ${col}: 列不存在，跳过`); continue; }
    if (info.DATA_TYPE !== 'longtext') {
      console.log(`\n   ── ${col}: 当前类型 ${info.DATA_TYPE}，不是 LONGTEXT，跳过`);
      continue;
    }
    const validateSql = `SELECT COUNT(*) AS bad FROM \`${table}\` WHERE \`${col}\` IS NOT NULL AND \`${col}\` NOT REGEXP '${NUMERIC_REGEXP}'`;
    const alterSql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` ${type} NULL`;
    console.log(`\n   ── ${col} → ${type}`);
    printPlan({
      impact: 'ALTER TABLE 会重建整张表，20GB 表可能耗时数十分钟到数小时，期间影响写入；建议低峰执行。',
      sqls: [`-- 先验证（必须为 0 才继续）\n     ${validateSql}`, alterSql],
      rollback: `ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` LONGTEXT`,
    });
    if (!APPLY) { console.log('   [dry-run] 不执行'); continue; }
    console.log('   ⏳ 验证数据是否全部可转换...');
    const [bad] = await promisePool.query(validateSql);
    if (Number(bad[0].bad) > 0) {
      console.log(`   ⚠️ 有 ${Number(bad[0].bad).toLocaleString()} 行的 ${col} 不是数值格式，跳过本列（请先清洗数据）。`);
      continue;
    }
    console.log('   ✅ 验证通过，执行 ALTER...');
    await runSql(alterSql);
  }

  // ================== 步骤 2: chrom/start_pos/end_pos 持久列 + 复合索引 ==================
  banner('步骤 2: 位置解析持久列 + (species, chrom, start_pos) 复合索引');
  const posInfo = shouldRun(2) ? await getColumnInfo(table, 'position') : null;
  if (!posInfo) {
    console.log(shouldRun(2) ? '   ⚠️ position 列不存在，跳过本步骤' : '   ⏭ 被 --only/--steps 过滤，跳过');
  } else {
    const chromInfo = await getColumnInfo(table, 'chrom');
    const idxExists = await hasIndex(table, 'idx_species_chrom_pos');
    const addColSql = `ALTER TABLE \`${table}\` ADD COLUMN \`chrom\` VARCHAR(32) NULL, ADD COLUMN \`start_pos\` INT NULL, ADD COLUMN \`end_pos\` INT NULL`;
    const backfillSql = `UPDATE \`${table}\`
     SET \`chrom\` = SUBSTRING_INDEX(\`position\`, ':', 1),
         \`start_pos\` = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(\`position\`, ':', -1), '-', 1) AS UNSIGNED),
         \`end_pos\` = CAST(SUBSTRING_INDEX(\`position\`, '-', -1) AS UNSIGNED)
     WHERE \`chrom\` IS NULL AND \`position\` REGEXP '^[^:]+:[0-9]+-[0-9]+$'
     LIMIT ${BACKFILL_BATCH}`;
    const indexSql = `CREATE INDEX \`idx_species_chrom_pos\` ON \`${table}\` (\`species\`, \`chrom\`, \`start_pos\`)`;

    if (chromInfo && idxExists) {
      console.log('   ✅ chrom/start_pos/end_pos 列与 idx_species_chrom_pos 索引均已存在，跳过');
    } else {
      printPlan({
        impact: '加列会重建表（大表耗时长）；分批回填每批 ' + BACKFILL_BATCH.toLocaleString() + ' 行，可随时中断重跑（已回填行会跳过）；建索引同样是大表操作。',
        sqls: [
          ...(chromInfo ? ['-- 列已存在，跳过 ADD COLUMN'] : [addColSql]),
          `-- 循环执行直到 affected rows < ${BACKFILL_BATCH.toLocaleString()}\n     ${backfillSql.replace(/\n/g, '\n     ')}`,
          ...(idxExists ? ['-- 索引已存在，跳过 CREATE INDEX'] : [indexSql]),
        ],
        rollback: [
          `DROP INDEX \`idx_species_chrom_pos\` ON \`${table}\``,
          `ALTER TABLE \`${table}\` DROP COLUMN \`chrom\`, DROP COLUMN \`start_pos\`, DROP COLUMN \`end_pos\``,
        ],
      });
      if (!APPLY) {
        console.log('   [dry-run] 不执行');
      } else {
        if (!chromInfo) { console.log('   ⏳ 添加 chrom/start_pos/end_pos 列...'); await runSql(addColSql); }
        console.log('   ⏳ 分批回填（每批 ' + BACKFILL_BATCH.toLocaleString() + ' 行）...');
        let totalUpdated = 0;
        for (;;) {
          const t0 = Date.now();
          const [res] = await promisePool.query(backfillSql);
          totalUpdated += res.affectedRows;
          console.log(`     ... 本批 ${res.affectedRows.toLocaleString()} 行，累计 ${totalUpdated.toLocaleString()} 行 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
          if (res.affectedRows < BACKFILL_BATCH) break;
        }
        console.log(`   ✅ 回填完成，共 ${totalUpdated.toLocaleString()} 行`);
        if (!idxExists) { console.log('   ⏳ 创建 idx_species_chrom_pos...'); await runSql(indexSql); }
      }
    }
  }

  // ================== 步骤 3: FULLTEXT 索引 ==================
  banner('步骤 3: peak_id / nearest_gene FULLTEXT 索引');
  if (!shouldRun(3)) {
    console.log('   ⏭ 被 --only/--steps 过滤，跳过');
  } else {
    console.log('   ⏱ 注意: 对 20GB 表的 LONGTEXT 列建 FULLTEXT 可能需要数十分钟到数小时。');
    console.log('     建议后台执行: nohup node scripts/db_optimize.js --apply --only 3 > ft.log 2>&1 &');
    console.log('     或在 tmux/screen 中运行。建索引期间读不受影响、写入会暂停（建议低峰期）。');
    console.log('     完成后需重启 server.js 才会启用 MATCH 全文搜索。');
  }
  if (shouldRun(3)) for (const { col, idx } of [
    { col: 'peak_id', idx: 'idx_ft_peak_id' },
    { col: 'nearest_gene', idx: 'idx_ft_nearest_gene' },
  ]) {
    const info = await getColumnInfo(table, col);
    if (!info) { console.log(`\n   ── ${col}: 列不存在，跳过`); continue; }
    if (await hasIndex(table, idx)) { console.log(`\n   ── ${idx}: 已存在，跳过`); continue; }
    console.log(`\n   ── ${col}`);
    printPlan({
      impact: '大表建 FULLTEXT 索引耗时较长且占用额外磁盘；建成后搜索可改为\n     WHERE MATCH(`' + col + '`) AGAINST (? IN NATURAL LANGUAGE MODE)，摆脱前导通配符全表扫描。',
      sqls: `CREATE FULLTEXT INDEX \`${idx}\` ON \`${table}\` (\`${col}\`)`,
      rollback: `DROP INDEX \`${idx}\` ON \`${table}\``,
    });
    if (!APPLY) { console.log('   [dry-run] 不执行'); continue; }
    await runSql(`CREATE FULLTEXT INDEX \`${idx}\` ON \`${table}\` (\`${col}\`)`);
  }

  // ================== 步骤 4: 可选 LONGTEXT → VARCHAR(255) ==================
  banner('步骤 4（可选）: 关键列 LONGTEXT → VARCHAR(255)');
  if (!shouldRun(4)) {
    console.log('   ⏭ 被 --only/--steps 过滤，跳过');
  } else if (!ALSO_VARCHAR) {
    console.log('   未指定 --also-varchar，跳过。');
    console.log('   ⚠️ 该步骤会逐列重建整张表并长时间锁表，如需执行请在维护窗口加 --also-varchar。');
  } else {
    console.log('   ⚠️ 警告: 本步骤会长时间锁表，请确认当前处于维护窗口。');
    for (const col of VARCHAR_COLUMNS) {
      const info = await getColumnInfo(table, col);
      if (!info) { console.log(`\n   ── ${col}: 列不存在，跳过`); continue; }
      if (info.DATA_TYPE !== 'longtext') {
        console.log(`\n   ── ${col}: 当前类型 ${info.DATA_TYPE}，不是 LONGTEXT，跳过`);
        continue;
      }
      const alterSql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` VARCHAR(255) NULL`;
      console.log(`\n   ── ${col} → VARCHAR(255)`);
      printPlan({
        impact: '超过 255 字符的值在严格模式下会报错导致整步失败；转换期间锁表。',
        sqls: alterSql,
        rollback: `ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` LONGTEXT`,
      });
      if (!APPLY) { console.log('   [dry-run] 不执行'); continue; }
      await runSql(alterSql);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`${APPLY ? '✅ 全部步骤执行完毕' : '✅ dry-run 完毕（未做任何修改）。确认无误后加 --apply 执行。'}  总耗时 ${((Date.now() - stepStart) / 1000).toFixed(1)}s`);
  console.log('='.repeat(70) + '\n');

  await pool.end();
}

main().catch(async (e) => {
  console.error(`\n❌ 迁移脚本执行失败: ${e.message}`);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
