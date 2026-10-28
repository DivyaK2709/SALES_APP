// routes/sync.js
//
// Receives batches pushed by the local sync-agent and upserts them into the
// cloud database. Uses SQL MERGE keyed on (CCode, TransNo[, SLNo]) so
// re-sending the same batch twice (e.g. after a network retry) never creates
// duplicates — it just re-applies the same values.

const express = require('express');
const { sql, getPool } = require('../config/db');
const { requireSyncKey } = require('../middleware/syncAuth');
const { upsertRows } = require('../utils/upsert');

const router = express.Router();
router.use(requireSyncKey);

// -- Column definitions for the new P* tables --------------------------
// These mirror the local schema exactly (from INFORMATION_SCHEMA), minus
// UniqueCode, which upsertRows() adds automatically.

const PSALES_MASTER_COLUMNS = [
  { name: 'InvNo', type: sql.Float }, { name: 'InvDate', type: sql.DateTime },
  { name: 'InvTime', type: sql.DateTime }, { name: 'CounterId', type: sql.Int },
  { name: 'CashierId', type: sql.Int }, { name: 'CounterOpId', type: sql.BigInt },
  { name: 'TotAmount', type: sql.Money }, { name: 'TotCash', type: sql.Money },
  { name: 'TotCredit', type: sql.Money }, { name: 'TotCreditCard', type: sql.Money },
  { name: 'CreditCardNo', type: sql.VarChar(50) }, { name: 'TotAltCurrency', type: sql.Money },
  { name: 'AltCurrencyId', type: sql.Int }, { name: 'TransNo', type: sql.BigInt },
  { name: 'Discount', type: sql.Money }, { name: 'ConvRate', type: sql.Money },
  { name: 'AmountReceived', type: sql.Money }, { name: 'ExchangeRate', type: sql.Money },
  { name: 'HoldFlag', type: sql.Bit }, { name: 'SalesType', type: sql.Bit },
  { name: 'CustomerId', type: sql.Int }, { name: 'ResetNo', type: sql.Int },
  { name: 'CCode', type: sql.Int }, { name: 'Balance', type: sql.Money },
  { name: 'DayOpenId', type: sql.BigInt }, { name: 'TotalCredit', type: sql.Money },
  { name: 'CustomerCode', type: sql.BigInt }, { name: 'TotalGiftVoucher', type: sql.Money },
  { name: 'GiftVoucherNo', type: sql.VarChar(50) }, { name: 'NationalityCode', type: sql.BigInt },
  { name: 'AirMilesCardNo', type: sql.VarChar(50) }, { name: 'IssueOutType', type: sql.Int },
  { name: 'RefNo', type: sql.VarChar(50) }, { name: 'CreditPeriod', type: sql.BigInt },
  { name: 'Salesman', type: sql.VarChar(100) }, { name: 'STATUS', type: sql.BigInt },
  { name: 'ORDERNO', type: sql.BigInt }, { name: 'DELIVERY', type: sql.Int },
  { name: 'roundamt', type: sql.Money }, { name: 'crgpay', type: sql.Money },
  { name: 'crphonepay', type: sql.Money }, { name: 'creditcardnew', type: sql.Money },
  { name: 'id3', type: sql.BigInt },
];

const PSALES_DETAILS_COLUMNS = [
  { name: 'SlNo', type: sql.BigInt }, { name: 'InvNo', type: sql.BigInt },
  { name: 'Barcode', type: sql.VarChar(50) }, { name: 'Qty', type: sql.Float },
  { name: 'Unitid', type: sql.BigInt }, { name: 'Rate', type: sql.Money },
  { name: 'Discount', type: sql.Money }, { name: 'CCode', type: sql.Int },
  { name: 'PSlno', type: sql.Float }, { name: 'batchno', type: sql.Money },
  { name: 'COSTPRICE', type: sql.Money }, { name: 'itemname', type: sql.VarChar(200) },
  { name: 'gstp', type: sql.BigInt }, { name: 'batchnonew', type: sql.VarChar(50) },
  { name: 'expdate', type: sql.DateTime }, { name: 'itemslno', type: sql.VarChar(50) },
];

