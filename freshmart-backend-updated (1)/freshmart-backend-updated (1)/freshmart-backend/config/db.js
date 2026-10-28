// config/db.js
// Single shared connection pool to your SQL Server instance.
require('dotenv').config();
const sql = require('mssql');

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
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    // Not set before: with no cap, a request waiting for a pooled
    // connection (e.g. because an earlier request's connection got stuck
    // and never released) would just wait silently - no error, nothing in
    // the logs - until the CLIENT eventually gives up at 120s with a bare
    // "timeout of 120000ms exceeded" and no clue why. Failing fast here
    // instead turns that into a clear, loggable error.
    acquireTimeoutMillis: 20000,
  },
  // IMPORTANT: this is a single shared pool used by EVERY route, so this
  // value has to accommodate the slowest legitimate query in the app, not
  // just the average one.
  //
  // This was previously lowered to 30000ms to "fail fast" - but that is
  // actually what was CAUSING the PItemMaster sync failures (ECONNRESET /
  // "timeout of 120000ms exceeded" on the very first batch), not
  // preventing them:
  //
  //   1. sync-agent posts 25 PItemMaster rows per request, with its own
  //      120000ms axios timeout (see sync-agent/sync.js
  //      MASTER_PUSH_TIMEOUT_MS).
  //   2. The cloud PItemMaster table has the known-slow 'itemorderloc'
  //      trigger (see routes/sync.js and
  //      inspect-itemorderloc-trigger.js), which can legitimately make
  //      even a 25-row MERGE take well over 30 seconds once the table has
  //      tens of thousands of rows.
  //   3. At requestTimeout=30000, mssql kills that MERGE as a timeout
  //      before it ever finishes. utils/upsert.js's catch then falls back
  //      to retrying the same 25 rows ONE ROW AT A TIME - and EACH of
  //      those individual queries is ALSO killed at 30000ms if it's slow,
  //      so the row-by-row fallback alone can burn 25 x 30s = well over
  //      10 minutes for a single incoming HTTP request.
  //   4. Long before that finishes, the sync-agent's own 120000ms axios
  //      timeout fires and aborts the connection - which is exactly the
  //      ECONNRESET / "timeout of 120000ms exceeded" being seen, and why
  //      it happens on the very FIRST batch (no "...25/23094" line is
  //      ever printed - the request never got a response to log against).
  //
  // Raised to 100000ms: comfortably enough for a legitimately slow
  // PItemMaster batch to actually finish and respond, while staying under
  // the sync-agent's 120000ms client-side timeout (~20s of headroom for
  // network + JSON parsing on both ends). This buys headroom - it does
  // NOT make the itemorderloc trigger itself fast. Pair this with actually
  // fixing/disabling that trigger (see inspect-itemorderloc-trigger.js)
  // and with sync.js's skip-when-unchanged fix, which stops PItemMaster
  // from being pushed at all on runs where nothing changed.
  requestTimeout: 100000,
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(async (pool) => {
        console.log('✅ Connected to SQL Server:', process.env.DB_SERVER);

        // PItemMaster has had no key/index on (UniqueCode, Id) since the PK
        // was dropped during the multi-tenant migration (see
        // fix-item-pk-retry.js) - every MERGE against it full-scans the
        // whole table, which is what's causing sync to hang/timeout on that
        // table. Create it here, once, before any request can run, instead
        // of depending on someone remembering to run a separate script.
        // Non-unique (plain index, not a constraint) so it can never fail
        // due to duplicate data - pure speed, no risk to existing rows.
        try {
          const check = await pool.request().query(`
            SELECT 1 FROM sys.indexes
            WHERE object_id = OBJECT_ID('dbo.PItemMaster') AND name = 'IX_PItemMaster_UniqueCode_Id'
          `);
          if (check.recordset.length === 0) {
            console.log('⏳ PItemMaster is missing its (UniqueCode, Id) index - creating it now (one-time, may take ~30-60s)...');
            await pool.request().query(`
              CREATE NONCLUSTERED INDEX IX_PItemMaster_UniqueCode_Id
              ON dbo.PItemMaster (UniqueCode, Id)
            `);
            console.log('✅ IX_PItemMaster_UniqueCode_Id created.');
          }
        } catch (idxErr) {
          console.error('⚠️  Could not verify/create PItemMaster index (continuing without it):', idxErr.message);
        }

        return pool;
      })
      .catch((err) => {
        console.error('❌ SQL Server connection failed:', err.message);
        poolPromise = null; // allow retry on next request
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };