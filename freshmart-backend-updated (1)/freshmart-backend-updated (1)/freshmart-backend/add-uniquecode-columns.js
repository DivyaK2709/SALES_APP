// add-uniquecode-columns.js
//
// One-time migration: adds a UniqueCode column to the cloud master tables
// that routes/sync.js's new /departments, /categories, /first-categories,
// and /items endpoints need. Run this ONCE against the CLOUD database
// (same connection this API server uses, via .env) before running
// sync-agent with the updated sync.js.
//
// Safe to run more than once — it checks INFORMATION_SCHEMA first and
// skips any table that already has the column.
//
// Run with:  node add-uniquecode-columns.js

require('dotenv').config();
const sql = require('mssql');

const TABLES = ['PDepartmentMaster', 'PCategoryMaster', 'PFirstCategoryMaster', 'PItemMaster'];

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
    const check = await pool.request().query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'UniqueCode'
    `);

    if (check.recordset.length > 0) {
      console.log(`  ${table}: UniqueCode already exists — skipping.`);
      continue;
    }

    const tableCheck = await pool.request().query(`
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}'
    `);
    if (tableCheck.recordset.length === 0) {
      console.log(`  ${table}: table not found on cloud DB — skipping (it'll be created on first sync? check the name).`);
      continue;
    }

    console.log(`  ${table}: adding UniqueCode column...`);
    await pool.request().query(`ALTER TABLE dbo.${table} ADD UniqueCode VARCHAR(50) NULL`);
    console.log(`  ${table}: done.`);
  }

  await pool.close();
  console.log('\nMigration complete. You can now re-run sync-agent.');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
