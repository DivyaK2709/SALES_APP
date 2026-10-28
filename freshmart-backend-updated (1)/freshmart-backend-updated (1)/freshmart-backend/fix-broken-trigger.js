// fix-broken-trigger.js
//
// trg_sync_pitemmaster references a database ('taj') that does not exist
// on this server at all — confirmed via inspect-trigger.js. It is dead,
// unfixable boilerplate left over from provisioning this database from a
// different client's template (it even targets 'yadavem..pitemmaster' in
// its own ON clause, another unrelated install). It will fail on every
// single INSERT into PItemMaster forever, not just during sync — so it
// needs to go regardless of the sync work.
//
// This script:
//   1. Checks whether dbo.pitemorderloc exists (the table the OTHER
//      trigger, itemorderloc, depends on) so we know up front whether
//      that one is going to be the next blocker.
//   2. Prints trg_sync_pitemmaster's definition once more for the record.
//   3. Drops trg_sync_pitemmaster.
//   4. Leaves itemorderloc alone — untouched unless step 1 shows it's
//      also broken.
//
// Run with:  node fix-broken-trigger.js

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

  // 1. Does pitemorderloc exist? (dependency of the OTHER trigger)
  const tableCheck = await pool.request().query(`
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'pitemorderloc'
  `);
  if (tableCheck.recordset.length > 0) {
    console.log("? dbo.pitemorderloc exists — the 'itemorderloc' trigger should be fine, leaving it as-is.\n");
  } else {
    console.log("??  dbo.pitemorderloc does NOT exist — the 'itemorderloc' trigger will fail the same way once");
    console.log("    trg_sync_pitemmaster is out of the way. Not touching it yet — if sync fails on this next,");
    console.log("    that confirms it and we'll drop that one too.\n");
  }

  // 2. Confirm + print definition once more before dropping (for the record)
  const trig = await pool.request().query(`
    SELECT OBJECT_DEFINITION(object_id) AS Definition
    FROM sys.triggers WHERE name = 'trg_sync_pitemmaster' AND parent_id = OBJECT_ID('dbo.PItemMaster')
  `);
  if (trig.recordset.length === 0) {
    console.log('trg_sync_pitemmaster not found — already removed?');
    await pool.close();
    return;
  }
  console.log('Dropping this trigger (references nonexistent database "taj"):');
  console.log(trig.recordset[0].Definition);

  // 3. Drop it
  await pool.request().query(`DROP TRIGGER dbo.trg_sync_pitemmaster`);
  console.log('\n? trg_sync_pitemmaster dropped.');

  await pool.close();
  console.log('\nDone. Re-run sync.js now.');
}

main().catch((err) => {
  console.error('? Failed:', err.message);
  process.exit(1);
});