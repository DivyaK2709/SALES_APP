// inspect-trigger.js
//
// READ-ONLY. The MERGE against PItemMaster is failing because of an
// existing trigger, trg_sync_pitemmaster, that references a database
// called 'taj' which this connection can't see. Before deciding whether
// to disable/drop/fix it, let's see what it actually does — it may be
// live production logic feeding another system, not just leftover cruft.
//
// Run with:  node inspect-trigger.js

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

  // 1. List every trigger on PItemMaster (there may be more than one)
  const triggers = await pool.request().query(`
    SELECT tr.name AS TriggerName, tr.is_disabled,
           OBJECT_DEFINITION(tr.object_id) AS Definition
    FROM sys.triggers tr
    WHERE tr.parent_id = OBJECT_ID('dbo.PItemMaster')
  `);

  if (triggers.recordset.length === 0) {
    console.log('No triggers found on PItemMaster (unexpected given the error — check manually).');
  } else {
    triggers.recordset.forEach((t) => {
      console.log(`---- Trigger: ${t.TriggerName}  (disabled=${t.is_disabled}) ----`);
      console.log(t.Definition);
      console.log('');
    });
  }

  // 2. Does the 'taj' database even exist on this server?
  const dbCheck = await pool.request().query(`
    SELECT name FROM sys.databases WHERE name = 'taj'
  `);
  console.log(dbCheck.recordset.length > 0
    ? "'taj' database EXISTS on this server (likely a permissions issue for the 'sa' login's current context, or cross-db is disabled)."
    : "'taj' database does NOT exist on this server at all.");

  await pool.close();
  console.log('\nDone. Paste the full output back.');
}

main().catch((err) => {
  console.error('? Failed:', err.message);
  process.exit(1);
});