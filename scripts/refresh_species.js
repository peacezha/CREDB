/**
 * Offline per-species stats rebuilder — decoupled from the web server.
 *
 * Use when the in-app rebuild keeps getting starved/interrupted on a busy or
 * memory-tight box. Runs the same GROUP BY computations as the server's
 * refreshSpeciesStats and persists each distribution immediately, so it can
 * be stopped and re-run safely (already-written dists survive).
 *
 * Usage:
 *   node scripts/refresh_species.js "Triticum aestivum"
 *   nohup node scripts/refresh_species.js "Triticum aestivum" > wheat_stats.log 2>&1 &
 *
 * Reads DB credentials from .env (same variables as server.js).
 */
require('dotenv').config();
const mysql = require('mysql2');

const species = process.argv[2];
// Optional step filter: node scripts/refresh_species.js "Triticum aestivum" chr
// Valid steps: count, context, type, gene, chr. Default: all.
const VALID_STEPS = ['count', 'context', 'type', 'gene', 'chr'];
const stepArgs = process.argv.slice(3).map((s) => s.toLowerCase());
const onlySteps = stepArgs.length > 0 ? new Set(stepArgs.filter((s) => VALID_STEPS.includes(s))) : null;
if (stepArgs.length > 0 && (!onlySteps || onlySteps.size === 0)) {
  console.error(`Unknown step(s): ${stepArgs.join(', ')}. Valid: ${VALID_STEPS.join(', ')}`);
  process.exit(1);
}
const shouldRun = (step) => !onlySteps || onlySteps.has(step);

if (!species) {
  console.error('Usage: node scripts/refresh_species.js "<species name>" [count] [context] [type] [gene] [chr]');
  process.exit(1);
}

if (!process.env.DB_PASSWORD) {
  console.error('Missing DB_PASSWORD. Create a .env file (see .env.example) or set it in the environment.');
  process.exit(1);
}

const pool = mysql
  .createPool({
    host: process.env.DB_HOST || '211.69.142.213',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'ATAC_web',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'atac_web',
    waitForConnections: true,
    connectionLimit: 2,
  })
  .promise();