const PBACKSALES_MASTER_COLUMNS = [
  { name: 'InvNo', type: sql.BigInt }, { name: 'InvDate', type: sql.DateTime },
  { name: 'InvTime', type: sql.DateTime }, { name: 'BType', type: sql.Int },
  { name: 'CustomerId', type: sql.Int }, { name: 'CreditPeriod', type: sql.BigInt },
  { name: 'Discount', type: sql.Money }, { name: 'Freight', type: sql.Money },
  { name: 'Total', type: sql.Money }, { name: 'Remarks', type: sql.VarChar(200) },
  { name: 'CCode', type: sql.Int }, { name: 'TransNo', type: sql.BigInt },
  { name: 'refno', type: sql.VarChar(50) }, { name: 'salesmancode', type: sql.BigInt },
  { name: 'locid', type: sql.BigInt }, { name: 'DoNo', type: sql.NVarChar(50) },
  { name: 'totgst', type: sql.Money }, { name: 'customerref', type: sql.VarChar(100) },
  { name: 'customerref2', type: sql.VarChar(100) }, { name: 'customerref3', type: sql.VarChar(100) },
  { name: 'ROUNDOFF', type: sql.Float }, { name: 'groupid', type: sql.BigInt },
  { name: 'groupname', type: sql.VarChar(100) }, { name: 'vtype', type: sql.VarChar(50) },
  { name: 'vdes', type: sql.VarChar(100) }, { name: 'vnumber', type: sql.VarChar(50) },
  { name: 'dupinvno', type: sql.BigInt }, { name: 'CESSTOTAMT', type: sql.Money },
  { name: 'SPCESSTOTAMT', type: sql.Money }, { name: 'oldbalance', type: sql.Money },
  { name: 'gststatus', type: sql.BigInt }, { name: 'gstbillno', type: sql.BigInt },
  { name: 'remaindays', type: sql.BigInt }, { name: 'ftotamt', type: sql.Money },
  { name: 'ftotgst', type: sql.Money }, { name: 'fdiscount', type: sql.Money },
  { name: 'fnetamt', type: sql.Money },
];

const PBACKSALES_DETAILS_COLUMNS = [
  { name: 'InvNo', type: sql.BigInt }, { name: 'SlNo', type: sql.BigInt },
  { name: 'Barcode', type: sql.VarChar(50) }, { name: 'Qty', type: sql.Float },
  { name: 'UnitId', type: sql.Int }, { name: 'FOC', type: sql.Float },
  { name: 'FOCUnitId', type: sql.Int }, { name: 'Rate', type: sql.Money },
  { name: 'Discount', type: sql.Money }, { name: 'CCode', type: sql.Int },
  { name: 'FOCBarcode', type: sql.VarChar(50) }, { name: 'cgst', type: sql.Money },
  { name: 'sgst', type: sql.Money }, { name: 'cgstamt', type: sql.Money },
  { name: 'sgstamt', type: sql.Money }, { name: 'totamt', type: sql.Money },
  { name: 'hsnslno', type: sql.VarChar(50) }, { name: 'discper', type: sql.Money },
  { name: 'warrenty', type: sql.VarChar(100) }, { name: 'costprice', type: sql.Money },
  { name: 'imeino', type: sql.VarChar(500) }, { name: 'CESSTAX', type: sql.Money },
  { name: 'CESSAMT', type: sql.Money }, { name: 'SPCESSPRICE', type: sql.Money },
  { name: 'SPCESSAMT', type: sql.Money },
];

const PUNIT_MASTER_COLUMNS = [
  { name: 'Id', type: sql.Int }, { name: 'Name', type: sql.VarChar(100) },
];

const PDEPARTMENT_MASTER_COLUMNS = [
  { name: 'Id', type: sql.Int }, { name: 'Name', type: sql.VarChar(100) },
  { name: 'PurchaseAcCode', type: sql.BigInt }, { name: 'SalesAcCode', type: sql.BigInt },
  { name: 'Code', type: sql.VarChar(20) },
];

const PCATEGORY_MASTER_COLUMNS = [
  { name: 'Id', type: sql.BigInt }, { name: 'Name', type: sql.VarChar(150) },
  { name: 'Code', type: sql.VarChar(50) }, { name: 'groupedunderid', type: sql.BigInt },
];

const PFIRSTCATEGORY_MASTER_COLUMNS = [
  { name: 'Id', type: sql.BigInt }, { name: 'Name', type: sql.VarChar(150) },
  { name: 'Code', type: sql.VarChar(50) }, { name: 'groupedunderid', type: sql.VarChar(50) },
];

