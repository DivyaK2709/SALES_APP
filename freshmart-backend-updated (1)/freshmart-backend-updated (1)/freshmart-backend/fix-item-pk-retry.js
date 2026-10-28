// fix-item-pk-retry.js
//
// PItemMaster currently has NO primary key — fix-master-keys-step3.js
// dropped the old one, then timed out (mssql's default 15s request
// timeout) while building the new composite index on ~19,369 rows.
// UniqueCode is already backfilled and NOT NULL (that step completed
// before the timeout), so this just retries the ADD CONSTRAINT with a
// much longer timeout.
//
// Run with:  node fix-item-pk-retry.js

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const config = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    requestTimeout: 120000, // 2 minutes, instead of mssql's 15s default
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
    },
  };

  console.log(`Connecting to ${config.server}:${config.port} / ${config.database} as ${config.user} ...`);
  const pool = await sql.connect(config);
  console.log('? Connected successfully.\n');

  // Confirm current state before touching anything
  const pk = await pool.request().query(`
    SELECT kc.name AS ConstraintName
    FROM sys.key_constraints kc
    WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID('dbo.PItemMaster')
  `);
  if (pk.recordset.length > 0) {
    console.log(`PItemMaster already has a PK (${pk.recordset[0].ConstraintName}) — nothing to do.`);
    await pool.close();
    return;
  }

  const nullCheck = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.PItemMaster WHERE UniqueCode IS NULL
  `);
  if (nullCheck.recordset[0].Cnt > 0) {
    console.log(`  ${nullCheck.recordset[0].Cnt} row(s) still have NULL UniqueCode — backfilling to '(LEGACY)'...`);
    await pool.request().query(`UPDATE dbo.PItemMaster SET UniqueCode = '(LEGACY)' WHERE UniqueCode IS NULL`);
  }

  console.log('  Adding composite PK on (UniqueCode, Id) — this may take a minute for ~19k rows...');
  await pool.request().query(`
    ALTER TABLE dbo.PItemMaster ADD CONSTRAINT PK_PItemMaster_UniqueCode_Id PRIMARY KEY (UniqueCode, Id)
  `);
  console.log('  PItemMaster: done.');

  await pool.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('? Failed:', err.message);
  process.exit(1);
});