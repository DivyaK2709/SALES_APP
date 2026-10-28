// fix-master-keys-step3.js
//
// PART A — same treatment as step2 gave PDepartmentMaster/PCategoryMaster,
// now for PItemMaster: drop the single-column PK on Id, backfill legacy
// NULL UniqueCode rows to '(LEGACY)', make UniqueCode NOT NULL, add a
// composite PK on (UniqueCode, Id).
//
// PART B — pfirstcategory has NO UniqueCode column at all yet (confirmed
// via step2's schema dump). Add it, backfill existing rows to '(LEGACY)',
// make it NOT NULL, then rebuild its PK the same way.
//
// Run with:  node fix-master-keys-step3.js

require('dotenv').config();
const sql = require('mssql');

async function rebuildKey(pool, table) {
  console.log(`-- ${table} --`);
  try {
    const pk = await pool.request().query(`
      SELECT kc.name AS ConstraintName
      FROM sys.key_constraints kc
      WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID('dbo.${table}')
    `);
    if (pk.recordset.length > 0) {
      const pkName = pk.recordset[0].ConstraintName;
      console.log(`  Dropping existing PK: ${pkName}`);
      await pool.request().query(`ALTER TABLE dbo.${table} DROP CONSTRAINT ${pkName}`);
    } else {
      console.log('  No existing PK — skipping drop.');
    }

    await pool.request().query(`
      UPDATE dbo.${table} SET UniqueCode = '(LEGACY)' WHERE UniqueCode IS NULL
    `);
    await pool.request().query(`
      ALTER TABLE dbo.${table} ALTER COLUMN UniqueCode VARCHAR(50) NOT NULL
    `);

    console.log(`  Adding composite PK on (UniqueCode, Id)...`);
    await pool.request().query(`
      ALTER TABLE dbo.${table} ADD CONSTRAINT PK_${table}_UniqueCode_Id PRIMARY KEY (UniqueCode, Id)
    `);
    console.log(`  ${table}: done.\n`);
  } catch (err) {
    console.log(`  ? ${table} failed: ${err.message}\n`);
  }
}

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

  console.log('------ PART A: PItemMaster ------\n');
  await rebuildKey(pool, 'PItemMaster');

  console.log('------ PART B: pfirstcategory ------\n');
  console.log('-- pfirstcategory --');
  const hasCol = await pool.request().query(`
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'pfirstcategory' AND COLUMN_NAME = 'UniqueCode'
  `);
  if (hasCol.recordset.length === 0) {
    console.log('  Adding UniqueCode column (was missing entirely)...');
    await pool.request().query(`ALTER TABLE dbo.pfirstcategory ADD UniqueCode VARCHAR(50) NULL`);
  } else {
    console.log('  UniqueCode column already exists — skipping add.');
  }
  await rebuildKey(pool, 'pfirstcategory');

  await pool.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error('? Failed:', err.message);
  process.exit(1);
});