const PITEM_MASTER_COLUMNS = [
  { name: 'Id', type: sql.BigInt }, { name: 'ItemMasterCode', type: sql.VarChar(100) },
  { name: 'Name', type: sql.VarChar(150) }, { name: 'ShortName', type: sql.NVarChar(150) },
  { name: 'CategoryId', type: sql.BigInt }, { name: 'UnitId', type: sql.Int },
  { name: 'SellingPrice', type: sql.Money }, { name: 'CostPrice', type: sql.Money },
  { name: 'Barcode', type: sql.VarChar(100) }, { name: 'ReorderLevel', type: sql.VarChar(53) },
  { name: 'ReorderQty', type: sql.Float }, { name: 'SupplierItemCode', type: sql.VarChar(50) },
  { name: 'DepartmentId', type: sql.Int }, { name: 'FirstcategoryId', type: sql.BigInt },
  { name: 'SecondCategoryid', type: sql.BigInt }, { name: 'ColorId', type: sql.BigInt },
  { name: 'Sizeid', type: sql.BigInt }, { name: 'NonStockItem', type: sql.Int },
  { name: 'WeighingScaleItem', type: sql.Int }, { name: 'ShelfNo', type: sql.VarChar(50) },
  { name: 'RackNo', type: sql.VarChar(50) }, { name: 'FOCitem', type: sql.Int },
  { name: 'SellingUnitId', type: sql.BigInt }, { name: 'Leadtime', type: sql.BigInt },
  { name: 'SellingpricePackingUnit', type: sql.Money }, { name: 'suppliercode', type: sql.VarChar(50) },
  { name: 'Discount', type: sql.Float }, { name: 'itemref', type: sql.VarChar(50) },
  { name: 'arabicname', type: sql.NVarChar(500) }, { name: 'avgcost', type: sql.Money },
  { name: 'createddate', type: sql.DateTime }, { name: 'createduser', type: sql.VarChar(100) },
  { name: 'moddate', type: sql.DateTime }, { name: 'moduser', type: sql.VarChar(100) },
  { name: 'pcgst', type: sql.Float }, { name: 'psgst', type: sql.Float },
  { name: 'scgst', type: sql.Float }, { name: 'ssgst', type: sql.Float },
  { name: 'mrp', type: sql.Money }, { name: 'spsellingprice', type: sql.Money },
  { name: 'price1', type: sql.Money }, { name: 'price2', type: sql.Money },
  { name: 'price3', type: sql.Money }, { name: 'price4', type: sql.Money },
  { name: 'cess', type: sql.BigInt }, { name: 'ACTIVESTATUS', type: sql.BigInt },
  { name: 'modtime', type: sql.DateTime }, { name: 'tamilstatus', type: sql.BigInt },
  { name: 'spcess', type: sql.Money }, { name: 'wktorpc', type: sql.VarChar(50) },
  { name: 'wkt', type: sql.BigInt },
];

router.post('/sales', async (req, res) => {
  const { storeCode, rows } = req.body || {};
  if (!storeCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    let count = 0;
    for (const row of rows) {
      await pool
        .request()
        .input('TransNo', sql.BigInt, row.TransNo)
        .input('CCode', sql.Int, storeCode)
        .input('Discount', sql.Money, row.Discount || 0)
        .input('Tax1', sql.Money, row.Tax1 || 0)
        .input('Tax2', sql.Money, row.Tax2 || 0)
        .input('CustomerName', sql.VarChar, row.CustomerName || null)
        .query(`
          MERGE dbo.AcSales AS target
          USING (SELECT @TransNo AS TransNo, @CCode AS CCode) AS src
            ON target.TransNo = src.TransNo AND target.CCode = src.CCode
          WHEN MATCHED THEN
            UPDATE SET Discount = @Discount, Tax1 = @Tax1, Tax2 = @Tax2, CustomerName = @CustomerName
          WHEN NOT MATCHED THEN
            INSERT (TransNo, CCode, Discount, Tax1, Tax2, CustomerName)
            VALUES (@TransNo, @CCode, @Discount, @Tax1, @Tax2, @CustomerName);
        `);
      count++;
    }
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/sales error:', err);
    res.status(500).json({ error: 'Failed to sync sales', detail: err.message });
  }
});

