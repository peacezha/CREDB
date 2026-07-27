/**
 * bulk_import.js — 从服务器本地磁盘直接导入 BED/TSV 文件到 MySQL
 *
 * 用法:
 *   node bulk_import.js <file_path> <species_name>
 *
 * 示例:
 *   node bulk_import.js "E:/0506data/animal/animal_data/Capra_hircus_14col_footprint_final_recalculated_processed.bed" "Capra hircus"
 *
 * 优点:
 *   - 绕过 HTTP 上传限制，支持任意大小文件
 *   - 逐批提交，单批失败不影响已导入数据
 *   - 显示实时进度
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2');

// ================== 数据库配置（凭据来自环境变量，见 .env.example）==================
if (!process.env.DB_PASSWORD) {
  console.error('❌ Missing DB_PASSWORD environment variable.');
  console.error('   请在项目根目录创建 .env 文件（参考 .env.example）或设置 DB_PASSWORD 环境变量后重试。');
  process.exit(1);
}
const pool = mysql.createPool({
  host: process.env.DB_HOST || "211.69.142.213",
  database: process.env.DB_NAME || "atac_web",
  user: process.env.DB_USER || "ATAC_web",
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 50,
  enableKeepAlive: true,
  connectTimeout: 10000,
});
const promisePool = pool.promise();

// ================== 列映射（与 server.js 一致）==================
const COLUMN_MAP = {
  'species': 'species',
  'tissue': 'tissue',
  'type': 'type',
  'Peak_ID': 'peak_id',
  'Position': 'position',
  'nearest gene': 'nearest_gene',
  'ToTSS': 'to_tss',
  'Genomic_context_of_peak': 'genomic_context',
  'Summit': 'summit',
  'PAM-position': 'pam_position_link',
  'expression in expVIP': 'expression_link',
  'JBrowse_Link': 'stage_link',
  'nearest gene_expression/TPM': 'expression_tpm',
  'nearest_H3K9ac_peak': 'nearest_h3k9ac_peak',
  'FootPrint': 'footprint'
};

// ================== 工具函数 ==================
const sanitizeColumnName = (name) => {
  if (COLUMN_MAP[name]) return COLUMN_MAP[name];
  let safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  safeName = safeName.replace(/_+/g, '_');
  safeName = safeName.replace(/^_|_$/g, '');
  if (!safeName) return 'col_' + Math.floor(Math.random() * 1000);
  // MySQL identifier limit is 64 chars
  if (safeName.length > 64) {
    safeName = safeName.substring(0, 56) + '_' + safeName.substring(safeName.length - 7);
  }
  return safeName;
};

// Recognise common "missing data" placeholders → convert to null
const NA_PATTERNS = /^(#?N\/?A|#NA|null|NULL|None|none|NaN|nan|[-+]?inf(inity)?|\.|\?|\s*)$/i;
const cleanValue = (raw) => {
  let val = raw.trim().replace(/^"|"$/g, '');
  if (val === '' || NA_PATTERNS.test(val)) return null;
  return val;
};

// Default column headers for 14-column BED files without a header row
const DEFAULT_14COL_HEADERS = [
  'Peak_ID',
  'Position',
  'tissue',
  'nearest gene',
  'ToTSS',
  'type',
  'Genomic_context_of_peak',
  'Summit',
  'PAM-position',
  'expression in expVIP',
  'JBrowse_Link',
  'nearest gene_expression/TPM',
  'FootPrint',
  'Motif'
];

// Auto-detect whether the first line is a header or data row
const KNOWN_HEADERS = new Set(
  Object.keys(COLUMN_MAP).map(h => h.toLowerCase())
);
const DATA_INDICATORS = /^(chr|chrom|scaffold|http|\d+$|-?\d+\.?\d*$)/i;

function looksLikeHeader(values) {
  const headerMatches = values.filter(v => KNOWN_HEADERS.has(v.toLowerCase().trim())).length;
  return headerMatches >= 2;
}

const parseData = (rawText, forceHeaders) => {
  const lines = rawText.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };

  // Detect delimiter by multi-line consistency
  const candidates = ['\t', ',', ' '];
  const sampleLines = lines.slice(0, Math.min(Math.max(lines.length, 1), 5));
  let bestDelimiter = '\t';
  let bestScore = -1;

  for (const delim of candidates) {
    const colCounts = sampleLines.map(line => line.split(delim).length);
    const allSame = colCounts.every(c => c === colCounts[0]);
    const avgCols = colCounts[0];
    if (allSame && avgCols > 1 && avgCols <= 200) {
      const score = avgCols;
      if (bestScore === -1 || score < bestScore) {
        bestScore = score;
        bestDelimiter = delim;
      }
    }
  }

  const delimiter = bestDelimiter;
  const firstLine = lines[0];
  const firstValues = firstLine.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));

  let headers, dataStart;
  if (forceHeaders !== undefined) {
    headers = forceHeaders;
    dataStart = 0;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (--no-header)`);
  } else if (looksLikeHeader(firstValues)) {
    headers = firstValues;
    dataStart = 1;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (有表头)`);
  } else {
    // First line looks like data — use default 14-col headers
    headers = DEFAULT_14COL_HEADERS;
    dataStart = 0;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (自动识别: 无表头，使用默认列名)`);
  }

  const rows = lines.slice(dataStart).map(line => {
    if (!line.trim()) return null;
    const values = line.split(delimiter).map(cleanValue);
    return values;
  }).filter(r => r !== null && r.length > 0);

  return { headers, rows };
};

// Parse first line only — for streaming mode: detect delimiter, determine headers
function parseFirstLine(firstLine, forceHeaders) {
  const candidates = ['\t', ',', ' '];
  let bestDelimiter = '\t';

  for (const delim of candidates) {
    const colCount = firstLine.split(delim).length;
    // First line alone can't do consistency check, so prefer TAB if it gives >1 cols
    if (colCount > 1 && colCount <= 200) {
      bestDelimiter = delim;
      if (delim === '\t') break; // prefer TAB
    }
  }

  const delimiter = bestDelimiter;
  const firstValues = firstLine.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));

  let headers;
  if (forceHeaders !== undefined) {
    headers = forceHeaders;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (--no-header)`);
  } else if (looksLikeHeader(firstValues)) {
    headers = firstValues;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (有表头)`);
  } else {
    headers = DEFAULT_14COL_HEADERS;
    console.log(`  分隔符: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} 列 (自动识别: 无表头)`);
  }

  return { headers, delimiter };
}

// ================== 主流程 ==================
async function importFile(filePath, speciesName, forceHeaders) {
  const startTime = Date.now();
  const BATCH_SIZE = 500;

  // 1. 检查文件
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const stat = fs.statSync(filePath);
  const fileSizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`\n📂 File: ${path.basename(filePath)}`);
  console.log(`📏 Size: ${fileSizeMB} MB`);
  console.log(`🏷️  Species: ${speciesName}`);
  console.log(`\n📖 Reading file (streaming)...`);

  // 2. 单次 readline 循环，避免多次 for-await 导致数据丢失
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let totalInserted = 0;
  let failedBatches = 0;
  let connection = null;
  let activeTable = 'cis_elements';
  let headers, delimiter, headerMap;
  let insertCols, sqlCols, placeholders;
  let colMaxLen = {};
  let batchNum = 0;
  let batchValues = [];
  let batchPlaceholders = [];
  let sampleRows = [];
  let lineNum = 0;
  let setupDone = false;       // DB connection + table + columns ready
  let preScanDone = false;     // VARCHAR upgrade scan done
  let sampleInserted = false;  // sample rows flushed to DB

  const SAMPLE_SIZE = 1000;

  // ── 辅助函数 ──
  function buildRowData(values) {
    const rowData = [];
    insertCols.forEach(colName => {
      if (colName === 'species') {
        rowData.push(speciesName);
        return;
      }
      const fileHeader = Object.keys(headerMap).find(k => headerMap[k] === colName);
      const fileIndex = headers.indexOf(fileHeader);
      let val = (fileIndex !== -1) ? values[fileIndex] : null;
      if (val != null && typeof val === 'string') {
        const maxLen = colMaxLen[colName.toLowerCase()];
        if (maxLen && val.length > maxLen) {
          val = val.substring(0, maxLen);
        }
      }
      rowData.push(val);
    });
    return rowData;
  }

  async function flushBatch() {
    if (batchPlaceholders.length === 0) return;
    batchNum++;
    try {
      const sql = `INSERT INTO ${activeTable} (${sqlCols}) VALUES ${batchPlaceholders.join(',')}`;
      await connection.query(sql, batchValues);
      totalInserted += batchPlaceholders.length;
    } catch (batchErr) {
      failedBatches++;
      if (failedBatches <= 3) {
        console.error(`\n   ⚠️ Batch ${batchNum} failed: ${batchErr.message}`);
      }
    }
    batchValues = [];
    batchPlaceholders = [];
  }

  function printProgress() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = totalInserted > 0 ? (totalInserted / (elapsed || 0.1)).toFixed(0) : 0;
    process.stdout.write(`\r   ${totalInserted.toLocaleString()} rows | ${elapsed}s | ~${rate} rows/s   `);
  }

  async function doSetup() {
    // 3. Connect to DB
    console.log(`\n🔌 Connecting to MySQL...`);
    connection = await promisePool.getConnection();
    console.log(`   ✅ Connected`);

    // 4. Determine table & set up columns
    const [tables] = await connection.query("SHOW TABLES");
    const tableNames = tables.map(t => Object.values(t)[0]);
    activeTable = tableNames.includes('cis_elements') ? 'cis_elements' : 'peaks';
    console.log(`   📊 Using table: ${activeTable}`);

    const [existingCols] = await connection.query(`SHOW COLUMNS FROM ${activeTable}`);
    const existingColNames = existingCols.map(c => c.Field.toLowerCase());

    const missingColumns = [];
    for (const h of headers) {
      const dbName = headerMap[h];
      if (!existingColNames.includes(dbName.toLowerCase())) {
        missingColumns.push(dbName);
      }
    }

    if (missingColumns.length > 0) {
      console.log(`\n🛠 Adding ${missingColumns.length} new columns in one pass...`);
      const addColSqls = missingColumns.map(c => `ADD COLUMN \`${c}\` LONGTEXT`).join(', ');
      console.log(`   Executing ALTER TABLE...`);
      const alterStart = Date.now();
      await connection.query(`ALTER TABLE ${activeTable} ${addColSqls}`);
      console.log(`   ✅ Done in ${((Date.now() - alterStart) / 1000).toFixed(1)}s`);
      missingColumns.forEach(c => existingColNames.push(c.toLowerCase()));
    } else {
      console.log(`   ✅ All columns exist`);
    }

    // Build VARCHAR max-length map
    colMaxLen = {};
    for (const col of existingCols) {
      const type = col.Type.toLowerCase();
      const match = type.match(/varchar\((\d+)\)/);
      if (match) colMaxLen[col.Field.toLowerCase()] = parseInt(match[1]);
    }

    setupDone = true;
  }

  async function doPreScan() {
    if (sampleRows.length === 0) { preScanDone = true; return; }

    const [indexInfo] = await connection.query(`SHOW INDEX FROM ${activeTable}`);
    const indexedCols = new Set(indexInfo.map(r => r.Column_name));

    const colsToUpgrade = new Set();
    for (const row of sampleRows) {
      for (const h of headers) {
        const dbName = headerMap[h];
        const maxLen = colMaxLen[dbName.toLowerCase()];
        if (!maxLen) continue;
        const fileIndex = headers.indexOf(h);
        const val = row[fileIndex];
        if (val != null && typeof val === 'string' && val.length > maxLen) {
          colsToUpgrade.add(dbName);
        }
      }
    }

    if (colsToUpgrade.size > 0) {
      const toUpgrade = [...colsToUpgrade].filter(c => !indexedCols.has(c));
      const toSkip = [...colsToUpgrade].filter(c => indexedCols.has(c));
      if (toSkip.length > 0) {
        console.log(`\n⚠️  Skipping ${toSkip.length} indexed column(s): ${toSkip.join(', ')} (values will be truncated)`);
      }
      for (const colName of toUpgrade) {
        console.log(`   - Upgrading '${colName}' (VARCHAR→LONGTEXT)...`);
        await connection.query(`ALTER TABLE ${activeTable} MODIFY COLUMN \`${colName}\` LONGTEXT`);
        delete colMaxLen[colName.toLowerCase()];
      }
    }

    // Prepare INSERT statement
    insertCols = [...new Set(Object.values(headerMap))];
    if (!insertCols.includes('species')) insertCols.push('species');
    sqlCols = insertCols.map(c => `\`${c}\``).join(',');
    placeholders = `(${insertCols.map(() => '?').join(',')})`;

    preScanDone = true;
  }

  async function insertSampleRows() {
    for (const values of sampleRows) {
      batchValues.push(...buildRowData(values));
      batchPlaceholders.push(placeholders);
      if (batchPlaceholders.length >= BATCH_SIZE) {
        await flushBatch();
      }
    }
    sampleRows = null; // free memory
    sampleInserted = true;
    printProgress();
  }

  // ── 单次循环：读取全部行 ──
  try {
    for await (const line of rl) {
      lineNum++;
      const trimmed = line.trim();
      if (!trimmed) continue; // skip blank lines

      // ── 第 1 行：检测分隔符 & 确定表头 ──
      if (lineNum === 1) {
        const result = parseFirstLine(line, forceHeaders);
        headers = result.headers;
        delimiter = result.delimiter;
        console.log(`   Headers: ${headers.join(', ')}`);

        // Build header map
        headerMap = {};
        for (const h of headers) {
          headerMap[h] = sanitizeColumnName(h);
        }

        // 判断第一行是否为表头
        const firstValues = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
        if (looksLikeHeader(firstValues) && forceHeaders === undefined) {
          // 第一行是表头 → 跳过，不作为数据
          console.log(`   检测到表头行，跳过第一行`);
          continue;
        }
        // 第一行是数据 → 继续往下处理（落到下面的数据处理逻辑）
      }

      // ── 数据行 ──
      const values = line.split(delimiter).map(cleanValue);

      // 如果还没完成 DB 初始化，先连接
      if (!setupDone) {
        await doSetup();
      }

      // 收集前 SAMPLE_SIZE 行作为样本，用于 VARCHAR 升级扫描
      if (!preScanDone && sampleRows.length < SAMPLE_SIZE) {
        sampleRows.push(values);
        if (sampleRows.length >= SAMPLE_SIZE) {
          await doPreScan();
          await insertSampleRows();
        }
        continue;
      }

      // 样本收集完成但尚未插入
      if (preScanDone && !sampleInserted) {
        await insertSampleRows();
      }

      // 常规数据行：加入批处理
      if (preScanDone && sampleInserted) {
        batchValues.push(...buildRowData(values));
        batchPlaceholders.push(placeholders);

        if (batchPlaceholders.length >= BATCH_SIZE) {
          await flushBatch();
          if (batchNum % 20 === 0) printProgress();
        }
      }
    }

    // 如果样本行没达到 SAMPLE_SIZE，在读完文件后再做预扫描和插入
    if (!preScanDone) {
      await doPreScan();
      await insertSampleRows();
    }

    // 如果样本插入后还有数据在 sample 收集阶段就进入常规流程的（例如刚好 SAMPLE_SIZE 之后的行）
    // 实际上在上面的循环中，sampleRows 达到 SAMPLE_SIZE 后就会走常规流程。
    // 但如果文件总行数 < SAMPLE_SIZE，样本插入后 batch 里可能还有剩余。
    // 刷新最后的批次
    await flushBatch();

    // 9. Results
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`✅ IMPORT COMPLETE`);
    console.log(`   Species:    ${speciesName}`);
    console.log(`   Rows:       ${totalInserted.toLocaleString()}`);
    console.log(`   Failed:     ${failedBatches} batches`);
    console.log(`   Time:       ${totalTime}s`);
    console.log(`   Rate:       ${(totalInserted / (totalTime || 0.1)).toFixed(0)} rows/s`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (err) {
    console.error(`\n❌ Database error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

// ================== 命令行入口 ==================
const args = process.argv.slice(2);
const noHeader = args.includes('--no-header');

// Parse --header "col1,col2,..." to specify custom column order
let headerIdx = args.indexOf('--header');
let customHeaders = undefined;
if (headerIdx !== -1) {
  customHeaders = args[headerIdx + 1].split(',').map(h => h.trim());
}

const cleanArgs = args.filter(a => a !== '--no-header' && a !== '--header' && !(customHeaders && a === args[headerIdx + 1]));

if (cleanArgs.length < 2) {
  console.log(`
用法: node bulk_import.js [--no-header] [--header "col1,col2,..."] <path> <species_name>
      node bulk_import.js [--no-header] --dir <dir_path> [species_name]

  --no-header  文件无表头，使用默认14列顺序
  --header     自定义列顺序，逗号分隔 (例: --header "Peak_ID,Position,tissue,nearest gene,...")
  path 为目录时自动导入所有 .bed 文件

示例:
  node bulk_import.js "data.bed" "Wheat"
  node bulk_import.js --header "Peak_ID,Position,tissue" "data.bed" "Wheat"
  node bulk_import.js "/data/bed_files/" "Oryza sativa"
`);
  process.exit(1);
}

// Determine forceHeaders: custom > default-14col > auto-detect
const forceHeaders = customHeaders || (noHeader ? DEFAULT_14COL_HEADERS : undefined);

(async () => {
  const pathArg = cleanArgs[0];
  const speciesArg = cleanArgs[1];

  try {
    if (pathArg === '--dir') {
      const dirPath = cleanArgs[1];
      const speciesName = cleanArgs[2] || null;
      await importDir(dirPath, speciesName);
    } else if (fs.existsSync(pathArg) && fs.statSync(pathArg).isDirectory()) {
      await importDir(pathArg, speciesArg);
    } else {
      await importFile(pathArg, speciesArg, forceHeaders);
    }
  } finally {
    await pool.end();
  }
})();

async function importDir(dirPath, defaultSpecies) {
  if (!fs.existsSync(dirPath)) {
    console.error(`❌ Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.bed'))
    .sort();

  if (files.length === 0) {
    console.error(`❌ No .bed files found in ${dirPath}`);
    process.exit(1);
  }

  console.log(`\n📁 Found ${files.length} .bed files in ${dirPath}\n`);

  const importedSpecies = new Set();

  for (const file of files) {
    let speciesName;
    if (defaultSpecies) {
      speciesName = defaultSpecies;
    } else {
      // 从文件名自动提取物种名（先去掉.bed后缀）
      const baseName = file.replace(/\.bed$/i, '');
      const parts = baseName.split('_');
      if (baseName.includes('chicken')) {
        speciesName = 'Gallus gallus';
      } else if (baseName.includes('human')) {
        speciesName = 'Homo sapiens';
      } else if (baseName.includes('pig')) {
        speciesName = 'Sus scrofa';
      } else if (baseName.includes('fly')) {
        speciesName = 'Drosophila melanogaster';
      } else if (baseName.includes('zebrafish')) {
        speciesName = 'Danio rerio';
      } else {
        const genus = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        const species = parts[1] || '';
        speciesName = `${genus} ${species}`.trim();
      }
    }
    importedSpecies.add(speciesName);

    const fullPath = path.join(dirPath, file);
    await importFile(fullPath, speciesName, forceHeaders);
  }

  console.log(`\n🎉 ALL IMPORTS COMPLETE! ${files.length} files processed.\n`);

  // Refresh species_stats summary table for imported species
  console.log(`📊 Refreshing summary stats for ${importedSpecies.size} species...\n`);
  const ACTIVE_TABLE = await (async () => {
    const [tables] = await promisePool.query("SHOW TABLES");
    const tableNames = tables.map(t => Object.values(t)[0]);
    if (tableNames.includes('cis_elements')) return 'cis_elements';
    if (tableNames.includes('peaks')) return 'peaks';
    return 'cis_elements';
  })();

  // Ensure species_stats table exists
  await promisePool.query(`
    CREATE TABLE IF NOT EXISTS species_stats (
      species VARCHAR(255) PRIMARY KEY,
      total_peaks INT DEFAULT 0,
      tissue_dist LONGTEXT,
      context_dist LONGTEXT,
      updated_at BIGINT DEFAULT 0
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  for (const sp of importedSpecies) {
    console.log(`   Updating stats for ${sp}...`);
    try {
      const [countRows] = await promisePool.query(`SELECT COUNT(*) as total FROM ${ACTIVE_TABLE} WHERE species = ?`, [sp]);
      const totalPeaks = countRows[0].total;

      let tissueDist = [];
      try {
        // 不加 LIMIT: 组织基数很小，全量分布体积可控；/api/filters 快路径依赖完整 tissue_dist
        const [rows] = await promisePool.query(
          `SELECT tissue as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND tissue IS NOT NULL GROUP BY tissue ORDER BY count DESC`,
          [sp]
        );
        tissueDist = rows.map(r => ({ label: r.label || 'Unknown', count: r.count }));
      } catch (e) { /* column might not exist */ }

      let contextDist = [];
      try {
        const [rows] = await promisePool.query(
          `SELECT genomic_context as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND genomic_context IS NOT NULL GROUP BY genomic_context ORDER BY count DESC`,
          [sp]
        );
        contextDist = rows.map(r => ({ label: r.label || 'Unknown', value: r.count }));
      } catch (e) { /* column might not exist */ }

      await promisePool.query(
        `INSERT INTO species_stats (species, total_peaks, tissue_dist, context_dist, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE total_peaks = VALUES(total_peaks), tissue_dist = VALUES(tissue_dist), context_dist = VALUES(context_dist), updated_at = VALUES(updated_at)`,
        [sp, totalPeaks, JSON.stringify(tissueDist), JSON.stringify(contextDist), Date.now()]
      );
      console.log(`      ✅ ${totalPeaks.toLocaleString()} peaks`);
    } catch (e) {
      console.log(`      ⚠️ Failed: ${e.message}`);
    }
  }

  // Delete cache file so server picks up new data
  const cacheFile = path.join(__dirname, '.api_cache.json');
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
    console.log(`\n🗑️  Cache cleared — restart server or it will auto-refresh on next request.\n`);
  }

  console.log(`✅ Stats refresh complete.\n`);
  process.exit(0);
}
