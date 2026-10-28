// routes/sales.js
//
// Queries dbo.PSalesMaster / dbo.PSalesDetails (counter/POS sales) AND
// dbo.PBackSalesMaster / dbo.PBackSalesDetails (back-office / counter-2
// sales), UNIONed together, plus dbo.PItemMaster / dbo.PDepartmentMaster
// (confirmed against the live schema). The JSON shape returned (field
// names like amt/cost/invdate/theDay/etc.) must stay the same, because
// src/services/api.js in the mobile app expects them.
//
// PSalesMaster has no NetAmount/CostAmount columns — TotAmount is the
// invoice total. Cost isn't tracked on PSalesMaster at all; it's derived
// per line from PSalesDetails.Qty * PSalesDetails.COSTPRICE.
//
// PBackSalesMaster mirrors this shape but calls the invoice total "Total"
// instead of "TotAmount" (it also carries GST-related final-amount columns
// ftotamt/fnetamt — swap those in below if "Total" turns out to be the
// pre-GST figure rather than the one you want reported). Its detail table
// PBackSalesDetails carries "costprice" (same column, just lowercase —
// SQL Server column names are case-insensitive) instead of "COSTPRICE".
//
// Because InvNo is only unique WITHIN each source table (a PSalesMaster
// invoice #100 and a PBackSalesMaster invoice #100 are unrelated rows),
// the two sources are aggregated SEPARATELY first (own master+details
// join) and only combined with UNION ALL at the very end. Never join
// PSalesDetails to PBackSalesMaster or vice versa.