router.post('/sales-details', async (req, res) => {
  const { storeCode, rows } = req.body || {};
  if (!storeCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    let count = 0;
    for (const row of rows) {
      await pool
        .request()
        .input('TransNo', sql.BigInt, row.TransNo)
        .input('CCode', sql.Int, storeCode)
        .input('SLNo', sql.Int, row.SLNo)
        .input('ICode', sql.Int, row.ICode)
        .input('Qty', sql.Int, row.Qty || 0)
        .input('CostPrice', sql.Money, row.CostPrice || 0)
        .input('SPrice', sql.Money, row.SPrice || 0)
        .query(`
          MERGE dbo.AcSalesDetails AS target
          USING (SELECT @TransNo AS TransNo, @CCode AS CCode, @SLNo AS SLNo) AS src
            ON target.TransNo = src.TransNo AND target.CCode = src.CCode AND target.SLNo = src.SLNo
          WHEN MATCHED THEN
            UPDATE SET ICode = @ICode, Qty = @Qty, CostPrice = @CostPrice, SPrice = @SPrice
          WHEN NOT MATCHED THEN
            INSERT (TransNo, CCode, SLNo, ICode, Qty, CostPrice, SPrice)
            VALUES (@TransNo, @CCode, @SLNo, @ICode, @Qty, @CostPrice, @SPrice);
        `);
      count++;
    }
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/sales-details error:', err);
    res.status(500).json({ error: 'Failed to sync sales details', detail: err.message });
  }
});

router.post('/users', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    let count = 0;
    for (const row of rows) {
      await pool
        .request()
        .input('UniqueCode', sql.VarChar, storeUniqueCode)
        .input('UserName', sql.VarChar, row.UserName)
        .input('Password', sql.Char, row.Password || '')
        .input('StOrSdorOt', sql.SmallInt, row.StOrSdorOt ?? 0)
        .query(`
          MERGE dbo.AcUser AS target
          USING (SELECT @UniqueCode AS UniqueCode, @UserName AS UserName) AS src
            ON target.UniqueCode = src.UniqueCode AND target.UserName = src.UserName
          WHEN MATCHED THEN
            UPDATE SET Password = @Password, StOrSdorOt = @StOrSdorOt
          WHEN NOT MATCHED THEN
            INSERT (UserID, UserName, Password, StOrSdorOt, UniqueCode)
            VALUES (
              (SELECT ISNULL(MAX(UserID), 0) + 1 FROM dbo.AcUser),
              @UserName, @Password, @StOrSdorOt, @UniqueCode
            );
        `);
      count++;
    }
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/users error:', err);
    res.status(500).json({ error: 'Failed to sync users', detail: err.message });
  }
});

router.post('/psales-master', async (req, res) => {
  const { storeCode, storeUniqueCode, rows } = req.body || {};
  if (!storeCode || !storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode, storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PSalesMaster', ['CCode', 'InvNo'], PSALES_MASTER_COLUMNS,
      rows, { CCode: storeCode }, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/psales-master error:', err);
    res.status(500).json({ error: 'Failed to sync PSalesMaster', detail: err.message });
  }
});

router.post('/psales-details', async (req, res) => {
  const { storeCode, storeUniqueCode, rows } = req.body || {};
  if (!storeCode || !storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode, storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PSalesDetails', ['CCode', 'InvNo', 'SlNo'], PSALES_DETAILS_COLUMNS,
      rows, { CCode: storeCode }, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/psales-details error:', err);
    res.status(500).json({ error: 'Failed to sync PSalesDetails', detail: err.message });
  }
});

router.post('/pbacksales-master', async (req, res) => {
  const { storeCode, storeUniqueCode, rows } = req.body || {};
  if (!storeCode || !storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode, storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PBackSalesMaster', ['CCode', 'InvNo'], PBACKSALES_MASTER_COLUMNS,
      rows, { CCode: storeCode }, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/pbacksales-master error:', err);
    res.status(500).json({ error: 'Failed to sync PBackSalesMaster', detail: err.message });
  }
});

router.post('/pbacksales-details', async (req, res) => {
  const { storeCode, storeUniqueCode, rows } = req.body || {};
  if (!storeCode || !storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeCode, storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PBackSalesDetails', ['CCode', 'InvNo', 'SlNo'], PBACKSALES_DETAILS_COLUMNS,
      rows, { CCode: storeCode }, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/pbacksales-details error:', err);
    res.status(500).json({ error: 'Failed to sync PBackSalesDetails', detail: err.message });
  }
});

