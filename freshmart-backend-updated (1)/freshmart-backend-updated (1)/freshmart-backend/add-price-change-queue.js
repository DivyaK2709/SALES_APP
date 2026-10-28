// add-price-change-queue.js
//
// ONE-TIME migration. Creates the queue table the item-price-change feature
// uses to hand price updates from the cloud (set from the mobile app) down
// to each store's local SQL Server (applied by sync-agent).
//
// Run once, from the freshmart-backend folder (needs the same .env it
// already uses to connect to the cloud DB):
//   node add-price-change-queue.js

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

  console.log(`Connecting to ${config.server}/${config.database} ...`);
  const pool = await sql.connect(config);

  const exists = await pool.request().query(`
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PPriceChangeQueue'
  `);

  if (exists.recordset.length > 0) {
    console.log('✅ dbo.PPriceChangeQueue already exists — nothing to do.');
  } else {
    console.log('⏳ Creating dbo.PPriceChangeQueue ...');
    await pool.request().query(`
      CREATE TABLE dbo.PPriceChangeQueue (
        Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
        UniqueCode    VARCHAR(50)   NOT NULL,  -- which store this change belongs to
        Barcode       VARCHAR(100)  NOT NULL,  -- match key used on BOTH cloud and local PItemMaster
        ItemName      VARCHAR(150)  NULL,      -- denormalized, just for a human-readable audit trail
        SellingPrice  MONEY         NULL,
        CostPrice     MONEY         NULL,
        MRP           MONEY         NULL,
        ChangedBy     VARCHAR(100)  NULL,      -- username from the JWT, for audit
        ChangedAt     DATETIME      NOT NULL DEFAULT GETDATE()
      );
    `);
    // The agent polls "give me everything with Id > my last-seen Id, for
    // MY store" — this index makes that lookup fast instead of a scan,
    // same reasoning as IX_PItemMaster_UniqueCode_Id in config/db.js.
    await pool.request().query(`
      CREATE NONCLUSTERED INDEX IX_PPriceChangeQueue_UniqueCode_Id
      ON dbo.PPriceChangeQueue (UniqueCode, Id);
    `);
    console.log('✅ dbo.PPriceChangeQueue created, with its lookup index.');
  }

  await pool.close();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
