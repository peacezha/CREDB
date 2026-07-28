/**
 * One-time backfill: per-species tissue×chromosome cross distribution
 * (species_stats.tissue_chr_dist) for every species.
 *
 * Why: /api/peaks with species+tissue+chr filters needed a real COUNT(*) over
 * the 20GB main table (~8.5s). With this column populated, getFastCount answers
 * the 3-dimension combo from species_stats in milliseconds.
 *
 * JSON shape: { "chr1A": { "Spike": 12345, "leaf": 678 }, "chr1B": {...} }
 *
 * Usage:
 *   node scripts/backfill_tissue_chr.js            # all species
 *   node scripts/backfill_tissue_chr.js "Triticum" # names containing a substring
 *   nohup node scripts/backfill_tissue_chr.js > tissue_chr.log 2>&1 &
 *
 * Safe to stop and re-run: only the final per-species write persists, so a
 * re-run simply recomputes. Reads DB credentials from .env (same as server.js).
 */
require('dotenv').config();
const mysql = require('mysql2');

if (!process.env.DB_PASSWORD) {
  console.error('Missing DB_PASSWORD. Create a .env file (see .env.example) or set it in the environment.');
  process.exit(1);
}

const filter = process.argv[2];

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
  const [tables] = await pool.query('SHOW TABLES');
  const names = tables.map((t) => Object.values(t)[0]);
  const TABLE = names.includes('cis_elements') ? 'cis_elements' : 'peaks';

  // Make sure the column exists (server.js adds it at startup too)
  try {
    await pool.query(`ALTER TABLE species_stats ADD COLUMN \`tissue_chr_dist\` LONGTEXT`);
  } catch (e) {
    /* already exists */
  }

  const [cols] = await pool.query(`SHOW COLUMNS FROM ${TABLE}`);
  const colNames = cols.map((c) => c.Field);
  if (!colNames.includes('tissue') || !colNames.includes('position')) {
    console.error('❌ tissue/position column missing on ' + TABLE + ' — cannot compute tissue_chr_dist.');
    process.exit(1);
  }

  // Manual skip-scan over the ordered (species, position) index (from
  // scripts/refresh_species.js) — used only when a species has no chr_dist yet.
  // GROUP BY SUBSTRING_INDEX(position) can't use the prefix index as covering
  // and never finishes on this box.
  const computeChrDist = async (species) => {
    const [idxRows] = await pool.query(`SHOW INDEX FROM ${TABLE}`);
    const forceIdx = idxRows.some((r) => r.Key_name === 'idx_species_position')
      ? ' FORCE INDEX (idx_species_position)'
      : '';
    const dist = [];
    let cursor = '';
    for (let guard = 0; guard < 10000; guard++) {
      const [rows] = await pool.query(
        `SELECT \`position\` as p FROM ${TABLE}${forceIdx}
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
      cursor = `${chr}:~~`; // '~' (0x7E) sorts after any digit — next row belongs to the next chromosome
    }
    dist.sort((a, b) => a.label.length - b.label.length || (a.label < b.label ? -1 : 1));
    return dist;
  };

  let [speciesRows] = await pool.query(
    `SELECT DISTINCT species FROM ${TABLE} WHERE species IS NOT NULL AND species != '' ORDER BY species`
  );
  if (filter) speciesRows = speciesRows.filter((r) => r.species.includes(filter));
  console.log(`Table: ${TABLE} — ${speciesRows.length} species to backfill\n`);

  let done = 0;
  for (const { species } of speciesRows) {
    const t0 = Date.now();
    console.log(`[${++done}/${speciesRows.length}] ${species}`);

    // Chromosome list: prefer the existing (complete) chr_dist; if empty,
    // compute it via skip-scan and persist it first.
    let chrLabels = [];
    const [statRows] = await pool.query(`SELECT chr_dist FROM species_stats WHERE species = ?`, [species]);
    try {
      chrLabels = JSON.parse((statRows[0] && statRows[0].chr_dist) || '[]')
        .map((d) => d && d.label)
        .filter(Boolean);
    } catch (e) {
      /* malformed JSON → recompute below */
    }
    if (chrLabels.length === 0) {
      console.log(`   chr_dist empty — computing via skip-scan first...`);
      const dist = await computeChrDist(species);
      await pool.query(
        `INSERT INTO species_stats (species, chr_dist, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE chr_dist = VALUES(chr_dist), updated_at = VALUES(updated_at)`,
        [species, JSON.stringify(dist), Date.now()]
      );
      chrLabels = dist.map((d) => d.label);
      console.log(`   chr_dist: ${chrLabels.length} chromosomes`);
    }

    // One GROUP BY tissue per chromosome — each is an index range scan on
    // idx_species_position, never a table-wide scan.
    const cross = {};
    for (const chr of chrLabels) {
      const c0 = Date.now();
      const [rows] = await pool.query(
        `SELECT \`tissue\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`tissue\` IS NOT NULL AND \`position\` LIKE ? GROUP BY \`tissue\``,
        [species, `${chr}:%`]
      );
      if (rows.length > 0) {
        cross[chr] = {};
        for (const r of rows) cross[chr][r.label || 'Unknown'] = r.count;
      }
      console.log(`   ${chr}: ${rows.length} tissues (${((Date.now() - c0) / 1000).toFixed(1)}s)`);
    }

    await pool.query(
      `INSERT INTO species_stats (species, tissue_chr_dist, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE tissue_chr_dist = VALUES(tissue_chr_dist), updated_at = VALUES(updated_at)`,
      [species, JSON.stringify(cross), Date.now()]
    );
    console.log(`   ✅ ${Object.keys(cross).length} chrs written (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  console.log('\n✅ All tissue_chr_dist backfilled.');
  process.exit(0);
};

run().catch((e) => {
  console.error('\n❌ Failed:', e.message);
  console.error('Progress so far was persisted — re-run to continue.');
  process.exit(1);
});
