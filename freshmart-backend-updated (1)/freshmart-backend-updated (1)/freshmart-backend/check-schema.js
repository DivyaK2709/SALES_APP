// check-schema.js
//
// One-time helper: connects using your .env credentials and prints the
// real column names of the tables the API needs, so the SQL in
// routes/auth.js and routes/sales.js can be corrected to match exactly.
//
// Run with:  node check-schema.js
// Then paste the full output back so the queries can be finalized.

require('dotenv').config();
const sql = require('mssql');

const TABLES = [
  'AcUser', 'AcSales', 'AcSalesDetails', 'AcGroups', 'AcCompany',
  // Added to confirm real column lists for routes/sync.js placeholders —
  // run this against the LOCAL database (not the cloud one) and paste the
  // output back so PCATEGORY_MASTER_COLUMNS / PFIRSTCATEGORY_MASTER_COLUMNS /
  // PITEM_MASTER_COLUMNS in routes/sync.js can be filled in correctly.
  'PDepartmentMaster', 'PCategoryMaster', 'PFirstCategoryMaster', 'PItemMaster',
];

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
  console.log('✅ Connected successfully.\n');

  for (const table of TABLES) {
    console.log(`──── dbo.${table} ────`);
    try {
      const result = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}'
        ORDER BY ORDINAL_POSITION
      `);
      if (result.recordset.length === 0) {
        console.log('  (table not found — check the exact name in SSMS)');
      } else {
        result.recordset.forEach((r) => console.log(`  ${r.COLUMN_NAME}  (${r.DATA_TYPE})`));
      }
    } catch (err) {
      console.log('  Error reading columns:', err.message);
    }
    console.log('');
  }

  await pool.close();
  console.log('Done. Copy everything above and send it back to finish setting up the queries.');
}

main().catch((err) => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
});