const run = async () => {
  // Detect the active table, mirroring server.js logic
  const [tables] = await pool.query('SHOW TABLES');
  const names = tables.map((t) => Object.values(t)[0]);
  const TABLE = names.includes('cis_elements') ? 'cis_elements' : 'peaks';
  console.log(`Table: ${TABLE}`);
  console.log(`Species: ${species}\n`);

  const [cols] = await pool.query(`SHOW COLUMNS FROM ${TABLE}`);
  const colNames = cols.map((c) => c.Field);

  const persist = async (field, value) => {
    await pool.query(`UPDATE species_stats SET \`${field}\` = ?, updated_at = ? WHERE species = ?`, [
      value,
      Date.now(),
      species,
    ]);
  };

  const timed = async (label, fn) => {
    const t0 = Date.now();
    const out = await fn();
    console.log(`${label} done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return out;
  };

  // 1. total + tissue
  if (shouldRun('count')) {
    const [[countRows], [tissueRows]] = await timed('COUNT + tissue', () =>
      Promise.all([
        pool.query(`SELECT COUNT(*) as total FROM ${TABLE} WHERE species = ?`, [species]),
        pool.query(
          `SELECT \`tissue\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`tissue\` IS NOT NULL GROUP BY \`tissue\` ORDER BY count DESC`,
          [species]
        ),
      ])
    );
    const total = countRows[0].total;
    const tissueDist = tissueRows.map((r) => ({ label: r.label || 'Unknown', count: r.count }));
    console.log(`   ${total.toLocaleString()} peaks, ${tissueDist.length} tissues`);
    await pool.query(
      `INSERT INTO species_stats (species, total_peaks, tissue_dist, context_dist, updated_at)
       VALUES (?, ?, ?, '[]', ?)
       ON DUPLICATE KEY UPDATE total_peaks = VALUES(total_peaks), tissue_dist = VALUES(tissue_dist), updated_at = VALUES(updated_at)`,
      [species, total, JSON.stringify(tissueDist), Date.now()]
    );
  }

  // 2. genomic context (slow)
  if (shouldRun('context') && colNames.includes('genomic_context')) {
    const [rows] = await timed('context GROUP BY (slow)', () =>
      pool.query(
        `SELECT \`genomic_context\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`genomic_context\` IS NOT NULL GROUP BY \`genomic_context\` ORDER BY count DESC`,
        [species]
      )
    );
    await persist('context_dist', JSON.stringify(rows.map((r) => ({ label: r.label || 'Unknown', value: r.count }))));
    console.log(`   ${rows.length} categories`);
  }

  // 3. type / gene / chr — each persisted right after its query
  // NOTE: a prefix index (position(100)) can NOT be a covering index in MySQL,
  // so grouping SUBSTRING_INDEX(position) over millions of rows means full row
  // lookups — on this box it never finishes. Instead, chrDist uses a manual
  // skip-scan over the ordered (species, position) index: locate the first
  // position of each chromosome with a point query (`position > 'chrX:~'`),
  // then COUNT each chromosome with an index-only prefix LIKE. A handful of
  // chromosomes = a handful of fast queries instead of a full table scan.
  const computeChrDist = async () => {
    const dist = [];
    let cursor = '';
    for (let guard = 0; guard < 10000; guard++) {
      const [rows] = await pool.query(
        `SELECT \`position\` as p FROM ${TABLE} FORCE INDEX (idx_species_position)
         WHERE species = ? AND \`position\` > ? AND \`position\` LIKE '%:%'
         ORDER BY \`position\` LIMIT 1`,
        [species, cursor]
      );
      if (rows.length === 0) break;
      const chr = rows[0].p.split(':')[0];
      const [cnt] = await pool.query(
        `SELECT COUNT(*) as c FROM ${TABLE} WHERE species = ? AND \`position\` LIKE ?`,
        [species, `${chr}:%`]
      );
      dist.push({ label: chr, count: cnt[0].c });
      console.log(`   ${chr}: ${cnt[0].c.toLocaleString()}`);
      cursor = `${chr}:~~`; // '~' (0x7E) sorts after any digit, so the next row belongs to the next chromosome
    }
    // Match the GROUP BY ordering used elsewhere: by label length then label
    dist.sort((a, b) => a.label.length - b.label.length || (a.label < b.label ? -1 : 1));
    return dist;
  };

  const stats = [
    {
      step: 'type',
      field: 'type_dist',
      col: 'type',
      sql: `SELECT \`type\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`type\` IS NOT NULL AND \`type\` != '' GROUP BY \`type\` ORDER BY count DESC LIMIT 15`,
    },
    {
      step: 'gene',
      field: 'gene_dist',
      col: 'nearest_gene',
      sql: `SELECT \`nearest_gene\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`nearest_gene\` IS NOT NULL AND \`nearest_gene\` != '' GROUP BY \`nearest_gene\` ORDER BY count DESC LIMIT 15`,
    },
    {
      step: 'chr',
      field: 'chr_dist',
      col: 'position',
      compute: computeChrDist,
    },
  ];

  for (const s of stats) {
    if (!shouldRun(s.step) || !colNames.includes(s.col)) continue;
    if (s.compute) {
      const t0 = Date.now();
      const dist = await s.compute();
      console.log(`${s.field} done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      await persist(s.field, JSON.stringify(dist));
      console.log(`   ${dist.length} rows`);
      continue;
    }
    const [rows] = await timed(`${s.field}`, () => pool.query(s.sql, [species]));
    await persist(s.field, JSON.stringify(rows.map((r) => ({ label: r.label, count: r.count }))));
    console.log(`   ${rows.length} rows`);
  }

  console.log('\n✅ Done. Restart the web server (or wait for cache TTL) to serve the fresh stats.');
  process.exit(0);
};

run().catch((e) => {
  console.error('\n❌ Failed:', e.message);
  console.error('Partial progress was persisted — re-run to continue.');
  process.exit(1);
});
