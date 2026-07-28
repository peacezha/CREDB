require('dotenv').config();

const http = require('http');
const url = require('url');
const mysql = require('mysql2');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// Port configuration
const PORT = parseInt(process.env.PORT, 10) || 8001;
// Global variable to store which table we are using
let ACTIVE_TABLE = 'peaks';

// --- FIMO Motif Database Configuration ---
// Map species to motif database paths. Set to null to disable FIMO for a species.
const MOTIF_DB_BASE = '/data2/analysis/meme';
const MOTIF_DB_HUMAN = path.join(MOTIF_DB_BASE, 'JASPAR_Human_CORE.meme');
const MOTIF_DB_PLANTS = path.join(MOTIF_DB_BASE, 'JASPAR2022_CORE_plants_redundant_pfms.meme');
const MOTIF_DB_MAMMALS = path.join(MOTIF_DB_BASE, 'mammals_motifs.meme');
const MOTIF_DB_VERTEBRATE = path.join(MOTIF_DB_BASE, 'vertebrate_motifs.meme');

const MOTIF_DB_CONFIG = {
  // --- Human ---
  Human: MOTIF_DB_HUMAN,

  // --- Mammals ---
  Bos: MOTIF_DB_MAMMALS,
  Canis: MOTIF_DB_MAMMALS,
  Capra: MOTIF_DB_MAMMALS,
  Equus_asinus: MOTIF_DB_MAMMALS,
  Equus_caballus: MOTIF_DB_MAMMALS,
  Macaca: MOTIF_DB_MAMMALS,
  Mus: MOTIF_DB_MAMMALS,
  Oryctolagus: MOTIF_DB_MAMMALS,
  Ovis: MOTIF_DB_MAMMALS,
  Sus: MOTIF_DB_MAMMALS,

  // --- Other Vertebrates (birds, fish) ---
  Anas: MOTIF_DB_VERTEBRATE,
  Anser: MOTIF_DB_VERTEBRATE,
  Gallus: MOTIF_DB_VERTEBRATE,
  Zebrafish: MOTIF_DB_VERTEBRATE,

  // --- Invertebrates (no DB) ---
  // Fly: skipped

  // --- Plants ---
  Arabidopsis_thaliana: MOTIF_DB_PLANTS,
  Brachypodium_distachyon: MOTIF_DB_PLANTS,
  Carica_papaya: MOTIF_DB_PLANTS,
  Citrullus_lanatus: MOTIF_DB_PLANTS,
  Cucumis_melo: MOTIF_DB_PLANTS,
  Cucumis_sativus: MOTIF_DB_PLANTS,
  Eucalyptus_grandis: MOTIF_DB_PLANTS,
  Eutrema_salsugineum: MOTIF_DB_PLANTS,
  Fragaria_vesca: MOTIF_DB_PLANTS,
  Glycine_max: MOTIF_DB_PLANTS,
  Gossypium_arboreum: MOTIF_DB_PLANTS,
  Gossypium_barbadense: MOTIF_DB_PLANTS,
  Gossypium_hirsutum: MOTIF_DB_PLANTS,
  Gossypium_raimondii: MOTIF_DB_PLANTS,
  Malus_domestica: MOTIF_DB_PLANTS,
  Oryza_sativa: MOTIF_DB_PLANTS,
  Phaseolus_vulgaris: MOTIF_DB_PLANTS,
  Populus_trichocarpa: MOTIF_DB_PLANTS,
  Prunus_persica: MOTIF_DB_PLANTS,
  Solanum_lycopersicum: MOTIF_DB_PLANTS,
  Sorghum_bicolor: MOTIF_DB_PLANTS,
  Triticum_aestivum: MOTIF_DB_PLANTS,
};
const FIMO_MAX_MOTIFS = 6;
const FIMO_P_VALUE = '1e-4';
const FIMO_MOTIF_COLOR = '#457B9D';

// --- Genome FASTA Configuration (for region-based sequence extraction) ---
// Maps species to their genome FASTA path. Requires .fai index alongside the .fa/.fna file.
const GENOME_CONFIG = {
  Arabidopsis_thaliana:     '/data/jbrowse2/data/db/Arabidopsis_thaliana_TAIR10/Arabidopsis_thaliana.TAIR10.dna.toplevel.fa',
  Brachypodium_distachyon:  '/data/jbrowse2/data/db/Brachypodium_distachyon_v3.0/Brachypodium_distachyon.Brachypodium_distachyon_v3.0.dna.toplevel.fa',
  Carica_papaya:            '/data/jbrowse2/data/db/Carica_papaya/GCF_000150535.2_Papaya1.0_genomic.fa',
  Citrullus_lanatus:        '/data/jbrowse2/data/db/Citrullus_lanatus/Citrullus_lanatus.Cla97_v1.dna.toplevel.fa',
  Cucumis_melo:             '/data/jbrowse2/data/db/Cucumis_melo_v4.0/Cucumis_melo.Melonv4.dna.toplevel.fa',
  Cucumis_sativus:          '/data/jbrowse2/data/db/Cucumis_sativus/GCF_000004075.3_Cucumber_9930_V3_genomic.fa',
  Eucalyptus_grandis:       '/data/jbrowse2/data/db/Eucalyptus_grandis/GCF_016545825.1_ASM1654582v1_genomic.fa',
  Eutrema_salsugineum:      '/data/jbrowse2/data/db/Eutrema_salsugineum/Eutrema_salsugineum.Eutsalg1_0.dna.toplevel.fa',
  Fragaria_vesca:           '/data/jbrowse2/data/db/Fragaria_vesca/GCF_000184155.1_FraVesHawaii_1.0_genomic.fa',
  Glycine_max:              '/data/jbrowse2/data/db/Glycine_max/Glycine_max.Glycine_max_v2.1.dna.toplevel.fa',
  Gossypium_arboreum:       '/data/jbrowse2/data/db/Gossypium_arboreum/GCF_000612285.1_Gossypium_arboreum_v1.0_genomic.fa',
  Gossypium_barbadense:     '/data/jbrowse2/data/db/Gossypium_barbadense/GCA_008761655.1_Gossypium_barbadense_v1.1_genomic.fa',
  Gossypium_hirsutum:       '/data/jbrowse2/data/db/Gossypium_hirsutum/GCF_007990345.1_Gossypium_hirsutum_v2.1_genomic.fa',
  Gossypium_raimondii:      '/data/jbrowse2/data/db/Gossypium_raimondii/Gossypium_raimondii.Graimondii2_0_v6.dna.toplevel.fa',
  Malus_domestica:          '/data/jbrowse2/data/db/Malus_domestica/Malus_domestica_golden.ASM211411v1.dna.toplevel.fa',
  Oryza_sativa:             '/data/jbrowse2/data/db/Oryza_sativa_IRGSP-1.0/Oryza_sativa.IRGSP-1.0.dna.toplevel.fa',
  Phaseolus_vulgaris:       '/data/jbrowse2/data/db/Phaseolus_vulgaris/Phaseolus_vulgaris.PhaVulg1_0.dna.toplevel.fa',
  Populus_trichocarpa:      '/data/jbrowse2/data/db/Populus_trichocarpa_v3.0/Ptrichocarpa_210_v3.0.fa',
  Prunus_persica:           '/data/jbrowse2/data/db/Prunus_persica_v2.0/Prunus_persica.Prunus_persica_NCBIv2.dna.toplevel.fa',
  Solanum_lycopersicum:     '/data/jbrowse2/data/db/Solanum_lycopersicum/Solanum_lycopersicum.SL2.50.dna.toplevel.fa',
  Sorghum_bicolor:          '/data/jbrowse2/data/db/Sorghum_bicolor/Sorghum_bicolor.Sorghum_bicolor_NCBIv3.dna.toplevel.fa',
  Triticum_aestivum:        '/data/jbrowse2/data/Triticum_aestivum.IWGSC.dna.toplevel.fa',
};

// --- Species whitelist for /api/predict ---
// Union of server-configured motif DB and genome keys. The species value is used
// to build the model path passed to a shell command, so only these server-side
// keys are accepted — raw user input never reaches the command string.
const PREDICT_SPECIES_WHITELIST = new Set([...Object.keys(MOTIF_DB_CONFIG), ...Object.keys(GENOME_CONFIG)]);
const PREDICT_MODEL_PATHS = {};
for (const sp of PREDICT_SPECIES_WHITELIST) PREDICT_MODEL_PATHS[sp] = `finetune/${sp}_result`;

// --- FASTA Sequence Extraction using .fai index ---
function extractSequence(fastaPath, chr, start, end) {
  const faiPath = fastaPath + '.fai';
  if (!fs.existsSync(faiPath)) {
    throw new Error(`FAI index not found: ${faiPath}. Run: samtools faidx ${fastaPath}`);
  }

  // Parse FAI index to find the chromosome
  const faiContent = fs.readFileSync(faiPath, 'utf8');
  const lines = faiContent.trim().split('\n');
  let chrInfo = null;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts[0] === chr) {
      chrInfo = {
        name: parts[0],
        length: parseInt(parts[1]),
        offset: parseInt(parts[2]),
        linebases: parseInt(parts[3]),
        linewidth: parseInt(parts[4])
      };
      break;
    }
  }
  if (!chrInfo) {
    throw new Error(`Chromosome "${chr}" not found in FAI index. Available: ${lines.map(l => l.split('\t')[0]).join(', ')}`);
  }

  const start0 = start - 1;        // 0-based start
  const end0 = end;                // 0-based exclusive end
  const seqLen = end0 - start0;

  if (start0 < 0 || end0 > chrInfo.length) {
    throw new Error(`Region ${start}-${end} out of bounds (chr length: ${chrInfo.length})`);
  }

  // Calculate byte range in the FASTA file
  const startLine = Math.floor(start0 / chrInfo.linebases);
  const startCol = start0 % chrInfo.linebases;
  const endLine = Math.floor((end0 - 1) / chrInfo.linebases);
  const endCol = (end0 - 1) % chrInfo.linebases;

  const startByte = chrInfo.offset + startLine * chrInfo.linewidth + startCol;
  const endByte = chrInfo.offset + endLine * chrInfo.linewidth + endCol + 1;

  const fd = fs.openSync(fastaPath, 'r');
  const buffer = Buffer.alloc(endByte - startByte);
  fs.readSync(fd, buffer, 0, endByte - startByte, startByte);
  fs.closeSync(fd);

  return buffer.toString('utf8').replace(/[\r\n]/g, '').toUpperCase();
}