const express = require('express');
const { sql, getPool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /sales?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&ccode=1&uniqueCode=YNOT01
// -> [{ invdate, amt, cost }]
router.get('/sales', async (req, res) => {
  const { fromDate, toDate, ccode = 1, uniqueCode } = req.query;
  if (!fromDate || !toDate || !uniqueCode) {
    return res.status(400).json({ error: 'fromDate, toDate, and uniqueCode are required' });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .input('ccode', sql.Int, ccode)
      .input('uniqueCode', sql.VarChar, uniqueCode)
      .query(`
        WITH fwd AS (
          SELECT
            CAST(m.InvDate AS DATE) AS invdate,
            SUM(m.TotAmount)            AS amt,
            SUM(ISNULL(dc.LineCost, 0)) AS cost
          FROM dbo.PSalesMaster m
          LEFT JOIN (
            -- Aggregated ONLY over invoices in this store + date range,
            -- not the whole table -- see the identical fix in
            -- /salespurchasemargin and the comment there for why this
            -- matters.
            SELECT d.InvNo, d.CCode, SUM(d.Qty * d.COSTPRICE) AS LineCost
            FROM dbo.PSalesDetails d
            INNER JOIN dbo.PSalesMaster sm
              ON sm.InvNo = d.InvNo AND sm.CCode = d.CCode
            WHERE sm.CCode = @ccode
              AND sm.UniqueCode = @uniqueCode
              AND sm.InvDate BETWEEN @fromDate AND @toDate
            GROUP BY d.InvNo, d.CCode
          ) dc ON dc.InvNo = m.InvNo AND dc.CCode = m.CCode
          WHERE m.CCode = @ccode
            AND m.UniqueCode = @uniqueCode
            AND m.InvDate BETWEEN @fromDate AND @toDate
          GROUP BY CAST(m.InvDate AS DATE)
        ),
        back AS (
          SELECT
            CAST(m.InvDate AS DATE) AS invdate,
            SUM(m.Total)                AS amt,
            SUM(ISNULL(dc.LineCost, 0)) AS cost
          FROM dbo.PBackSalesMaster m
          LEFT JOIN (
            SELECT d.InvNo, d.CCode, SUM(d.Qty * d.costprice) AS LineCost
            FROM dbo.PBackSalesDetails d
            INNER JOIN dbo.PBackSalesMaster sm
              ON sm.InvNo = d.InvNo AND sm.CCode = d.CCode
            WHERE sm.CCode = @ccode
              AND sm.UniqueCode = @uniqueCode
              AND sm.InvDate BETWEEN @fromDate AND @toDate
            GROUP BY d.InvNo, d.CCode
          ) dc ON dc.InvNo = m.InvNo AND dc.CCode = m.CCode
          WHERE m.CCode = @ccode
            AND m.UniqueCode = @uniqueCode
            AND m.InvDate BETWEEN @fromDate AND @toDate
          GROUP BY CAST(m.InvDate AS DATE)
        )
        SELECT invdate, SUM(amt) AS amt, SUM(cost) AS cost
        FROM (
          SELECT * FROM fwd
          UNION ALL
          SELECT * FROM back
        ) combined
        GROUP BY invdate
        ORDER BY invdate
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /sales error:', err);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// GET /salespurchasemargin?fromDate&toDate&ccode&uniqueCode
// -> [{ category: 'Sales'|'Cost'|'Margin', amt }]
router.get('/salespurchasemargin', async (req, res) => {
  const { fromDate, toDate, ccode = 1, uniqueCode } = req.query;
  if (!fromDate || !toDate || !uniqueCode) {
    return res.status(400).json({ error: 'fromDate, toDate, and uniqueCode are required' });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .input('ccode', sql.Int, ccode)
      .input('uniqueCode', sql.VarChar, uniqueCode)
      .query(`
        WITH fwd AS (
          SELECT
            SUM(m.TotAmount)            AS sales,
            SUM(ISNULL(dc.LineCost, 0)) AS cost
          FROM dbo.PSalesMaster m
          LEFT JOIN (
            -- Same fix as GET /sales above: this used to aggregate ALL of
            -- PSalesDetails with no WHERE clause at all -- every store,
            -- every date, on every request, regardless of the fromDate/
            -- toDate the user actually picked. That full-table aggregate
            -- growing every day was the real reason this endpoint was
            -- taking ~5 minutes. Restricting it to the same invoices the
            -- outer query already filters to (via the INNER JOIN back to
            -- PSalesMaster with the same WHERE) turns this into a normal,
            -- date-scoped lookup -- exactly what /deptwisesales already
            -- did correctly (see its comment).
            SELECT d.InvNo, d.CCode, SUM(d.Qty * d.COSTPRICE) AS LineCost
            FROM dbo.PSalesDetails d
            INNER JOIN dbo.PSalesMaster sm
              ON sm.InvNo = d.InvNo AND sm.CCode = d.CCode
            WHERE sm.CCode = @ccode
              AND sm.UniqueCode = @uniqueCode
              AND sm.InvDate BETWEEN @fromDate AND @toDate
            GROUP BY d.InvNo, d.CCode
          ) dc ON dc.InvNo = m.InvNo AND dc.CCode = m.CCode
          WHERE m.CCode = @ccode
            AND m.UniqueCode = @uniqueCode
            AND m.InvDate BETWEEN @fromDate AND @toDate
        ),
        back AS (
          SELECT
            SUM(m.Total)                AS sales,
            SUM(ISNULL(dc.LineCost, 0)) AS cost
          FROM dbo.PBackSalesMaster m
          LEFT JOIN (
            SELECT d.InvNo, d.CCode, SUM(d.Qty * d.costprice) AS LineCost
            FROM dbo.PBackSalesDetails d
            INNER JOIN dbo.PBackSalesMaster sm
              ON sm.InvNo = d.InvNo AND sm.CCode = d.CCode
            WHERE sm.CCode = @ccode
              AND sm.UniqueCode = @uniqueCode
              AND sm.InvDate BETWEEN @fromDate AND @toDate
            GROUP BY d.InvNo, d.CCode
          ) dc ON dc.InvNo = m.InvNo AND dc.CCode = m.CCode
          WHERE m.CCode = @ccode
            AND m.UniqueCode = @uniqueCode
            AND m.InvDate BETWEEN @fromDate AND @toDate
        )
        SELECT
          SUM(sales) AS sales,
          SUM(cost)  AS cost
        FROM (
          SELECT * FROM fwd
          UNION ALL
          SELECT * FROM back
        ) combined
      `);
    const row = result.recordset[0] || { sales: 0, cost: 0 };
    const sales = row.sales || 0;
    const cost = row.cost || 0;
    const margin = sales - cost;

    res.json([
      { category: 'Sales', amt: sales },
      { category: 'Cost', amt: cost },
      { category: 'Margin', amt: margin },
    ]);
  } catch (err) {
    console.error('GET /salespurchasemargin error:', err);
    res.status(500).json({ error: 'Failed to fetch sales/purchase/margin' });
  }
});

// GET /daywisesales?fromDate&toDate&ccode
// -> [{ theDay: 'Mon'..'Sun', amt }]
router.get('/daywisesales', async (req, res) => {
  const { fromDate, toDate, ccode = 1, uniqueCode } = req.query;
  if (!fromDate || !toDate || !uniqueCode) {
    return res.status(400).json({ error: 'fromDate, toDate, and uniqueCode are required' });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .input('ccode', sql.Int, ccode)
      .input('uniqueCode', sql.VarChar, uniqueCode)
      .query(`
        WITH fwd AS (
          SELECT
            LEFT(DATENAME(WEEKDAY, InvDate), 3) AS theDay,
            TotAmount                           AS amt
          FROM dbo.PSalesMaster
          WHERE CCode = @ccode
            AND UniqueCode = @uniqueCode
            AND InvDate BETWEEN @fromDate AND @toDate
        ),
        back AS (
          SELECT
            LEFT(DATENAME(WEEKDAY, InvDate), 3) AS theDay,
            Total                                AS amt
          FROM dbo.PBackSalesMaster
          WHERE CCode = @ccode
            AND UniqueCode = @uniqueCode
            AND InvDate BETWEEN @fromDate AND @toDate
        )
        SELECT theDay, SUM(amt) AS amt
        FROM (
          SELECT * FROM fwd
          UNION ALL
          SELECT * FROM back
        ) combined
        GROUP BY theDay
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /daywisesales error:', err);
    res.status(500).json({ error: 'Failed to fetch day-wise sales' });
  }
});

// GET /deptwisesales?fromDate&toDate&ccode
// -> [{ DepartmentId, name, amt, cost, Qty }]
router.get('/deptwisesales', async (req, res) => {
  const { fromDate, toDate, ccode = 1, uniqueCode } = req.query;
  if (!fromDate || !toDate || !uniqueCode) {
    return res.status(400).json({ error: 'fromDate, toDate, and uniqueCode are required' });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate)
      .input('ccode', sql.Int, ccode)
      .input('uniqueCode', sql.VarChar, uniqueCode)
      .query(`
        SELECT
          dm.Id   AS DepartmentId,
          dm.Name AS name,
          SUM(agg.amt)  AS amt,
          SUM(agg.cost) AS cost,
          SUM(agg.Qty)  AS Qty
        FROM (
          -- Aggregate sales lines down to one row per barcode BEFORE
          -- joining to the item/department masters — joining every raw
          -- line first (across potentially 100k+ rows) is what caused
          -- the 15s query timeout. Forward and back sales are aggregated
          -- to (Barcode, amt, cost, Qty) separately, THEN unioned, so
          -- InvNo never has to line up across the two source tables.
          SELECT
            d.Barcode,
            SUM(d.Qty * d.Rate)      AS amt,
            SUM(d.Qty * d.COSTPRICE) AS cost,
            SUM(d.Qty)               AS Qty
          FROM dbo.PSalesDetails d
          INNER JOIN dbo.PSalesMaster s
            ON s.InvNo = d.InvNo AND s.CCode = d.CCode
          WHERE s.CCode = @ccode
            AND s.UniqueCode = @uniqueCode
            AND s.InvDate BETWEEN @fromDate AND @toDate
          GROUP BY d.Barcode

          UNION ALL

          SELECT
            d.Barcode,
            SUM(d.Qty * d.Rate)      AS amt,
            SUM(d.Qty * d.costprice) AS cost,
            SUM(d.Qty)               AS Qty
          FROM dbo.PBackSalesDetails d
          INNER JOIN dbo.PBackSalesMaster s
            ON s.InvNo = d.InvNo AND s.CCode = d.CCode
          WHERE s.CCode = @ccode
            AND s.UniqueCode = @uniqueCode
            AND s.InvDate BETWEEN @fromDate AND @toDate
          GROUP BY d.Barcode
        ) agg
        -- im/dm are shared cloud tables holding EVERY store's items/departments,
        -- each row tagged with UniqueCode by the sync agent (see routes/sync.js).
        -- Barcode and DepartmentId are only unique WITHIN a store — two stores
        -- can both have Barcode '12345' or DepartmentId 1 meaning something
        -- completely different. Without filtering im/dm by @uniqueCode too,
        -- this join can silently resolve to another store's item/department row
        -- (this is exactly what caused the Cosmetics/Fancy Items mixup).
        INNER JOIN dbo.PItemMaster im
          ON im.Barcode = agg.Barcode AND im.UniqueCode = @uniqueCode
        INNER JOIN dbo.PDepartmentMaster dm
          ON dm.Id = im.DepartmentId AND dm.UniqueCode = @uniqueCode
        GROUP BY dm.Id, dm.Name
        ORDER BY amt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /deptwisesales error:', err);
    res.status(500).json({ error: 'Failed to fetch department-wise sales' });
  }
});

// GET /companies
router.get('/companies', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CCode, CompanyName
      FROM dbo.AcCompany
      ORDER BY CompanyName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /companies error:', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

module.exports = router;