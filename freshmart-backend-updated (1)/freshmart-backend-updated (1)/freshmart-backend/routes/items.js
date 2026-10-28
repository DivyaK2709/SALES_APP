// routes/items.js
//
// Called by the MOBILE APP (JWT auth, not the sync key — see middleware/auth.js)
// to search PItemMaster and change an item's prices from the phone.
//
// IMPORTANT: uniqueCode always comes from the logged-in user's JWT
// (req.user.uniqueCode), never from the request body/query, so one store's
// manager can never search or edit another store's items just by changing
// a request parameter.
//
// NOTE ON DEADLOCKS: /sync/items runs very frequently (pushed by the
// sync-agent) and upserts PItemMaster via MERGE, which takes row/page
// locks. A concurrent SELECT from /items/search can occasionally be
// chosen as a "deadlock victim" (SQL error 1205) and get killed. We:
//   1. Read PItemMaster WITH (NOLOCK) in /search so it doesn't queue up
//      behind writer locks or get picked as a victim in the first place.
//   2. Wrap both DB calls in a small retry helper that automatically
//      re-runs the operation if it still gets killed as a deadlock victim.
// The real fix is reducing how often/hard /sync/items writes (see
// routes/sync.js comments) — this is a resilience layer on top of that.

const express = require('express');
const { sql, getPool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const SQL_DEADLOCK_VICTIM = 1205;

// Retries fn() if it fails specifically because this request was chosen as
// a deadlock victim (SQL error 1205). Any other error is re-thrown
// immediately. `retries` is the number of EXTRA attempts after the first.
async function withDeadlockRetry(fn, retries = 2, delayMs = 150) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const isDeadlock = err && err.number === SQL_DEADLOCK_VICTIM;
      if (isDeadlock && attempt < retries) {
        attempt++;
        console.warn(`Deadlock victim, retrying (${attempt}/${retries})...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt)); // small backoff
        continue;
      }
      throw err;
    }
  }
}

// GET /items/search?q=<barcode or partial name>
// Returns up to 20 matches for THIS user's store, ordered so an exact
// barcode hit always comes first.
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const uniqueCode = req.user.uniqueCode;

  if (!q) {
    return res.status(400).json({ error: 'q (barcode or item name) is required' });
  }
  if (!uniqueCode) {
    return res.status(400).json({ error: 'No store code on this account — please log in again' });
  }

  try {
    const pool = await getPool();
    const result = await withDeadlockRetry(() =>
      pool
        .request()
        .input('UniqueCode', sql.VarChar(50), uniqueCode)
        .input('ExactBarcode', sql.VarChar(100), q)
        .input('NameLike', sql.VarChar(200), `%${q}%`)
        .query(`
          SELECT TOP 20
            Id, Name, Barcode, SellingPrice, CostPrice, mrp,
            CASE WHEN Barcode = @ExactBarcode THEN 0 ELSE 1 END AS SortRank
          FROM dbo.PItemMaster WITH (NOLOCK)
          WHERE UniqueCode = @UniqueCode
            AND (Barcode = @ExactBarcode OR Name LIKE @NameLike)
          ORDER BY SortRank ASC, Name ASC
        `)
    );

    res.json({ items: result.recordset });
  } catch (err) {
    console.error('GET /items/search error:', err);
    res.status(500).json({ error: 'Failed to search items', detail: err.message });
  }
});

// PUT /items/price
// Body: { barcode, sellingPrice, costPrice, mrp }
//
// Updates the cloud copy of PItemMaster immediately (so reports/other
// screens reflect it right away), AND drops a row into
// PPriceChangeQueue so each store's on-prem sync-agent can pick it up and
// apply the same change to that store's LOCAL SQL Server on its next run
// (typically within ~5 minutes — see sync-agent/sync.js).
router.put('/price', async (req, res) => {
  const { barcode, sellingPrice, costPrice, mrp } = req.body || {};
  const uniqueCode = req.user.uniqueCode;
  const changedBy = req.user.username || null;

  if (!barcode) {
    return res.status(400).json({ error: 'barcode is required' });
  }
  if (!uniqueCode) {
    return res.status(400).json({ error: 'No store code on this account — please log in again' });
  }
  if (sellingPrice == null && costPrice == null && mrp == null) {
    return res.status(400).json({ error: 'At least one of sellingPrice, costPrice, mrp is required' });
  }
  for (const [label, val] of [['sellingPrice', sellingPrice], ['costPrice', costPrice], ['mrp', mrp]]) {
    if (val != null && (typeof val !== 'number' || isNaN(val) || val < 0)) {
      return res.status(400).json({ error: `${label} must be a non-negative number` });
    }
  }

  const pool = await getPool();

  const runPriceUpdate = async () => {
    // mssql Transaction so the PItemMaster update and the queue insert
    // either both happen or neither does — we never want a state where the
    // cloud price changed but no store ever gets told about it, or vice versa.
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const itemResult = await new sql.Request(tx)
        .input('UniqueCode', sql.VarChar(50), uniqueCode)
        .input('Barcode', sql.VarChar(100), barcode)
        .query(`SELECT Id, Name FROM dbo.PItemMaster WHERE UniqueCode = @UniqueCode AND Barcode = @Barcode`);

      const item = itemResult.recordset[0];
      if (!item) {
        await tx.rollback();
        return { notFound: true };
      }

      await new sql.Request(tx)
        .input('UniqueCode', sql.VarChar(50), uniqueCode)
        .input('Barcode', sql.VarChar(100), barcode)
        .input('SellingPrice', sql.Money, sellingPrice)
        .input('CostPrice', sql.Money, costPrice)
        .input('MRP', sql.Money, mrp)
        .query(`
          UPDATE dbo.PItemMaster
          SET
            SellingPrice = COALESCE(@SellingPrice, SellingPrice),
            CostPrice    = COALESCE(@CostPrice, CostPrice),
            mrp          = COALESCE(@MRP, mrp)
          WHERE UniqueCode = @UniqueCode AND Barcode = @Barcode
        `);

      await new sql.Request(tx)
        .input('UniqueCode', sql.VarChar(50), uniqueCode)
        .input('Barcode', sql.VarChar(100), barcode)
        .input('ItemName', sql.VarChar(150), item.Name)
        .input('SellingPrice', sql.Money, sellingPrice)
        .input('CostPrice', sql.Money, costPrice)
        .input('MRP', sql.Money, mrp)
        .input('ChangedBy', sql.VarChar(100), changedBy)
        .query(`
          INSERT INTO dbo.PPriceChangeQueue
            (UniqueCode, Barcode, ItemName, SellingPrice, CostPrice, MRP, ChangedBy)
          VALUES
            (@UniqueCode, @Barcode, @ItemName, @SellingPrice, @CostPrice, @MRP, @ChangedBy)
        `);

      await tx.commit();
      return { notFound: false, itemName: item.Name };
    } catch (err) {
      try { await tx.rollback(); } catch (_) { /* already rolled back / connection gone */ }
      throw err;
    }
  };

  try {
    const result = await withDeadlockRetry(runPriceUpdate);
    if (result.notFound) {
      return res.status(404).json({ error: `No item with barcode ${barcode} found for your store` });
    }
    res.json({ success: true, barcode, itemName: result.itemName });
  } catch (err) {
    console.error('PUT /items/price error:', err);
    res.status(500).json({ error: 'Failed to update item price', detail: err.message });
  }
});

module.exports = router;