// --- List chromosomes from FAI index ---
function getChromosomes(fastaPath) {
  const faiPath = fastaPath + '.fai';
  if (!fs.existsSync(faiPath)) return [];
  const faiContent = fs.readFileSync(faiPath, 'utf8');
  return faiContent.trim().split('\n').map(line => {
    const parts = line.split('\t');
    return { name: parts[0], length: parseInt(parts[1]) };
  });
}

// Cached column list — refreshed on startup and after uploads
let cachedColumns = [];
let cachedColumnNames = [];
// Columns that have a FULLTEXT index (detected at startup; created by scripts/db_optimize.js)
let fulltextCols = new Set();

// --- DATABASE CONNECTION ---
// Credentials come from environment variables (see .env.example). DB_PASSWORD is required.
if (!process.env.DB_PASSWORD) {
  console.error('❌ Missing DB_PASSWORD environment variable.');
  console.error('   Create a .env file in the project root (see .env.example) or set DB_PASSWORD in the environment, then restart.');
  process.exit(1);
}
const pool = mysql.createPool({
  host: process.env.DB_HOST || "211.69.142.213",
  database: process.env.DB_NAME || "atac_web",
  user: process.env.DB_USER || "ATAC_web",
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 100,
  enableKeepAlive: true,
  maxIdle: 10,
  idleTimeout: 60000,
  connectTimeout: 10000,
});

const promisePool = pool.promise();

// --- COLUMN MAPPING CONFIGURATION ---
// Key: Frontend/Display Name, Value: Database Column Name
// We keep this for backward compatibility and specific overrides
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

// --- INITIALIZATION & SCHEMA SETUP ---
async function initializeDatabase() {
  try {
    const connection = await promisePool.getConnection();
    console.log("�? Successfully connected to MySQL database: atac_web");

    // 1. Check existing tables
    const [tables] = await connection.query("SHOW TABLES");
    const tableNames = tables.map(t => Object.values(t)[0]);
    console.log("📊 Existing tables:", tableNames);

    // 2. Determine which table to use
    if (tableNames.includes('cis_elements')) {
      ACTIVE_TABLE = 'cis_elements';
      console.log(`ℹ️ Found 'cis_elements' table. Using it as the primary data source.`);
    } else if (tableNames.includes('peaks')) {
      ACTIVE_TABLE = 'peaks';
      console.log(`ℹ️ Using 'peaks' table (Flexible Mode).`);
    } else {
      console.log("⚠️ No suitable table found. Creating 'peaks' table...");
      // Base schema with LONGTEXT default for unknown future columns
      const createTableQuery = `
        CREATE TABLE peaks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          \`species\` VARCHAR(100) DEFAULT 'Wheat' 
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `;
      await connection.query(createTableQuery);
      ACTIVE_TABLE = 'peaks';
    }

    // 3. CREATE / UPGRADE SUMMARY TABLE
    await connection.query(`
      CREATE TABLE IF NOT EXISTS species_stats (
        species VARCHAR(255) PRIMARY KEY,
        total_peaks INT DEFAULT 0,
        tissue_dist LONGTEXT,
        context_dist LONGTEXT,
        type_dist LONGTEXT,
        gene_dist LONGTEXT,
        chr_dist LONGTEXT,
        updated_at BIGINT DEFAULT 0
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    // Add missing columns for older tables
    for (const col of ['type_dist', 'gene_dist', 'chr_dist']) {
      try {
        await connection.query(`ALTER TABLE species_stats ADD COLUMN \`${col}\` LONGTEXT`);
      } catch (e) { /* already exists */ }
    }
    // tissue_complete: 1 once the FULL tissue list (not the old top-10) has been
    // computed for that species — prevents background recompute storms at boot.
    try {
      await connection.query(`ALTER TABLE species_stats ADD COLUMN \`tissue_complete\` TINYINT DEFAULT 0`);
    } catch (e) { /* already exists */ }

    // 4. LOAD PERSISTENT CACHE FROM DISK
    loadCacheFromDisk();

    // 5. CACHE COLUMN LIST
    console.log(`📋 Caching column list...`);
    const [cols] = await connection.query(`SHOW COLUMNS FROM ${ACTIVE_TABLE}`);
    cachedColumns = cols;
    cachedColumnNames = cols.map(c => c.Field);
    console.log(`   ${cachedColumnNames.length} columns found.`);

    // 4. ADD INDICES FOR PERFORMANCE (run in background to avoid blocking startup)
    console.log(`🔍 Checking indexes...`);
    const [existingIndices] = await connection.query(`SHOW INDEX FROM ${ACTIVE_TABLE}`);
    const existingNames = new Set(existingIndices.map(r => r.Key_name));

    // Detect FULLTEXT indexes — enables MATCH ... AGAINST search in /api/peaks & /api/suggest
    fulltextCols = new Set(
      existingIndices
        .filter(r => (r.Index_type || '').toUpperCase() === 'FULLTEXT')
        .map(r => r.Column_name)
    );
    if (fulltextCols.size > 0) {
      console.log(`   🔎 FULLTEXT search enabled for: ${[...fulltextCols].join(', ')}`);
    } else {
      console.log(`   ℹ️ No FULLTEXT indexes found. Run npm run db:optimize to enable full-text search.`);
      console.log(`     e.g. nohup node scripts/db_optimize.js --apply --only 3 > ft.log 2>&1 &`);
    }

    const missingIndexes = [];
    // `cols` entries may carry a prefix length, e.g. 'tissue(100)'; composite
    // indexes list multiple columns. New prefix indexes use (100) — existing
    // (255) indexes are kept as-is since they are skipped by name.
    const PERF_INDEXES = [
      { name: 'idx_species', cols: ['species'] },
      // (species, id) covers `WHERE species = ? ORDER BY id LIMIT n OFFSET m`
      // entirely in-index — fast deterministic deep paging per species.
      { name: 'idx_species_id', cols: ['species', 'id'] },
      { name: 'idx_tissue', cols: ['tissue(100)'] },
      { name: 'idx_position', cols: ['position(100)'] },
      { name: 'idx_peak_id', cols: ['peak_id(100)'] },
      { name: 'idx_nearest_gene', cols: ['nearest_gene(100)'] },
      { name: 'idx_species_tissue', cols: ['species', 'tissue(100)'] },
      { name: 'idx_species_position', cols: ['species', 'position(100)'] },
      // Speeds up gene search & suggest without FULLTEXT: `species = ? AND
      // nearest_gene LIKE '%q%'` then only scans this species' index pages, and
      // `species = ? AND nearest_gene LIKE 'q%'` becomes an index range scan.
      // No USE/FORCE INDEX hints — the optimizer picks it on its own.
      { name: 'idx_species_gene', cols: ['species', 'nearest_gene(100)'] },
    ];

    for (const idx of PERF_INDEXES) {
      if (existingNames.has(idx.name)) continue;
      // Every referenced column must exist (strip any '(N)' prefix-length suffix)
      const allColsExist = idx.cols.every(c => cachedColumnNames.includes(c.replace(/\(\d+\)$/, '')));
      if (!allColsExist) continue;
      missingIndexes.push(idx);
    }

    if (missingIndexes.length > 0) {
      // Auto-creating indexes on a huge table at startup is dangerous: every
      // restart re-fires (or rolls back) the DDL and stalls the whole service.
      // Default is OFF — build them manually (see log below) during a quiet
      // window; set AUTO_CREATE_INDEXES=1 to restore the old behaviour.
      if (process.env.AUTO_CREATE_INDEXES === '1') {
        console.log(`   Creating ${missingIndexes.length} missing index(es) in background...`);
        // Build indexes asynchronously — don't block server startup
        (async () => {
          for (const idx of missingIndexes) {
            const colsSql = idx.cols.map(c => {
              const m = c.match(/^(.+?)\((\d+)\)$/);
              return m ? `\`${m[1]}\`(${m[2]})` : `\`${c}\``;
            }).join(', ');
            try {
              console.log(`   ⏳ Creating ${idx.name} on ${idx.cols.join(', ')}... (this may take a while for large tables)`);
              await promisePool.query(`CREATE INDEX \`${idx.name}\` ON ${ACTIVE_TABLE} (${colsSql})`);
              console.log(`   ✅ ${idx.name} created.`);
            } catch (e) {
              console.log(`   ⚠️ Could not create ${idx.name}: ${e.message}`);
            }
          }
        })();
      } else {
        console.log(`   ℹ️ ${missingIndexes.length} index(es) missing: ${missingIndexes.map(i => i.name).join(', ')}`);
        console.log(`      Auto-creation is disabled. Build manually during a quiet window, e.g.:`);
        for (const idx of missingIndexes) {
          const colsSql = idx.cols.map(c => {
            const m = c.match(/^(.+?)\((\d+)\)$/);
            return m ? `\`${m[1]}\`(${m[2]})` : `\`${c}\``;
          }).join(', ');
          console.log(`      CREATE INDEX \`${idx.name}\` ON ${ACTIVE_TABLE} (${colsSql});`);
        }
      }
    } else {
      console.log(`   All indexes present.`);
    }

    console.log("✅ Database schema check complete.");
    connection.release();
    return true;
  } catch (err) {
    console.error("�? Database Connection Failed:", err.message);
    return false;
  }
}

