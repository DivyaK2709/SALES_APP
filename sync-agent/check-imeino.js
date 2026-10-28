// check-imeino.js
//
// One-time diagnostic: finds which pending PBackSalesDetails row(s) have a
// bad `imeino` value (too long for VarChar(50), or a non-string type) that
// is causing the TDS "Data type 0xA7 has an invalid data length" error when
// pushing to the cloud.
//
// Run with:  node check-imeino.js
// Uses the same .env as sync.js (same folder), so no extra setup needed.

require('dotenv').config();
const sql = require('mssql');
const { loadState } = require('./state');

const STORE_CODE = parseInt(process.env.STORE_CODE, 10);

const localDbConfig = {
  server: process.env.LOCAL_DB_SERVER || 'localhost',
  database: process.env.LOCAL_DB_DATABASE,
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASSWORD,
  options: {
    encrypt: process.env.LOCAL_DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.LOCAL_DB_TRUST_SERVER_CERT === 'true',
    ...(process.env.LOCAL_DB_INSTANCE ? { instanceName: process.env.LOCAL_DB_INSTANCE } : {}),
  },
};
if (process.env.LOCAL_DB_PORT) {
  localDbConfig.port = parseInt(process.env.LOCAL_DB_PORT, 10);
  delete localDbConfig.options.instanceName;
}

async function main() {
  const state = loadState();
  const since = state.lastSyncedInvNo['PBackSalesDetails'] || 0;

  console.log(`Checking dbo.PBackSalesDetails rows with InvNo > ${since} for store CCode=${STORE_CODE}...\n`);

  const pool = await sql.connect(localDbConfig);

  // Local column definition for imeino (so we know the real declared length,
  // which may differ from the cloud's VarChar(50)).
  const colInfo = await pool.request().query(`
    SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PBackSalesDetails' AND COLUMN_NAME = 'imeino'
  `);
  console.log('Local imeino column definition:', colInfo.recordset[0] || '(not found)');
  console.log('Cloud imeino column is declared as VarChar(50) in routes/sync.js.\n');

  const result = await pool
    .request()
    .input('sinceValue', sql.Float, since)
    .input('ccode', sql.Int, STORE_CODE)
    .query(`
      SELECT InvNo, SlNo, imeino, LEN(imeino) AS imeinoLen
      FROM dbo.PBackSalesDetails
      WHERE CCode = @ccode AND InvNo > @sinceValue
      ORDER BY InvNo ASC
    `);

  const rows = result.recordset;
  console.log(`Found ${rows.length} pending row(s). Flagging anything with imeino longer than 50 chars,`);
  console.log(`or a non-null/non-string-looking value:\n`);

  let flagged = 0;
  for (const r of rows) {
    const val = r.imeino;
    const len = r.imeinoLen;
    if (val !== null && (len > 50 || typeof val !== 'string')) {
      flagged++;
      console.log(`⚠️  InvNo=${r.InvNo} SlNo=${r.SlNo}  imeino=${JSON.stringify(val)}  length=${len}`);
    }
  }

  if (flagged === 0) {
    console.log('No row exceeded 50 chars or looked like a bad type.');
    console.log('Printing all non-null imeino values instead, so we can eyeball them:\n');
    for (const r of rows) {
      if (r.imeino !== null) {
        console.log(`  InvNo=${r.InvNo} SlNo=${r.SlNo}  imeino=${JSON.stringify(r.imeino)}  length=${r.imeinoLen}`);
      }
    }
  } else {
    console.log(`\n${flagged} row(s) flagged above — these are almost certainly what's breaking the push.`);
  }

  await pool.close();
}

main().catch((err) => {
  console.error('❌ Check failed:', err.message);
  process.exit(1);
});