router.post('/units', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PUnitMaster', ['Id'], PUNIT_MASTER_COLUMNS,
      rows, {}, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/units error:', err);
    res.status(500).json({ error: 'Failed to sync PUnitMaster', detail: err.message });
  }
});

router.post('/departments', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PDepartmentMaster', ['UniqueCode', 'Id'], PDEPARTMENT_MASTER_COLUMNS,
      rows, {}, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/departments error:', err);
    res.status(500).json({ error: 'Failed to sync PDepartmentMaster', detail: err.message });
  }
});

router.post('/categories', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'PCategoryMaster', ['UniqueCode', 'Id'], PCATEGORY_MASTER_COLUMNS,
      rows, {}, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/categories error:', err);
    res.status(500).json({ error: 'Failed to sync PCategoryMaster', detail: err.message });
  }
});

router.post('/first-categories', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const count = await upsertRows(
      pool, 'pfirstcategory', ['UniqueCode', 'Id'], PFIRSTCATEGORY_MASTER_COLUMNS,
      rows, {}, storeUniqueCode
    );
    res.json({ synced: count });
  } catch (err) {
    console.error('POST /sync/first-categories error:', err);
    res.status(500).json({ error: 'Failed to sync pfirstcategory', detail: err.message });
  }
});

// POST /sync/items
// Body: { storeUniqueCode, rows: [...] } — matched on (UniqueCode, Id).
//
// disableTriggers: ['itemorderloc'] is commented out below on purpose.
// UNCOMMENT ONLY AFTER you've run inspect-itemorderloc-trigger.js and
// confirmed you're OK with suspending whatever that trigger does for the
// short time this route runs. It's the documented, known-slow trigger
// that does a table scan per row-level insert — the combination of that
// trigger plus the previous 30s pool requestTimeout (see config/db.js) is
// what was turning a single 25-row batch into a multi-minute request that
// blew past the sync-agent's 120s client timeout. The requestTimeout fix
// and the sync-agent skip-when-unchanged fix should be enough on their
// own; this is here as an extra lever if PItemMaster batches are still
// slow once something genuinely changes and has to be pushed.
router.post('/items', async (req, res) => {
  const { storeUniqueCode, rows } = req.body || {};
  if (!storeUniqueCode || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'storeUniqueCode and rows[] are required' });
  }
  try {
    const pool = await getPool();
    const { count, errors } = await upsertRows(
      pool, 'PItemMaster', ['UniqueCode', 'Id'], PITEM_MASTER_COLUMNS,
      rows, {}, storeUniqueCode,
      {
        continueOnError: true,
        // disableTriggers: ['itemorderloc'],
      }
    );
    if (errors.length > 0) {
      console.error(`POST /sync/items: ${errors.length} of ${rows.length} row(s) failed:`, errors);
    }
    res.json({ synced: count, failed: errors.length, errors: errors.slice(0, 20) });
  } catch (err) {
    console.error('POST /sync/items error:', err);
    res.status(500).json({ error: 'Failed to sync PItemMaster', detail: err.message });
  }
});

// GET /sync/price-changes?storeUniqueCode=&sinceId=
//
// Pulled by sync-agent (not pushed) — the ONE place in this app where data
// flows cloud -> local instead of local -> cloud. Returns queued price
// changes (see routes/items.js PUT /items/price) for this store with
// Id > sinceId, so the agent can apply them to ITS OWN local SQL Server
// and only advance its own watermark once they've actually been applied
// (see sync-agent/sync.js applyPriceChanges()).
router.get('/price-changes', async (req, res) => {
  const { storeUniqueCode, sinceId } = req.query || {};
  if (!storeUniqueCode) {
    return res.status(400).json({ error: 'storeUniqueCode is required' });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('UniqueCode', sql.VarChar(50), storeUniqueCode)
      .input('SinceId', sql.BigInt, parseInt(sinceId, 10) || 0)
      .query(`
        SELECT TOP 500 Id, Barcode, SellingPrice, CostPrice, MRP, ChangedAt
        FROM dbo.PPriceChangeQueue
        WHERE UniqueCode = @UniqueCode AND Id > @SinceId
        ORDER BY Id ASC
      `);
    res.json({ changes: result.recordset });
  } catch (err) {
    console.error('GET /sync/price-changes error:', err);
    res.status(500).json({ error: 'Failed to fetch price changes', detail: err.message });
  }
});

module.exports = router;