// --- HELPER: CLEAN VALUES THAT SHOULD BE NULL ---
// Recognises common "missing data" placeholders and converts them to null
// so MySQL integer/decimal columns don't choke on strings like '#NA'
const NA_PATTERNS = /^(#?N\/?A|#NA|null|NULL|None|none|NaN|nan|[-+]?inf(inity)?|\.|\?|\s*)$/i;
const cleanValue = (raw) => {
  let val = raw.trim().replace(/^"|"$/g, '');
  if (val === '' || NA_PATTERNS.test(val)) return null;
  return val;
};

// --- HELPER: ROBUST PARSER (CSV/TSV/Space-delimited) ---
// Default column headers for 14-column BED files without a header row
const DEFAULT_14COL_HEADERS = [
  'Peak_ID', 'Position', 'tissue', 'nearest gene', 'ToTSS', 'type',
  'Genomic_context_of_peak', 'Summit', 'PAM-position', 'expression in expVIP',
  'JBrowse_Link', 'nearest gene_expression/TPM', 'FootPrint', 'Motif'
];

const KNOWN_HEADERS = new Set(
  Object.keys(COLUMN_MAP).map(h => h.toLowerCase())
);

function looksLikeHeader(values) {
  const headerMatches = values.filter(v => KNOWN_HEADERS.has(v.toLowerCase().trim())).length;
  return headerMatches >= 2;
}

const parseData = (rawText) => {
  const lines = rawText.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };

  // Detect delimiter by multi-line consistency (avoids being fooled by commas inside fields)
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
  if (looksLikeHeader(firstValues)) {
    headers = firstValues;
    dataStart = 1;
    console.log(`📋 Delimiter: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} cols (has header)`);
  } else {
    // First line looks like data — use default 14-col headers
    headers = DEFAULT_14COL_HEADERS;
    dataStart = 0;
    console.log(`📋 Delimiter: ${delimiter === '\t' ? 'TAB' : delimiter === ' ' ? 'SPACE' : 'COMMA'}, ${headers.length} cols (auto: no header, using defaults)`);
  }

  const rows = lines.slice(dataStart).map(line => {
    if (!line.trim()) return null;
    const values = line.split(delimiter).map(cleanValue);
    return values;
  }).filter(r => r !== null && r.length > 0);

  return { headers, rows };
};

// Helper to sanitize column names for SQL
const sanitizeColumnName = (name) => {
  // 1. If it matches a known map key exactly, use the mapped DB column
  if (COLUMN_MAP[name]) return COLUMN_MAP[name];

  // 2. Otherwise, normalize:
  // Replace non-alphanumeric with underscores, ensure it doesn't start with number
  let safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  safeName = safeName.replace(/_+/g, '_');
  safeName = safeName.replace(/^_|_$/g, '');

  if (!safeName) return 'col_' + Math.floor(Math.random() * 1000);

  // 3. MySQL identifier limit is 64 chars — truncate if needed, keep suffix for uniqueness
  if (safeName.length > 64) {
    safeName = safeName.substring(0, 56) + '_' + safeName.substring(safeName.length - 7);
  }

  return safeName;
};

// --- HELPER: GET DB COLUMN NAME ---
const getDBCol = (key) => {
   if (COLUMN_MAP[key]) return COLUMN_MAP[key];
   return sanitizeColumnName(key);
};

// --- HELPER: REFRESH COLUMN CACHE ---
async function refreshColumnCache() {
  const [cols] = await promisePool.query(`SHOW COLUMNS FROM ${ACTIVE_TABLE}`);
  cachedColumns = cols;
  cachedColumnNames = cols.map(c => c.Field);
}

// --- HELPER: REFRESH SUMMARY TABLE FOR A SPECIES ---
async function refreshSpeciesStats(species) {
  const tissueCol = getDBCol('tissue');
  const contextCol = getDBCol('Genomic_context_of_peak');
  const colNames = cachedColumnNames;

  // Run COUNT + tissue GROUP BY first (fast), then context GROUP BY (slow, LONGTEXT)
  console.log(`      COUNT + tissue...`);
  const queries = [];
  queries.push(
    promisePool.query(`SELECT COUNT(*) as total FROM ${ACTIVE_TABLE} WHERE species = ?`, [species])
  );
  if (colNames.includes(tissueCol)) {
    // No LIMIT: tissue cardinality is tiny (a few to a few dozen per species),
    // so the full distribution stays small — and /api/filters' fast path relies
    // on tissue_dist being complete.
    queries.push(promisePool.query(
      `SELECT \`${tissueCol}\` as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND \`${tissueCol}\` IS NOT NULL GROUP BY \`${tissueCol}\` ORDER BY count DESC`,
      [species]
    ));
  } else {
    queries.push(Promise.resolve([[]]));
  }

  const [[countRows], [tissueRows]] = await Promise.all(queries);
  const totalPeaks = countRows[0].total;
  const tissueDist = tissueRows.map(r => ({ label: r.label || 'Unknown', count: r.count }));
  console.log(`      ${totalPeaks.toLocaleString()} peaks, ${tissueDist.length} tissues`);

  // Save fast stats immediately, then do slow context query.
  // tissue_complete=1: the tissue list written here is complete (no LIMIT).
  await promisePool.query(
    `INSERT INTO species_stats (species, total_peaks, tissue_dist, context_dist, updated_at, tissue_complete)
     VALUES (?, ?, ?, '[]', ?, 1)
     ON DUPLICATE KEY UPDATE total_peaks = VALUES(total_peaks), tissue_dist = VALUES(tissue_dist), updated_at = VALUES(updated_at), tissue_complete = 1`,
    [species, totalPeaks, JSON.stringify(tissueDist), Date.now()]
  );

  let contextDist = [];
  if (colNames.includes(contextCol)) {
    console.log(`      genomic_context GROUP BY... (slow, may take minutes)`);
    const [contextRows] = await promisePool.query(
      `SELECT \`${contextCol}\` as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND \`${contextCol}\` IS NOT NULL GROUP BY \`${contextCol}\` ORDER BY count DESC`,
      [species]
    );
    contextDist = contextRows.map(r => ({ label: r.label || 'Unknown', value: r.count }));
    console.log(`      ${contextDist.length} context categories`);
  }

  // Update with context_dist now available
  await promisePool.query(
    `UPDATE species_stats SET context_dist = ?, updated_at = ? WHERE species = ?`,
    [JSON.stringify(contextDist), Date.now(), species]
  );

  // Extra stats: type distribution, top genes, chromosome distribution
  const runStat = async (label, sql) => {
    const t0 = Date.now();
    try {
      const [r] = await promisePool.query(sql, [species]);
      console.log(`      ${label}: ${r.length} rows (${Date.now() - t0}ms)`);
      return JSON.stringify(r.map(x => ({ label: x.label, count: x.count })));
    } catch (e) {
      console.log(`      ⚠️ ${label}: ${e.message}`);
      return '[]';
    }
  };

  const typeDist = colNames.includes('type')
    ? await runStat('typeDist', `SELECT \`type\` as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND \`type\` IS NOT NULL AND \`type\` != '' GROUP BY \`type\` ORDER BY count DESC LIMIT 15`)
    : '[]';
  // Persist each distribution as soon as it is computed — a slow later query
  // (chrDist) or a restart must not discard the ones already finished.
  await promisePool.query(
    `UPDATE species_stats SET type_dist = ?, updated_at = ? WHERE species = ?`,
    [typeDist, Date.now(), species]
  );

  const geneDist = colNames.includes('nearest_gene')
    ? await runStat('geneDist', `SELECT \`nearest_gene\` as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND \`nearest_gene\` IS NOT NULL AND \`nearest_gene\` != '' GROUP BY \`nearest_gene\` ORDER BY count DESC LIMIT 15`)
    : '[]';
  await promisePool.query(
    `UPDATE species_stats SET gene_dist = ?, updated_at = ? WHERE species = ?`,
    [geneDist, Date.now(), species]
  );

  const chrDist = colNames.includes('position')
    ? await runStat('chrDist', `SELECT SUBSTRING_INDEX(\`position\`, ':', 1) as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE species = ? AND \`position\` LIKE '%:%' GROUP BY label ORDER BY LENGTH(label), label`)
    : '[]';
  await promisePool.query(
    `UPDATE species_stats SET chr_dist = ?, updated_at = ? WHERE species = ?`,
    [chrDist, Date.now(), species]
  );

  console.log(`      ✅ ${species} done.`);
}

// --- HELPER: FAST COUNT VIA species_stats ---
// Avoids a full COUNT(*) on the 20GB main table for the common single-dimension
// filter combos by reading pre-aggregated numbers from species_stats.
// tissue_dist / chr_dist are JSON arrays of { label, count } — labels are raw
// tissue values and SUBSTRING_INDEX(position, ':', 1) respectively, exactly the
// values /api/filters returns (tissue_dist is top-10 only: a missing label
// degrades to the real COUNT). Returns null whenever the combo isn't covered —
// caller falls back to the real COUNT. Never throws: any error degrades to null.
async function getFastCount({ species, tissue, chr, q }) {
  try {
    if (q && q.trim()) return null;                    // search queries always need a real COUNT
    const hasSpecies = species && species !== 'All Species';
    if (!hasSpecies) return null;
    const hasTissue = tissue && tissue !== 'All Tissues';
    const hasChr = chr && chr !== 'All Chromosomes';
    if (hasTissue && hasChr) return null;              // multi-dimension: not covered

    const [rows] = await promisePool.query(
      `SELECT total_peaks, tissue_dist, chr_dist FROM species_stats WHERE species = ?`,
      [species]
    );
    if (rows.length === 0) return null;
    const row = rows[0];

    if (!hasTissue && !hasChr) return row.total_peaks; // species only

    const distJson = hasTissue ? row.tissue_dist : row.chr_dist;
    const target = hasTissue ? tissue : chr;
    let dist;
    try { dist = JSON.parse(distJson || '[]'); } catch (e) { return null; }
    if (!Array.isArray(dist)) return null;
    const hit = dist.find(d => d && d.label === target);
    return hit ? hit.count : null;                     // label not in dist → real COUNT
  } catch (e) {
    console.log(`   ⚠️ fast count failed: ${e.message}`);
    return null;
  }
}

