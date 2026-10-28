// inspect-itemorderloc-trigger.js
//
// READ-ONLY. Your own comments (sync-agent/sync.js, routes/sync.js) say the
// 'itemorderloc' trigger on PItemMaster does a table scan on every
// single-row INSERT, and that it's the reason PItemMaster batches are
// slow. This script prints its actual definition + what it touches, so we
// can decide whether it's safe to optimize, temporarily disable during
// sync (see utils/upsert.js's disableTriggers option), or rewrite as a
// set-based operation - without guessing.
//
// Run with:  node inspect-itemorderloc-trigger.js

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const config = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    },
  };

  console.log(`Connecting to ${config.server}:${config.port} / ${config.database} as ${config.user} ...`);
  const pool = await sql.connect(config);
  console.log('? Connected successfully.\n');

  // 1. Every trigger currently on PItemMaster (not just itemorderloc —
  //    there was already one broken trigger found this way before).
  const triggers = await pool.request().query(`
    SELECT tr.name AS TriggerName, tr.is_disabled,
           OBJECT_DEFINITION(tr.object_id) AS Definition
    FROM sys.triggers tr
    WHERE tr.parent_id = OBJECT_ID('dbo.PItemMaster')
  `);

  if (triggers.recordset.length === 0) {
    console.log('No triggers found on PItemMaster.');
  } else {
    triggers.recordset.forEach((t) => {
      console.log(`==== Trigger: ${t.TriggerName}  (disabled=${t.is_disabled}) ====`);
      console.log(t.Definition);
      console.log('');
    });
  }

  // 2. Current row count — this is the number the trigger's cost scales
  //    with if it's doing a scan per row, so it explains why small
  //    stores (a few hundred items) never see this problem while a
  //    23,000+ row store does.
  const count = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.PItemMaster`);
  console.log(`dbo.PItemMaster currently has ${count.recordset[0].Cnt} row(s) total (across all stores).`);

  // 3. Does pitemorderloc (the table itemorderloc reads/writes) have any
  //    useful indexes, or is IT also being full-scanned?
  const tableExists = await pool.request().query(`
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'pitemorderloc'
  `);
  if (tableExists.recordset.length > 0) {
    const idxs = await pool.request().query(`
      SELECT i.name AS IndexName, i.type_desc AS IndexType,
             STRING_AGG(c.name, ', ') AS Columns
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID('dbo.pitemorderloc')
      GROUP BY i.name, i.type_desc
    `);
    console.log(`\ndbo.pitemorderloc indexes:`);
    if (idxs.recordset.length === 0) {
      console.log('  (none — a HEAP with no indexes; any lookup against it is a full scan)');
    } else {
      idxs.recordset.forEach((r) => console.log(`  ${r.IndexName} (${r.IndexType}) ON (${r.Columns})`));
    }
  } else {
    console.log(`\ndbo.pitemorderloc does not exist on this server.`);
  }

  await pool.close();
  console.log('\nDone. Paste the full output back so the trigger can be fixed/optimized safely (or a safe\ndisable window confirmed) instead of guessing at its contents.');
}

main().catch((err) => {
  console.error('? Failed:', err.message);
  process.exit(1);
});