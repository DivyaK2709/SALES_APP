// diagnose-master-keys.js
//
// READ-ONLY. Run this against the CLOUD database before we touch any
// primary keys. It shows, for each master table:
//   1. The current primary key constraint name + column(s)
//   2. Any foreign keys (in either direction) touching that PK — we need
//      to know about these before dropping/rebuilding the PK, or we could
//      break referential integrity or fail partway through.
//   3. Every existing row (Id/Barcode, Name, UniqueCode) — so we can see
//      exactly what's colliding, e.g. confirm whether Id=1 really is a
//      leftover "COSMETICS" row with UniqueCode still NULL.
//
// Run with:  node diagnose-master-keys.js
// Then paste the full output back.

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
    console.log(`════════ dbo.${table} ════════`);

    const tableExists = await pool.request().query(`
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}'
    `);
    if (tableExists.recordset.length === 0) {
      console.log('  (table not found on cloud DB)\n');
      continue;
    }

    // 1. Primary key constraint name + column(s)
    const pk = await pool.request().query(`
      SELECT kc.name AS ConstraintName, c.name AS ColumnName
      FROM sys.key_constraints kc
      JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID('dbo.${table}')
      ORDER BY ic.key_ordinal
    `);
    if (pk.recordset.length === 0) {
      console.log('  Primary key: (none found)');
    } else {
      const cols = pk.recordset.map((r) => r.ColumnName).join(', ');
      console.log(`  Primary key: ${pk.recordset[0].ConstraintName} ON (${cols})`);
    }

    // 2. Foreign keys referencing this table's PK, or that this table has
    //    pointing at other tables
    const fkOut = await pool.request().query(`
      SELECT fk.name AS FkName, OBJECT_NAME(fk.parent_object_id) AS FromTable,
             OBJECT_NAME(fk.referenced_object_id) AS ToTable
      FROM sys.foreign_keys fk
      WHERE fk.referenced_object_id = OBJECT_ID('dbo.${table}')
         OR fk.parent_object_id = OBJECT_ID('dbo.${table}')
    `);
    if (fkOut.recordset.length === 0) {
      console.log('  Foreign keys: (none)');
    } else {
      fkOut.recordset.forEach((r) => console.log(`  FK: ${r.FkName}  (${r.FromTable} -> ${r.ToTable})`));
    }

    // 3. Row count + a sample, grouped by UniqueCode, so we can see
    //    how much legacy/orphan (NULL UniqueCode) data is in there
    const grouped = await pool.request().query(`
      SELECT ISNULL(UniqueCode, '(NULL)') AS UniqueCode, COUNT(*) AS Cnt
      FROM dbo.${table}
      GROUP BY UniqueCode
      ORDER BY Cnt DESC
    `);
    console.log('  Row counts by UniqueCode:');
    grouped.recordset.forEach((r) => console.log(`    ${r.UniqueCode}: ${r.Cnt}`));

    // Sample of the actual colliding rows (first few by whatever the
    // natural key column is)
    const idCol = table === 'PItemMaster' ? 'Barcode' : 'Id';
    const sample = await pool.request().query(`
      SELECT TOP 10 ${idCol}, Name, UniqueCode
      FROM dbo.${table}
      ORDER BY ${idCol}
    `);
    console.log(`  Sample rows (top 10 by ${idCol}):`);
    sample.recordset.forEach((r) => console.log(`    ${idCol}=${r[idCol]}  Name=${r.Name}  UniqueCode=${r.UniqueCode}`));

    console.log('');
  }

  await pool.close();
  console.log('Done. Paste the full output back so we can safely rebuild the keys.');
}

main().catch((err) => {
  console.error('❌ Diagnostic failed:', err.message);
  process.exit(1);
});