// --- HELPER: FAST FILTERS VIA species_stats ---
// Builds the /api/filters response from species_stats dists (instant, avoids
// --- HELPER: FAST FILTER OPTIONS FOR "ALL SPECIES" ---
// Unions tissue_dist / chr_dist labels across every species_stats row (instant).
// Used when /api/filters is called without a species — avoids a table-wide
// DISTINCT over the 20GB main table. tissue_dist may be top-10-only on older
// builds, so this is best-effort complete; never throws (null on any error).
async function getFastFiltersAll() {
  try {
    const [rows] = await promisePool.query(`SELECT tissue_dist, chr_dist FROM species_stats`);
    if (!rows.length) return null;
    const tissues = new Set();
    const chrs = new Set();
    let any = false;
    for (const row of rows) {
      for (const [field, set] of [
        ['tissue_dist', tissues],
        ['chr_dist', chrs],
      ]) {
        if (!row[field]) continue;
        try {
          const arr = JSON.parse(row[field]);
          if (Array.isArray(arr) && arr.length > 0) {
            any = true;
            arr.forEach((x) => x && x.label && set.add(x.label));
          }
        } catch (e) {
          /* skip malformed JSON */
        }
      }
    }
    if (!any) return null;
    return {
      tissues: [...tissues].sort(),
      chromosomes: [...chrs].sort((a, b) => a.length - b.length || (a < b ? -1 : 1)),
    };
  } catch (e) {
    console.error('getFastFiltersAll failed:', e.message);
    return null;
  }
}

// DISTINCT + filesort over millions of rows). tissue_dist may be top-10 only
// (older stats builds had LIMIT 10) — completeness is handled by
// recomputeFiltersInBackground. chr_dist is built without LIMIT, so its labels
// are already the complete chromosome list. Returns null when the species has
// no usable stats row — caller falls back to the live DISTINCT queries.
// Never throws: any error degrades to null.
async function getFastFilters(species) {
  try {
    const [rows] = await promisePool.query(
      `SELECT tissue_dist, chr_dist FROM species_stats WHERE species = ?`,
      [species]
    );
    if (rows.length === 0) return null;
    let tissueDist = [], chrDist = [];
    try { tissueDist = JSON.parse(rows[0].tissue_dist || '[]'); } catch (e) {}
    try { chrDist = JSON.parse(rows[0].chr_dist || '[]'); } catch (e) {}
    if (!Array.isArray(tissueDist) || !Array.isArray(chrDist)) return null;
    if (tissueDist.length === 0 && chrDist.length === 0) return null;
    const pick = (dist) => dist.map(d => d && d.label).filter(v => typeof v === 'string' && v !== '');
    const fullTissues = fullTissueLists.get(species);
    return {
      // Prefer the background-recomputed full list when available; otherwise the
      // stats top-N, alphabetically sorted like the live DISTINCT query returns.
      tissues: Array.isArray(fullTissues) ? fullTissues : pick(tissueDist).sort(),
      chromosomes: pick(chrDist), // complete already; keep stats order (natural-ish)
    };
  } catch (e) {
    console.log(`   ⚠️ filters fast path failed: ${e.message}`);
    return null;
  }
}

// --- BACKGROUND: RECOMPUTE FULL TISSUE LIST FOR /api/filters ---
// Runs the expensive DISTINCT tissue query once per species EVER (persisted to
// species_stats.tissue_dist + tissue_complete=1), then stores the full list in
// memory and patches the cached filters response. Species whose stats were
// built by current code are already complete and never trigger a recompute —
// this prevents per-boot recompute storms on the 20GB table.
// Chromosomes are NOT recomputed — chr_dist has no LIMIT.
async function recomputeFiltersInBackground(species) {
  if (fullTissueLists.has(species)) return; // done or already in flight
  fullTissueLists.set(species, 'pending');
  try {
    const tissueCol = getDBCol('tissue');
    if (!cachedColumnNames.includes(tissueCol)) return;

    // Skip when the persisted tissue list is already complete (permanent flag).
    try {
      const [flagRows] = await promisePool.query(
        `SELECT tissue_complete FROM species_stats WHERE species = ?`,
        [species]
      );
      if (flagRows.length > 0 && flagRows[0].tissue_complete === 1) {
        fullTissueLists.set(species, 'done');
        return;
      }
    } catch (e) { /* flag column missing on very old schemas — fall through */ }

    console.log(`   🔄 Recomputing full tissue list for ${species} in background...`);
    const t0 = Date.now();
    // GROUP BY (with counts) costs the same as DISTINCT here, and the counts
    // keep species_stats.tissue_dist valid for dashboards and fast COUNT.
    const [tissueRows] = await promisePool.query(
      `SELECT \`${tissueCol}\` as label, COUNT(*) as count FROM ${ACTIVE_TABLE} WHERE \`species\` = ? AND \`${tissueCol}\` IS NOT NULL AND \`${tissueCol}\` != '' GROUP BY \`${tissueCol}\` ORDER BY count DESC`,
      [species]
    );
    const tissueDist = tissueRows.map(r => ({ label: r.label || 'Unknown', count: r.count }));
    const tissues = tissueDist.map(r => r.label).sort();
    fullTissueLists.set(species, tissues);

    // Persist permanently: future boots skip the recompute entirely.
    try {
      await promisePool.query(
        `UPDATE species_stats SET tissue_dist = ?, tissue_complete = 1 WHERE species = ?`,
        [JSON.stringify(tissueDist), species]
      );
    } catch (e) {
      console.log(`   ⚠️ could not persist full tissue list for ${species}: ${e.message}`);
    }

    // Patch the cached filters response if it's still around
    const cacheKey = `filters_${species}`;
    const cachedEntry = getCached(cacheKey);
    if (cachedEntry) setCache(cacheKey, { ...cachedEntry, tissues });
    console.log(`   ✅ full tissue list for ${species}: ${tissues.length} tissues (${Date.now() - t0}ms)`);
  } catch (e) {
    fullTissueLists.delete(species); // allow retry on next request
    console.log(`   ⚠️ background tissue recompute failed for ${species}: ${e.message}`);
  }
}

// --- HELPER: REBUILD ALL SUMMARY STATS ---
async function rebuildAllStats() {
  const [rows] = await promisePool.query(
    `SELECT DISTINCT species FROM ${ACTIVE_TABLE} WHERE species IS NOT NULL AND species != ''`
  );
  const speciesList = rows.map(r => r.species);
  console.log(`📊 Rebuilding stats for ${speciesList.length} species...`);

  let completed = 0;
  for (const sp of speciesList) {
    console.log(`   [${++completed}/${speciesList.length}] ${sp}...`);
    await refreshSpeciesStats(sp);

    // Save progress to memory cache after EACH species (triggers disk write)
    const [dashRows] = await promisePool.query(
      `SELECT total_peaks, tissue_dist, context_dist, type_dist, gene_dist, chr_dist FROM species_stats WHERE species = ?`, [sp]
    );
    if (dashRows.length > 0) {
      const row = dashRows[0];
      let td = [], cd = [], yd = [], gd = [], hd = [];
      try { td = JSON.parse(row.tissue_dist || '[]'); } catch (e) {}
      try { cd = JSON.parse(row.context_dist || '[]'); } catch (e) {}
      try { yd = JSON.parse(row.type_dist || '[]'); } catch (e) {}
      try { gd = JSON.parse(row.gene_dist || '[]'); } catch (e) {}
      try { hd = JSON.parse(row.chr_dist || '[]'); } catch (e) {}
      setCache(`dash_${sp}`, {
        stats: { totalPeaks: row.total_peaks, tissues: td.length },
        distribution: cd, tissues: td,
        typeDist: yd, topGenes: gd, chrDist: hd,
      });
    }
    // Update species list incrementally
    const done = [];
    for (const [k] of cache) {
      if (k.startsWith('dash_')) done.push(k.replace('dash_', ''));
    }
    setCache('species_list', done.sort());
  }
  console.log('✅ Stats rebuild complete.');
}

// --- PERSISTENT CACHE (survives server restarts) ---
const CACHE_FILE = path.join(__dirname, '.api_cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const cache = new Map();
let saveTimer = null;

// Load cache from disk on startup
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const now = Date.now();
      for (const [key, entry] of Object.entries(raw)) {
        if (now - entry.ts < CACHE_TTL) {
          cache.set(key, entry);
        }
      }
      console.log(`📦 Loaded ${cache.size} cached entries from disk`);
    }
  } catch (e) {
    console.log('⚠️ Could not load cache file:', e.message);
  }
}

// Save cache to disk (debounced)
function saveCacheToDisk() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const obj = Object.fromEntries(cache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch (e) {
      console.log('⚠️ Could not save cache:', e.message);
    }
  }, 1000); // debounce 1 second
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); saveCacheToDisk(); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  saveCacheToDisk();
}

function clearCache() {
  cache.clear();
  try { fs.unlinkSync(CACHE_FILE); } catch (e) {}
  console.log('🗑️  Cache cleared');
}

// --- QUERY CACHE (in-memory TTL, for /api/peaks & /api/suggest) ---
const queryCache = new Map(); // key -> { data, expires }
const QUERY_CACHE_MAX = 500;

// Full per-species tissue lists recomputed in the background for /api/filters:
// species -> 'pending' | string[]. Doubles as the in-flight/done flag that
// prevents concurrent duplicate recompute runs.
const fullTissueLists = new Map();

function queryCacheGet(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { queryCache.delete(key); return null; } // lazy expiry
  return entry.data;
}

function queryCachePut(key, data, ttlMs) {
  if (queryCache.size >= QUERY_CACHE_MAX && !queryCache.has(key)) {
    // Map iterates in insertion order — evict the oldest entry
    queryCache.delete(queryCache.keys().next().value);
  }
  queryCache.set(key, { data, expires: Date.now() + ttlMs });
}

