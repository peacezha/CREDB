/**
 * One-time backfill: compute the COMPLETE tissue list (with counts) for every
 * species and persist it to species_stats (tissue_dist + tissue_complete=1).
 *
 * Why: stats rows built before the LIMIT-10 removal hold only top-10 tissues,
 * which made the web server recompute them in the background at every boot —
 * several heavy DISTINCT scans on the 20GB table starving all queries
 * ("restart storm"). After this backfill, the recompute never fires again.
 *
 * Usage:
 *   node scripts/backfill_tissues.js            # all species
 *   node scripts/backfill_tissues.js "Wheat"    # names containing a substring
 *   nohup node scripts/backfill_tissues.js > tissues.log 2>&1 &
 *
 * Reads DB credentials from .env (same variables as server.js).
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

  // Make sure the flag column exists (server.js adds it at startup too)
  try {
    await pool.query(`ALTER TABLE species_stats ADD COLUMN \`tissue_complete\` TINYINT DEFAULT 0`);
  } catch (e) {
    /* already exists */
  }

  let [speciesRows] = await pool.query(
    `SELECT DISTINCT species FROM ${TABLE} WHERE species IS NOT NULL AND species != '' ORDER BY species`
  );
  if (filter) speciesRows = speciesRows.filter((r) => r.species.includes(filter));
  console.log(`Table: ${TABLE} — ${speciesRows.length} species to backfill\n`);

  let done = 0;
  for (const { species } of speciesRows) {
    const t0 = Date.now();
    process.stdout.write(`[${++done}/${speciesRows.length}] ${species} ... `);
    const [rows] = await pool.query(
      `SELECT \`tissue\` as label, COUNT(*) as count FROM ${TABLE} WHERE species = ? AND \`tissue\` IS NOT NULL AND \`tissue\` != '' GROUP BY \`tissue\` ORDER BY count DESC`,
      [species]
    );
    const dist = rows.map((r) => ({ label: r.label || 'Unknown', count: r.count }));
    await pool.query(
      `INSERT INTO species_stats (species, tissue_dist, tissue_complete, updated_at)
       VALUES (?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE tissue_dist = VALUES(tissue_dist), tissue_complete = 1, updated_at = VALUES(updated_at)`,
      [species, JSON.stringify(dist), Date.now()]
    );
    console.log(`${dist.length} tissues (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  console.log('\n✅ All tissue lists backfilled and marked complete.');
  process.exit(0);
};

run().catch((e) => {
  console.error('\n❌ Failed:', e.message);
  console.error('Progress so far was persisted — re-run to continue.');
  process.exit(1);
});