// Drop all cached query results (called after data mutations)
function invalidateDataCaches() {
  queryCache.clear();
  fullTissueLists.clear(); // force re-recompute of /api/filters full tissue lists
  console.log('🗑️  Query cache cleared');
}

// Build a BOOLEAN MODE full-text query string from free-text input.
// Terms are split on whitespace, stripped of boolean operators, and combined
// as "+t1* +t2*" (space-separated '+' terms are implicitly ANDed).
// Returns null when any term is shorter than 3 chars — caller falls back to LIKE.
function buildFulltextQuery(q) {
  const terms = q.trim().split(/\s+/)
    .map(t => t.replace(/[+\-@*"()><~]/g, ''))
    .filter(Boolean);
  if (terms.length === 0 || terms.some(t => t.length < 3)) return null;
  return terms.map(t => `+${t}*`).join(' ');
}

// --- CORS CONFIG ---
// Allowed origins come from CORS_ORIGINS (comma-separated). Requests from other
// origins get no Access-Control-Allow-Origin header, so browsers block them.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// --- RATE LIMITER for /api/predict (in-memory, per IP) ---
const PREDICT_RATE_LIMIT = 5;               // max requests per window
const PREDICT_RATE_WINDOW = 10 * 60 * 1000; // 10 minutes
const predictRateMap = new Map();           // ip -> [timestamps]

function isPredictRateLimited(ip) {
  const now = Date.now();
  const timestamps = (predictRateMap.get(ip) || []).filter(t => now - t < PREDICT_RATE_WINDOW);
  if (timestamps.length >= PREDICT_RATE_LIMIT) {
    predictRateMap.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  predictRateMap.set(ip, timestamps);
  return false;
}

// Periodically drop stale entries so the map doesn't grow unbounded
const predictRateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of predictRateMap) {
    const fresh = timestamps.filter(t => now - t < PREDICT_RATE_WINDOW);
    if (fresh.length === 0) predictRateMap.delete(ip);
    else predictRateMap.set(ip, fresh);
  }
}, PREDICT_RATE_WINDOW);
predictRateCleanup.unref();

// --- SERVER SETUP ---
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqStart = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - reqStart;
    if (ms > 200) console.log(`⏱️  SLOW ${req.method} ${req.url} — ${ms}ms`);
  });

  const parsedUrl = url.parse(req.url, true);

  // 0. GET /api/models — list available model directories
  if (parsedUrl.pathname === '/api/models' && req.method === 'GET') {
    try {
      const finetuneDir = '/data2/analysis/finetune';
      const entries = fs.readdirSync(finetuneDir, { withFileTypes: true });
      const models = entries
        .filter(e => e.isDirectory() && e.name.endsWith('_result'))
        .map(e => e.name.replace(/_result$/, ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(models));
    } catch (err) {
      console.error('Failed to list models:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify([]));
    }
    return;
  }

  // 0b. GET /api/overview — all-species summary for home page
  if (parsedUrl.pathname === '/api/overview' && req.method === 'GET') {
    const cacheKey = 'overview';
    const cached = getCached(cacheKey);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }
    try {
      const [rows] = await promisePool.query(
        `SELECT species, total_peaks, tissue_dist, context_dist FROM species_stats ORDER BY total_peaks DESC`
      );
      const overview = rows.map(r => {
        let tissueDist = [], contextDist = [];
        try { tissueDist = JSON.parse(r.tissue_dist || '[]'); } catch (e) {}
        try { contextDist = JSON.parse(r.context_dist || '[]'); } catch (e) {}
        return {
          species: r.species,
          totalPeaks: r.total_peaks,
          tissues: tissueDist.length,
          topTissues: tissueDist.slice(0, 5),
          topContexts: contextDist.slice(0, 5)
        };
      });
      setCache(cacheKey, overview);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(overview));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify([]));
    }
    return;
  }

  // 1. GET /api/species — reads from summary table (instant)
  if (parsedUrl.pathname === '/api/species' && req.method === 'GET') {
    const cacheKey = 'species_list';
    const cached = getCached(cacheKey);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }
    try {
      const [rows] = await promisePool.query(`SELECT species FROM species_stats ORDER BY species`);
      const speciesList = rows.map(r => r.species);
      setCache(cacheKey, speciesList);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(speciesList));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify([]));
    }
    return;
  }

  // 2. GET /api/filters (Fetch unique Tissues and Chromosomes) — CACHED per species
  if (parsedUrl.pathname === '/api/filters' && req.method === 'GET') {
    const { species } = parsedUrl.query;
    const cacheKey = `filters_${species || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }
    // Fast path (no species = "All Species"): union the labels from every row of
    // species_stats (instant). NEVER run a table-wide DISTINCT here — on the 20GB
    // table those queries pile up for hours and starve the whole service.
    if (!species || species === 'All Species') {
      const fastAll = await getFastFiltersAll();
      if (fastAll) {
        setCache(cacheKey, fastAll);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fastAll));
        return;
      }
    }
    // Fast path: build the lists from species_stats (instant). tissue_dist may be
    // top-10 only (older stats builds) — the full tissue list is recomputed once
    // in the background and patches this cache. chr_dist has no LIMIT, so the
    // chromosomes from stats are already complete.
    if (species && species !== 'All Species') {
      const fast = await getFastFilters(species);
      if (fast) {
        setCache(cacheKey, fast);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fast));
        recomputeFiltersInBackground(species); // fire & forget — guarded, never throws
        return;
      }
    }
    try {
      let whereClause = "WHERE 1=1";
      const params = [];
      if (species && species !== 'All Species') {
        whereClause += " AND `species` = ?";
        params.push(species);
      }

      const tissueCol = getDBCol('tissue');
      const posCol = getDBCol('Position');

      // Use cached column list (much faster than SHOW COLUMNS on every request)
      const colNames = cachedColumnNames;

      let tissues = [];
      let chromosomes = [];

      if (colNames.includes(tissueCol)) {
        const [tissueRows] = await promisePool.query(`SELECT DISTINCT \`${tissueCol}\` FROM ${ACTIVE_TABLE} ${whereClause} AND \`${tissueCol}\` IS NOT NULL AND \`${tissueCol}\` != '' ORDER BY \`${tissueCol}\``, params);
        tissues = tissueRows.map(r => r[tissueCol]);
      }

      if (colNames.includes('position') || colNames.includes(posCol)) {
         const pCol = colNames.includes('position') ? 'position' : posCol;
         const [posRows] = await promisePool.query(`SELECT DISTINCT SUBSTRING_INDEX(\`${pCol}\`, ':', 1) as chr FROM ${ACTIVE_TABLE} ${whereClause} AND \`${pCol}\` LIKE '%:%' ORDER BY chr`, params);
         chromosomes = posRows.map(r => r.chr);
      }

      const result = { tissues, chromosomes };
      setCache(cacheKey, result);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
       console.error(err);
       res.writeHead(500);
       res.end(JSON.stringify({ tissues: [], chromosomes: [] }));
    }
    return;
  }

  // 3. GET /api/stats — reads from summary table (instant)
  if (parsedUrl.pathname === '/api/stats' && req.method === 'GET') {
    const cacheKey = 'stats';
    const cached = getCached(cacheKey);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
      return;
    }
    try {
       const [rows] = await promisePool.query(`SELECT species, total_peaks as count, updated_at as updatedAt FROM species_stats ORDER BY species`);
       const totalPeaks = rows.reduce((sum, r) => sum + r.count, 0);

       const result = {
         totalPeaks: totalPeaks,
         speciesCount: rows.length,
         breakdown: rows
       };
       setCache(cacheKey, result);
       res.writeHead(200, { 'Content-Type': 'application/json' });
       res.end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // 4. GET /api/dashboard — reads from summary table (instant single-row lookup)
  if (parsedUrl.pathname === '/api/dashboard' && req.method === 'GET') {
    const { species } = parsedUrl.query;
    if (!species) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Species required" }));
      return;
    }

    try {
      const [rows] = await promisePool.query(
        `SELECT total_peaks, tissue_dist, context_dist, type_dist, gene_dist, chr_dist FROM species_stats WHERE species = ?`,
        [species]
      );

      if (rows.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          stats: { totalPeaks: 0, tissues: 0 },
          distribution: [],
          tissues: [],
          typeDist: [],
          topGenes: [],
          chrDist: [],
        }));
        return;
      }

      const row = rows[0];
      let tissueDist = [], contextDist = [], typeDist = [], topGenes = [], chrDist = [];
      try { tissueDist = JSON.parse(row.tissue_dist || '[]'); } catch (e) {}
      try { contextDist = JSON.parse(row.context_dist || '[]'); } catch (e) {}
      try { typeDist = JSON.parse(row.type_dist || '[]'); } catch (e) {}
      try { topGenes = JSON.parse(row.gene_dist || '[]'); } catch (e) {}
      try { chrDist = JSON.parse(row.chr_dist || '[]'); } catch (e) {}

      const result = {
        stats: {
          totalPeaks: row.total_peaks,
          tissues: tissueDist.length,
        },
        distribution: contextDist,
        tissues: tissueDist,
        typeDist,
        topGenes,
        chrDist,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (err) {
       console.error(err);
       res.writeHead(500, { 'Content-Type': 'application/json' });
       res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }
  
  // 5. GET /api/download �? export only columns that have data for this species
  if (parsedUrl.pathname === '/api/download' && req.method === 'GET') {
    const { species } = parsedUrl.query;
    if (!species) { res.writeHead(400); res.end("Species required"); return; }

    try {
      const connection = await promisePool.getConnection();

      // 1) Build reverse map: db_col_name �? display name
      const REVERSE_MAP = {};
      for (const [display, db] of Object.entries(COLUMN_MAP)) {
        REVERSE_MAP[db] = display;
      }

      // 2) Ordered list of preferred display headers (same order as DataViewer)
      const PREFERRED_ORDER = [
        'species',
        'Peak_ID', 'Position', 'tissue', 'nearest gene', 'ToTSS', 'type',
        'Genomic_context_of_peak', 'Summit', 'PAM-position', 'expression in expVIP',
        'JBrowse_Link', 'nearest gene_expression/TPM', 'nearest_H3K9ac_peak', 'FootPrint'
      ];

      // 3) Use cached column list (much faster than SHOW COLUMNS)
      const allDbCols = cachedColumnNames.filter(f => f !== 'id');

      // Check which columns actually hold data for this species (sample up to 1000 rows)
      const [sampleRows] = await connection.query(
        `SELECT ${allDbCols.map(c => `\`${c}\``).join(',')} FROM ${ACTIVE_TABLE} WHERE species = ? LIMIT 1000`,
        [species]
      );

      // Determine non-empty columns
      const nonEmptyDbCols = allDbCols.filter(col => {
        return sampleRows.some(row => {
          const v = row[col];
          return v !== null && v !== undefined && v !== '';
        });
      });

      // 4) Build ordered header list: preferred first, then extra cols
      const orderedDisplayHeaders = [];
      const orderedDbCols = [];

      for (const display of PREFERRED_ORDER) {
        const dbCol = COLUMN_MAP[display];
        if (dbCol && nonEmptyDbCols.includes(dbCol)) {
          orderedDisplayHeaders.push(display);
          orderedDbCols.push(dbCol);
        }
      }

      // Append any extra columns not in the preferred list
      for (const dbCol of nonEmptyDbCols) {
        if (!orderedDbCols.includes(dbCol)) {
          orderedDisplayHeaders.push(REVERSE_MAP[dbCol] || dbCol);
          orderedDbCols.push(dbCol);
        }
      }

      console.log(`📥 Download [${species}]: ${orderedDbCols.length} columns (${allDbCols.length} total, filtered ${allDbCols.length - nonEmptyDbCols.length} empty)`);

      // 5) Stream response
      const safeFilename = `${species.replace(/[^a-zA-Z0-9]/g, '_')}_data.tsv`;
      res.writeHead(200, {
        'Content-Type': 'text/tab-separated-values',
        'Content-Disposition': `attachment; filename="${safeFilename}"`
      });

      // Write header row with display names
      res.write(orderedDisplayHeaders.join('\t') + '\n');

      // Stream data rows (only relevant columns, in correct order)
      const query = `SELECT ${orderedDbCols.map(c => `\`${c}\``).join(',')} FROM ${ACTIVE_TABLE} WHERE species = ?`;
      const stream = connection.connection.query(query, [species]).stream();

      stream.on('data', (row) => {
        const values = orderedDbCols.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
        });
        res.write(values.join('\t') + '\n');
      });

      stream.on('end', () => { res.end(); connection.release(); });
      stream.on('error', (err) => { console.error(err); res.end(); connection.release(); });

    } catch (err) {
      console.error(err);
      res.writeHead(500); res.end("Server Error");
    }
    return;
  }

  // 5b. POST /api/refresh-stats — rebuild summary table after bulk import
  //       Optional ?species=X rebuilds just one species (much faster than a full rebuild)
  if (parsedUrl.pathname === '/api/refresh-stats' && req.method === 'POST') {
    try {
      const targetSpecies = parsedUrl.query.species;
      if (targetSpecies) {
        console.log(`📊 Targeted stats rebuild for: ${targetSpecies}`);
        await refreshSpeciesStats(targetSpecies);
      } else {
        await rebuildAllStats();
      }
      // clearCache forces /api/dashboard to re-read species_stats on next request
      clearCache();
      invalidateDataCaches();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: targetSpecies ? `Stats rebuilt for ${targetSpecies}` : 'Stats rebuilt and cache cleared' }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // 6. GET /api/peaks
  if (parsedUrl.pathname === '/api/peaks' && req.method === 'GET') {
    const { page = 1, limit = 15, q = '', species, tissue, chr } = parsedUrl.query;

    // Whole-response cache (60s), keyed by the full query string
    const peaksCacheKey = `peaks|page=${page}|limit=${limit}|q=${q}|species=${species || ''}|tissue=${tissue || ''}|chr=${chr || ''}`;
    const cachedResp = queryCacheGet(peaksCacheKey);
    if (cachedResp) {
      console.log(`   /api/peaks cache hit (${peaksCacheKey})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...cachedResp, meta: { ...cachedResp.meta, tookMs: 0 } }));
      return;
    }

    try {
      // Build column list from COLUMN_MAP (display columns only, skip LONGTEXT blobs)
      const displayCols = [...new Set(Object.values(COLUMN_MAP))].filter(c => cachedColumnNames.includes(c));
      if (!displayCols.includes('id')) displayCols.unshift('id');
      const selectClause = `SELECT \`${displayCols.join('`, `')}\``;

      // Use cached column list (populated at startup, refreshed after uploads)
      const dbFields = cachedColumnNames;

      let query = `${selectClause} FROM ${ACTIVE_TABLE}`;
      let countQuery;
      let conditions = [];
      let params = [];

      const hasSpeciesFilter = species && species !== 'All Species';
      if (hasSpeciesFilter) {
         conditions.push(`\`species\` = ?`);
         params.push(species);
      }

      const tissueDB = getDBCol('tissue');
      const hasTissueFilter = tissue && tissue !== 'All Tissues' && dbFields.includes(tissueDB);
      if (hasTissueFilter) {
         conditions.push(`\`${tissueDB}\` = ?`);
         params.push(tissue);
      }

      const posDB = getDBCol('Position');
      const hasChrFilter = chr && chr !== 'All Chromosomes' && dbFields.includes(posDB);
      if (hasChrFilter) {
         conditions.push(`\`${posDB}\` LIKE ?`);
         params.push(`${chr}:%`);
      }

      const hasSearch = q && q.trim();
      if (hasSearch) {
        const searchTerm = q.trim();
        const orParts = [];

        // Prefer FULLTEXT boolean search when both columns are indexed and every
        // term is >= 3 chars; otherwise fall back to the original LIKE '%q%' scan.
        const ftQuery = (fulltextCols.has('peak_id') && fulltextCols.has('nearest_gene'))
          ? buildFulltextQuery(searchTerm)
          : null;

        if (ftQuery) {
          orParts.push('(MATCH(`peak_id`) AGAINST (? IN BOOLEAN MODE) OR MATCH(`nearest_gene`) AGAINST (? IN BOOLEAN MODE))');
          params.push(ftQuery, ftQuery);
        } else if (/^[A-Za-z0-9_.:\-]+$/.test(searchTerm)) {
          // ID-style query (peak_id / gene id / positional string, single term):
          // prefix LIKE turns into an index range scan (idx_peak_id,
          // idx_species_gene, idx_position) — milliseconds instead of a
          // leading-wildcard full-table scan.
          const p = `${searchTerm}%`;
          const PREFIX_COLS = ['peak_id', 'nearest_gene', 'position'];
          const prefixCols = PREFIX_COLS.filter(f => dbFields.includes(f));
          if (prefixCols.length > 0) {
              orParts.push(`(${prefixCols.map(col => `\`${col}\` LIKE ?`).join(' OR ')})`);
              prefixCols.forEach(() => params.push(p));
          }
        } else {
          const p = `%${searchTerm}%`;
          const SEARCH_COLS = ['peak_id', 'nearest_gene', 'position', 'tissue'];
          const searchableCols = SEARCH_COLS.filter(f => dbFields.includes(f));
          if (searchableCols.length > 0) {
              orParts.push(`(${searchableCols.map(col => `\`${col}\` LIKE ?`).join(' OR ')})`);
              searchableCols.forEach(() => params.push(p));
          }
        }

        // Positional queries like "chr1:1000-2000" additionally try a position
        // prefix match (can use idx_position, unlike the leading-wildcard LIKE)
        if (searchTerm.includes(':') && dbFields.includes(posDB)) {
          orParts.push(`\`${posDB}\` LIKE ?`);
          params.push(`${searchTerm}%`);
        }

        if (orParts.length > 0) conditions.push(`(${orParts.join(' OR ')})`);
      }

      const hasFilters = conditions.length > 0;

      let where = '';
      if (hasFilters) {
        where = " WHERE " + conditions.join(" AND ");
        query += where;
        countQuery = `SELECT COUNT(*) as total FROM ${ACTIVE_TABLE}` + where;
      } else {
        // No filters: get total count from summary table (instant, avoids full scan of 20GB table)
        countQuery = null;
      }

      const limitNum = parseInt(limit) || 15;
      const offset = ((parseInt(page) || 1) - 1) * limitNum;

      const t0 = Date.now();

      let total;
      if (hasFilters) {
        // COUNT cache (5 min) — keyed by where clause + params, so paging
        // through results doesn't recompute the total on every request
        const countCacheKey = `count|${where}|${JSON.stringify(params)}`;
        const cachedTotal = queryCacheGet(countCacheKey);
        if (cachedTotal !== null) {
          total = cachedTotal;
          console.log(`   COUNT cache hit`);
        } else {
          // Fast path: pre-aggregated counts from species_stats (single-dimension
          // filters only; returns null for anything it can't answer exactly)
          const fast = await getFastCount({ species, tissue, chr, q });
          if (fast !== null) {
            total = fast;
            queryCachePut(countCacheKey, total, 5 * 60 * 1000);
            console.log(`   FAST COUNT via species_stats: ${total} (${Date.now() - t0}ms)`);
          } else {
            const [countRows] = await promisePool.query(countQuery, params);
            total = countRows[0].total;
            queryCachePut(countCacheKey, total, 5 * 60 * 1000);
            console.log(`   COUNT took ${Date.now() - t0}ms`);
          }
        }
      } else {
        try {
          const [sumRows] = await promisePool.query(`SELECT SUM(total_peaks) as total FROM species_stats`);
          total = sumRows[0].total || 0;
        } catch (e) {
          total = 0;
        }
      }

      const t1 = Date.now();
      // Use query() not execute() — LIMIT/OFFSET as direct values (safe, they're integers).
      // ORDER BY primary key: deterministic pagination (no row jumping/duplicates
      // between pages); with idx_species / idx_species_id the sort is free.
      const finalQuery = query + ` ORDER BY \`id\` LIMIT ${limitNum} OFFSET ${offset}`;
      const [rows] = await promisePool.query(finalQuery, params);
      console.log(`   SELECT took ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`);

      const body = {
        data: rows,
        meta: {
          total,
          page: parseInt(page),
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
          tookMs: Date.now() - t0
        }
      };
      queryCachePut(peaksCacheKey, body, 60 * 1000);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));

    } catch (error) {
      console.error(error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // 6b. GET /api/suggest — autocomplete suggestions for peak_id / nearest_gene
  if (parsedUrl.pathname === '/api/suggest' && req.method === 'GET') {
    const { q = '', species } = parsedUrl.query;
    const term = (q || '').trim();

    if (term.length < 2) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ peakIds: [], genes: [] }));
      return;
    }

    const suggestCacheKey = `suggest|q=${term}|species=${species || ''}`;
    const cachedSuggest = queryCacheGet(suggestCacheKey);
    if (cachedSuggest) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cachedSuggest));
      return;
    }

    try {
      const hasSpeciesFilter = species && species !== 'All Species';
      const speciesClause = hasSpeciesFilter ? ' AND `species` = ?' : '';

      // Up to 8 distinct values from one column. FULLTEXT (ranked by relevance)
      // when the column is indexed, otherwise a prefix LIKE that can use the B-Tree index.
      // Returns [] when the column doesn't exist — never errors out the whole route.
      const fetchDistinct = async (col) => {
        if (!cachedColumnNames.includes(col)) return [];
        const params = [];
        let sql;
        const ftQuery = fulltextCols.has(col) ? buildFulltextQuery(term) : null;
        if (ftQuery) {
          sql = `SELECT \`${col}\` AS val, MAX(MATCH(\`${col}\`) AGAINST (? IN BOOLEAN MODE)) AS score
                 FROM ${ACTIVE_TABLE}
                 WHERE MATCH(\`${col}\`) AGAINST (? IN BOOLEAN MODE)${speciesClause}
                 GROUP BY \`${col}\` ORDER BY score DESC LIMIT 8`;
          params.push(ftQuery, ftQuery);
        } else {
          sql = `SELECT DISTINCT \`${col}\` AS val FROM ${ACTIVE_TABLE}
                 WHERE \`${col}\` LIKE ?${speciesClause} LIMIT 8`;
          params.push(`${term}%`);
        }
        if (hasSpeciesFilter) params.push(species);
        const [rows] = await promisePool.query(sql, params);
        return rows.map(r => r.val).filter(v => v !== null && v !== '');
      };

      const [peakIds, genes] = await Promise.all([
        fetchDistinct('peak_id'),
        fetchDistinct('nearest_gene'),
      ]);

      const body = { peakIds, genes };
      queryCachePut(suggestCacheKey, body, 60 * 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // 6c. GET /api/chromosomes — list chromosomes from genome FASTA index
  if (parsedUrl.pathname === '/api/chromosomes' && req.method === 'GET') {
    const species = parsedUrl.query.species;
    const fastaPath = GENOME_CONFIG[species];
    if (!species || !fastaPath) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    try {
      const chroms = getChromosomes(fastaPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chroms));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // 7. POST /api/predict
  if (parsedUrl.pathname === '/api/predict' && req.method === 'POST') {
    // Rate limit: max 5 requests per 10 minutes per IP
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (isPredictRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded, please try later' }));
      return;
    }

    let body = '';
    let bodySize = 0;
    const MAX_BODY = 1 * 1024 * 1024; // 1MB — a sequence plus metadata is far below this
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        console.error("Predict request body too large:", bodySize);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Request too large. Maximum 1MB." }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('error', () => { /* socket destroyed after 413 — nothing to do */ });
    req.on('end', async () => {
      try {
        const { species, sequence, chr, start, end } = JSON.parse(body);

        // Species must be one of the server-configured whitelist keys (it selects
        // the model path used in a shell command, so raw user input is rejected).
        if (!species || !PREDICT_SPECIES_WHITELIST.has(species)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown species' }));
          return;
        }

        // Determine the sequence: either provided directly or extracted from genome
        let finalSequence = sequence;
        if (!finalSequence && chr && start && end) {
          const fastaPath = GENOME_CONFIG[species];
          if (!fastaPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `No genome configured for ${species}. Please paste the sequence directly.` }));
            return;
          }
          try {
            finalSequence = extractSequence(fastaPath, chr, parseInt(start), parseInt(end));
            console.log(`Extracted ${finalSequence.length}bp from ${species} ${chr}:${start}-${end}`);
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Sequence extraction failed: ${err.message}` }));
            return;
          }
        }

        if (!species || !finalSequence) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Missing parameters. Provide either 'sequence' or 'chr'+'start'+'end'." }));
          return;
        }

        const timestamp = Date.now();
        const seqFilePath = path.join('/data2/analysis', `temp_seq_${timestamp}.txt`);
        const imagePath = path.join('/data2/analysis', `temp_heatmap_${timestamp}.png`);
        const scriptPath = path.join('/data2/analysis', 'ism_predict.py');

        // Model path comes only from the whitelist-derived map — user input is never
        // concatenated into the shell command string.
        const modelPath = PREDICT_MODEL_PATHS[species];

        // Write sequence to temp file (avoids command-line length limits)
        fs.writeFileSync(seqFilePath, finalSequence);

        // Build command with optional FIMO motif annotation
        let command = `conda run -n wheat_ism python ${scriptPath} --model_path "${modelPath}" --seq_file "${seqFilePath}" --output_img "${imagePath}" --fimo_cmd "conda run -n meme fimo"`;
        if (MOTIF_DB_CONFIG[species] && fs.existsSync(MOTIF_DB_CONFIG[species])) {
          command += ` --motif_db "${MOTIF_DB_CONFIG[species]}" --max_motifs ${FIMO_MAX_MOTIFS} --p_value ${FIMO_P_VALUE} --motif_color "${FIMO_MOTIF_COLOR}"`;
        }

        exec(command, { cwd: '/data2/analysis' }, (error, stdout, stderr) => {
          // Clean up temp files
          if (fs.existsSync(seqFilePath)) fs.unlinkSync(seqFilePath);

          if (error) {
            console.error("Python Script Error:", error);
            console.error("Stderr:", stderr);
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "Analysis failed. Please check server logs." }));
            return;
          }

          const output = stdout + '\n' + stderr;
          console.log("Python Output:", output);
          const scoreMatch = output.match(/Original score\s*:\s*([-\d.eE]+)/i);
          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
          console.log("Extracted Score:", score);
          const classification = score >= 0.5 ? 'Open Chromatin' : 'Closed Chromatin';

          let heatmapBase64 = null;
          if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            heatmapBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
            fs.unlinkSync(imagePath);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ score, classification, heatmapBase64 }));
        });

      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // 8. POST /api/upload (FLEXIBLE UPLOAD �? per-batch commit for large files)
  if (parsedUrl.pathname === '/api/upload' && req.method === 'POST') {
    const targetSpecies = parsedUrl.query.species || 'Unknown';

    // Increase body size limit: read up to 200MB
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 200 * 1024 * 1024; // 200MB
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        console.error("Request body too large:", bodySize);
        res.writeHead(413);
        res.end(JSON.stringify({ error: "File too large. Maximum 200MB." }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      try {
        console.log(`📥 Received ${(bodySize / 1024 / 1024).toFixed(1)} MB for species: ${targetSpecies}`);
        const parseStart = Date.now();
        const { headers, rows } = parseData(body);
        console.log(`📊 Parsed ${rows.length} rows with ${headers.length} columns in ${Date.now() - parseStart}ms`);

        if (rows.length === 0) throw new Error("No data found in uploaded file");

        console.time("Upload Total");
        const connection = await promisePool.getConnection();

        try {
          // 1. Check & add missing columns
          const [existingCols] = await connection.query(`SHOW COLUMNS FROM ${ACTIVE_TABLE}`);
          const existingColNames = existingCols.map(c => c.Field.toLowerCase());

          const headerMap = {};
          const missingColumns = [];

          for (const h of headers) {
             const dbName = sanitizeColumnName(h);
             headerMap[h] = dbName;

             if (!existingColNames.includes(dbName.toLowerCase())) {
                 missingColumns.push(dbName);
             }
          }

          if (missingColumns.length > 0) {
             console.log(`🛠 Adding ${missingColumns.length} new columns:`, missingColumns);
             for (const newCol of missingColumns) {
                 await connection.query(`ALTER TABLE ${ACTIVE_TABLE} ADD COLUMN \`${newCol}\` LONGTEXT`);
             }
          }

          // Build a max-length map for existing VARCHAR columns
          const colMaxLen = {};
          for (const col of existingCols) {
              const type = col.Type.toLowerCase();
              const match = type.match(/varchar\((\d+)\)/);
              if (match) {
                  colMaxLen[col.Field.toLowerCase()] = parseInt(match[1]);
              }
          }

          // 1b. Pre-scan: find VARCHAR columns that need upgrading to LONGTEXT
          // Get indexed columns — skip them (can't ALTER indexed columns to LONGTEXT)
          const [indexInfo] = await connection.query(`SHOW INDEX FROM ${ACTIVE_TABLE}`);
          const indexedCols = new Set(indexInfo.map(r => r.Column_name));

          const colsToUpgrade = new Set();
          for (const row of rows) {
              for (const h of headers) {
                  const dbName = headerMap[h];
                  const maxLen = colMaxLen[dbName.toLowerCase()];
                  if (!maxLen) continue; // not a VARCHAR column, skip
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
                  console.log(`⚠️  Skipping ${toSkip.length} indexed column(s): ${toSkip.join(', ')} (values will be truncated to fit)`);
              }
              for (const colName of toUpgrade) {
                  console.log(`  - Upgrading '${colName}' from VARCHAR(${colMaxLen[colName.toLowerCase()]}) to LONGTEXT...`);
                  await connection.query(`ALTER TABLE ${ACTIVE_TABLE} MODIFY COLUMN \`${colName}\` LONGTEXT`);
                  delete colMaxLen[colName.toLowerCase()];
              }
          }

          // 2. Prepare column mapping
          const BATCH_SIZE = 500; // Smaller batches = more reliable for large files

          let insertCols = [...new Set(Object.values(headerMap))];
          if (!insertCols.includes('species')) insertCols.push('species');

          const sqlCols = insertCols.map(c => `\`${c}\``).join(',');
          const placeholders = `(${insertCols.map(() => '?').join(',')})`;

          // 3. Insert in batches, commit each batch (no giant transaction)
          let totalInserted = 0;
          const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batchRows = rows.slice(i, i + BATCH_SIZE);
            const batchValues = [];
            const batchPlaceholders = [];

            for (const row of batchRows) {
               const rowData = [];
               insertCols.forEach(colName => {
                   if (colName === 'species') {
                       rowData.push(targetSpecies);
                       return;
                   }
                   const fileHeader = Object.keys(headerMap).find(k => headerMap[k] === colName);
                   const fileIndex = headers.indexOf(fileHeader);

                   let val = (fileIndex !== -1) ? row[fileIndex] : null;
                   // Truncate if value exceeds its VARCHAR column limit
                   if (val != null && typeof val === 'string') {
                       const maxLen = colMaxLen[colName.toLowerCase()];
                       if (maxLen && val.length > maxLen) {
                           val = val.substring(0, maxLen);
                       }
                   }
                   rowData.push(val);
               });

               batchValues.push(...rowData);
               batchPlaceholders.push(placeholders);
            }

            if (batchValues.length > 0) {
               const sql = `INSERT INTO ${ACTIVE_TABLE} (${sqlCols}) VALUES ${batchPlaceholders.join(',')}`;
               await connection.query(sql, batchValues);
               totalInserted += batchRows.length;
            }

            // Log progress every 20 batches
            if (batchNum % 20 === 0 || batchNum === totalBatches) {
              console.log(`  📦 Batch ${batchNum}/${totalBatches} �? ${totalInserted.toLocaleString()}/${rows.length} rows`);
            }
          }

          console.timeEnd("Upload Total");
          console.log(`✅ Uploaded ${totalInserted.toLocaleString()} rows for ${targetSpecies}.`);

          // Refresh column cache, summary stats, and API cache
          await refreshColumnCache();
          await refreshSpeciesStats(targetSpecies);
          clearCache();
          invalidateDataCaches();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            count: totalInserted,
            species: targetSpecies,
            columns: insertCols.length
          }));

        } catch (err) {
          console.error("SQL Error:", err.message);
          console.error("Full error:", err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        } finally {
          connection.release();
        }
      } catch (e) {
        console.error("Parse Error:", e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid Data Format: " + e.message }));
      }
    });
    req.on('error', (err) => {
      console.error("Request error:", err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Upload interrupted" }));
    });
    return;
  }

  // 9. DELETE (POST only)
  if (parsedUrl.pathname === '/api/delete' && req.method === 'POST') {
      const targetSpecies = parsedUrl.query.species;
      if (!targetSpecies) { res.writeHead(400); res.end(JSON.stringify({error: "Missing species"})); return; }
      try {
        await promisePool.query(`DELETE FROM ${ACTIVE_TABLE} WHERE species = ?`, [targetSpecies]);
        await promisePool.query(`DELETE FROM species_stats WHERE species = ?`, [targetSpecies]);
        await refreshColumnCache();
        clearCache();
        invalidateDataCaches();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return;
  }

  // Serve static files from build/ (production frontend)
  const buildDir = path.join(__dirname, 'build');
  let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const fullPath = path.join(buildDir, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(buildDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };
  const ext = path.extname(fullPath);

  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(fullPath));
    } else {
      // SPA fallback: serve index.html for unknown routes
      const indexPath = path.join(buildDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  } catch (e) {
    res.writeHead(500);
    res.end("Server Error");
  }
});

async function prewarmCache() {
  // Always check for gaps in species_stats, even if disk cache was loaded
  console.log('🔍 Checking stats completeness...');

  try {
    const [allSpeciesRows] = await promisePool.query(
      `SELECT DISTINCT species FROM ${ACTIVE_TABLE} WHERE species IS NOT NULL AND species != ''`
    );
    const allSpecies = allSpeciesRows.map(r => r.species);
    const [existingRows] = await promisePool.query(`SELECT species, type_dist, context_dist, chr_dist FROM species_stats`);
    const existingSet = new Set(existingRows.map(r => r.species));
    const missingSpecies = allSpecies.filter(s => !existingSet.has(s));

    // Per-row staleness check: a stats row whose distributions are NULL/'[]'
    // (e.g. an earlier refresh was interrupted) must be rebuilt — checking
    // only LIMIT 1 previously let broken rows (e.g. wheat) slip through.
    const isEmptyDist = (v) => !v || v === '[]';
    const staleSpecies = existingRows
      .filter(r =>
        (cachedColumnNames.includes('type') && isEmptyDist(r.type_dist)) ||
        (cachedColumnNames.includes(getDBCol('Genomic_context_of_peak')) && isEmptyDist(r.context_dist)) ||
        (cachedColumnNames.includes('position') && isEmptyDist(r.chr_dist))
      )
      .map(r => r.species);

    const rebuildTargets = [...missingSpecies, ...staleSpecies];

    if (existingSet.size === 0) {
      console.log(`   📊 Summary table empty, building stats for all ${allSpecies.length} species...`);
    } else if (rebuildTargets.length > 0) {
      console.log(`   📊 Rebuilding stats for ${rebuildTargets.length} species (${missingSpecies.length} missing, ${staleSpecies.length} stale): ${rebuildTargets.join(', ')}`);
    } else {
      console.log(`   ✅ All ${existingSet.size} species complete.`);
    }

    // Build species one by one (saves progress after each)
    let done = 0;
    for (const sp of rebuildTargets) {
      console.log(`   [${++done}/${rebuildTargets.length}] ${sp}...`);
      await refreshSpeciesStats(sp);
      // Save progress incrementally (all fields now populated by refreshSpeciesStats)
      const [dashRows] = await promisePool.query(
        `SELECT total_peaks, tissue_dist, context_dist, type_dist, gene_dist, chr_dist FROM species_stats WHERE species = ?`, [sp]
      );
      if (dashRows.length > 0) {
        const row = dashRows[0];
        let td = [], cd = [], yd = [], gd = [], hd = [];
        try { td = JSON.parse(row.tissue_dist || '[]'); } catch (e) {}
        try { cd = JSON.parse(row.context_dist || '[]'); } catch (e) {}
        try { yd = JSON.parse(row.type_dist || '[]'); } catch (e) {}
        try { gd = JSON.parse(row.gene_dist || '[]'); } catch (e) {}
        try { hd = JSON.parse(row.chr_dist || '[]'); } catch (e) {}
        setCache(`dash_${sp}`, {
          stats: { totalPeaks: row.total_peaks, tissues: td.length },
          distribution: cd, tissues: td,
          typeDist: yd, topGenes: gd, chrDist: hd,
        });
      }
      const doneList = [];
      for (const [k] of cache) {
        if (k.startsWith('dash_')) doneList.push(k.replace('dash_', ''));
      }
      setCache('species_list', doneList.sort());
    }

    // 2. Load remaining species from summary table into cache (instant)
    const [rows] = await promisePool.query(`SELECT species FROM species_stats ORDER BY species`);
    const speciesList = rows.map(r => r.species);
    setCache('species_list', speciesList);

    for (const sp of speciesList) {
      if (getCached(`dash_${sp}`)) continue;
      const [dashRows] = await promisePool.query(
        `SELECT total_peaks, tissue_dist, context_dist, type_dist, gene_dist, chr_dist FROM species_stats WHERE species = ?`, [sp]
      );
      if (dashRows.length > 0) {
        const row = dashRows[0];
        let td = [], cd = [], yd = [], gd = [], hd = [];
        try { td = JSON.parse(row.tissue_dist || '[]'); } catch (e) {}
        try { cd = JSON.parse(row.context_dist || '[]'); } catch (e) {}
        try { yd = JSON.parse(row.type_dist || '[]'); } catch (e) {}
        try { gd = JSON.parse(row.gene_dist || '[]'); } catch (e) {}
        try { hd = JSON.parse(row.chr_dist || '[]'); } catch (e) {}
        setCache(`dash_${sp}`, {
          stats: { totalPeaks: row.total_peaks, tissues: td.length },
          distribution: cd, tissues: td,
          typeDist: yd, topGenes: gd, chrDist: hd,
        });
      }
    }
    console.log(`   ✅ dashboards (${speciesList.length} species)`);

    // 3. Load stats from summary table (instant)
    const [allRows] = await promisePool.query(`SELECT species, total_peaks as count, updated_at as updatedAt FROM species_stats ORDER BY species`);
    const totalPeaks = allRows.reduce((sum, r) => sum + r.count, 0);
    setCache('stats', {
      totalPeaks,
      speciesCount: allRows.length,
      breakdown: allRows
    });
    console.log('   ✅ stats');
  } catch (e) {
    console.log('   ⚠️ Pre-warm partial failure:', e.message);
  }
  console.log('✅ Cache pre-warmed.');
}

initializeDatabase().then(async () => {
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🚀 Backend Server running at http://0.0.0.0:${PORT}/`);
    // Pre-warm cache in background after server is already listening
    prewarmCache();
  });
});