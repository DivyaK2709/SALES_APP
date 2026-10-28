// sync.js
//
// Run manually:   node sync.js   (or double-click run-sync.bat)
// Run on schedule: point Windows Task Scheduler at run-sync.bat
//
// What it does, every run:
//   1. Connects to the LOCAL SQL Server
//   2. Pushes AcUser and PUnitMaster (always, every run)
//   3. Pushes PSalesMaster/PSalesDetails/PBackSalesMaster/
//      PBackSalesDetails when today's day-op is CLOSED (DType=1), or
//      immediately if PUnitMaster changed this run
//   4. Tags each row with STORE_CODE (so the cloud knows which store it's from)
//   5. POSTs them in batches to the cloud API's /sync/* endpoints
//   6. Moves the local watermark forward only after the cloud confirms success
//   7. Pulls down any item price changes made from the mobile app and
//      applies them to the LOCAL PItemMaster (the one cloud -> local step)

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const axios = require('axios');
const { loadState, saveState } = require('./state');

// Prevents two sync.js runs from ever executing at the same time — e.g. if
// Task Scheduler fires a new run while a previous one is still slowly
// pushing PItemMaster (see MASTER_BATCH_SIZE comment below: the cloud
// 'itemorderloc' trigger is slow, so a push can legitimately take minutes).
// Two overlapping item pushes were already observed to deadlock against
// each other in SQL Server.
//
// The lock file records the PID of the process that created it. On startup,
// if a lock file exists, we check whether that PID is ACTUALLY still a
// running node.exe — a hard fact, not a guess — rather than only trusting
// file age. That means a crashed/killed run's lock is detected and cleared
// automatically, with no manual "delete sync.lock" step ever needed. The
// LOCK_STALE_MS age check is kept only as a last-resort fallback, in case
// the PID check itself can't run for some reason (e.g. tasklist missing).
const LOCK_FILE = path.join(__dirname, 'sync.lock');
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes

// Returns true if a node.exe process with this PID is currently running.
// Uses Windows' tasklist, since sync.js is deployed on Windows machines
// (see run-sync.bat / Task Scheduler in the README). Returns null (unknown)
// if the check itself fails, so callers can fall back to the age check.
function isProcessAlive(pid) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FI "IMAGENAME eq node.exe"`, {
      encoding: 'utf8',
      windowsHide: true,
    });
    // tasklist prints a header even with no match; a real match includes
    // the PID as its own token in a data row.
    return out.split(/\r?\n/).some((line) => line.trim().startsWith('node.exe') && line.includes(String(pid)));
  } catch (err) {
    console.log(`   (could not verify PID ${pid} via tasklist: ${err.message} — falling back to lock age)`);
    return null; // unknown — let the caller fall back to age-based logic
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;

    // Lock files written by this new code are JSON: { startedAt, pid }.
    // Older lock files (pre-upgrade) are a plain ISO date string — treat
    // those as "unknown PID" and fall back to the age check only.
    let startedAt = raw;
    let pid = null;
    try {
      const parsed = JSON.parse(raw);
      startedAt = parsed.startedAt;
      pid = parsed.pid;
    } catch {
      // plain old-format lock file — pid stays null
    }

    if (pid) {
      const alive = isProcessAlive(pid);
      if (alive === false) {
        console.log(`⚠️  Lock file references PID ${pid}, which is no longer running (crashed/killed). Clearing it automatically.`);
        fs.unlinkSync(LOCK_FILE);
      } else if (alive === true) {
        console.log(`⏭  Another sync.js run is still in progress (PID ${pid}, started ${startedAt}, ${Math.round(age / 1000)}s ago).`);
        console.log(`   Skipping this run to avoid overlapping with it.`);
        return false;
      }
      // alive === null (couldn't check) → fall through to age-based check below
    }

    if (fs.existsSync(LOCK_FILE)) {
      if (age < LOCK_STALE_MS) {
        console.log(`⏭  Another sync.js run appears to still be in progress (started ${startedAt}, ${Math.round(age / 1000)}s ago).`);
        console.log(`   Skipping this run to avoid overlapping with it. If you're SURE nothing is running,`);
        console.log(`   delete ${LOCK_FILE} and try again.`);
        return false;
      }
      console.log(`⚠️  Found a stale lock file (${Math.round(age / 1000)}s old) — a previous run likely crashed. Proceeding anyway.`);
    }
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }));
  return true;
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

const STORE_CODE = parseInt(process.env.STORE_CODE, 10);
const STORE_UNIQUE_CODE = process.env.STORE_UNIQUE_CODE;
// Wide tables (like PSalesMaster, ~44 columns) can push a single batch's
// JSON body close to the server's body-size limit (see freshmart-backend
// server.js) if BATCH_SIZE is too large. 150 keeps batches comfortably
// small, and also keeps each request faster, since the cloud side
// upserts rows one-by-one in a loop rather than as a single bulk insert.
const BATCH_SIZE = 150;

const localDbConfig = {
  server: process.env.LOCAL_DB_SERVER || 'localhost',
  database: process.env.LOCAL_DB_DATABASE,
  user: process.env.LOCAL_DB_USER,
  password: process.env.LOCAL_DB_PASSWORD,
  options: {
    encrypt: process.env.LOCAL_DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.LOCAL_DB_TRUST_SERVER_CERT === 'true',
    // Named instance (e.g. SQLEXPRESS) — requires SQL Server Browser service
    // running and UDP 1434 reachable, since named instances use a dynamic
    // port that only the Browser service knows how to look up.
    ...(process.env.LOCAL_DB_INSTANCE ? { instanceName: process.env.LOCAL_DB_INSTANCE } : {}),
  },
};

// If a fixed port is given instead, use that and skip instance-name lookup
// entirely (more reliable — doesn't depend on the Browser service at all).
if (process.env.LOCAL_DB_PORT) {
  localDbConfig.port = parseInt(process.env.LOCAL_DB_PORT, 10);
  delete localDbConfig.options.instanceName;
}

async function fetchNewRows(pool, table, sinceValue, keyColumn = 'TransNo') {
  const result = await pool
    .request()
    .input('sinceValue', sql.Float, sinceValue) // Float safely holds bigint/int/float watermarks
    .input('ccode', sql.Int, STORE_CODE)
    .query(`
      SELECT *
      FROM dbo.${table}
      WHERE CCode = @ccode AND ${keyColumn} > @sinceValue
      ORDER BY ${keyColumn} ASC
    `);
  return result.recordset;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pushBatch(endpoint, rows, timeoutMs = 30000) {
  await axios.post(
    `${process.env.CLOUD_API_URL}${endpoint}`,
    { storeCode: STORE_CODE, storeUniqueCode: STORE_UNIQUE_CODE, rows },
    { headers: { 'X-Sync-Key': process.env.SYNC_SECRET_KEY }, timeout: timeoutMs }
  );
}

// Wraps pushBatch() with retries for TRANSIENT failures only (dropped
// connection, client-side timeout, connection refused/reset) — not for
// real 4xx/5xx application errors, which retrying can't fix and which
// should surface immediately. A batch MERGE on the cloud side is always
// safe to retry: it's keyed and idempotent (see routes/sync.js), so
// re-sending the same rows after a timeout just re-applies the same
// values, never duplicates anything.
async function pushBatchWithRetry(endpoint, rows, timeoutMs = 30000, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await pushBatch(endpoint, rows, timeoutMs);
      return;
    } catch (err) {
      const code = err.code || err.cause?.code;
      const transient =
        code === 'ECONNRESET' ||
        code === 'ECONNABORTED' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        err.message?.includes('timeout');

      if (!transient || attempt === attempts) throw err;

      const waitMs = attempt * 5000;
      console.log(
        `    ⚠️  batch of ${rows.length} to ${endpoint} failed (${err.message}) — retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${attempts})...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

// How far back the VERY FIRST push of a sales-history table should reach.
// Only applies while that table's watermark is still the untouched default
// (0) — i.e. it has never actually been synced before. The moment a real
// push succeeds, the watermark becomes a real InvNo/TransNo and this is
// never consulted again for that table. Without this, a brand-new store
// (or one that's never had its day closed yet) would try to push its
// ENTIRE sales history in one go, the same problem PItemMaster had.
const INITIAL_SYNC_WINDOW_DAYS = 60; // ~2 months

// Finds the InvNo just below the oldest invoice within the initial sync
// window, so "InvNo > floor" naturally captures everything from ~2 months
// ago onward. Only meaningful for tables with their own InvDate (i.e.
// *Master tables) — see computeInitialFloors() below for how the matching
// *Details tables reuse the SAME floor (they have no date column of their
// own, but share InvNo with their master row, so using their master's
// floor keeps master+details consistent — no orphaned details without a
// matching master, or vice versa).
async function computeInitialFloor(pool, table, keyColumn, dateColumn) {
  const result = await pool
    .request()
    .input('ccode', sql.Int, STORE_CODE)
    .input('windowDays', sql.Int, INITIAL_SYNC_WINDOW_DAYS)
    .query(`
      SELECT ISNULL(MIN(${keyColumn}), 0) - 1 AS floorVal
      FROM dbo.${table}
      WHERE CCode = @ccode AND ${dateColumn} >= DATEADD(DAY, -@windowDays, GETDATE())
    `);
  return result.recordset[0].floorVal ?? 0;
}

// watermarkBucket: which section of state.js holds this table's watermark
// (e.g. 'lastSyncedTransNo' or 'lastSyncedInvNo'); keyColumn: the column
// that watermark tracks (e.g. 'TransNo' or 'InvNo'); initialFloor: only
// used the first time this table is ever synced (see comment above).
async function syncTable(pool, table, endpoint, state, watermarkBucket = 'lastSyncedTransNo', keyColumn = 'TransNo', initialFloor = 0) {
  const stored = state[watermarkBucket][table] || 0;
  const neverSyncedYet = stored === 0;
  const since = neverSyncedYet ? initialFloor : stored;
  if (neverSyncedYet && initialFloor > 0) {
    console.log(`  ${table}: first-time sync — limiting initial push to the last ${INITIAL_SYNC_WINDOW_DAYS} days (starting after ${keyColumn} ${since})`);
  }
  const rows = await fetchNewRows(pool, table, since, keyColumn);

  if (rows.length === 0) {
    console.log(`  ${table}: nothing new (last synced ${keyColumn} ${since})`);
    return;
  }

  console.log(`  ${table}: found ${rows.length} new row(s), pushing to cloud...`);
  const batches = chunk(rows, BATCH_SIZE);
  let maxKey = since;

  for (const batch of batches) {
    await pushBatchWithRetry(endpoint, batch);
    maxKey = Math.max(maxKey, ...batch.map((r) => Number(r[keyColumn])));
    // Save progress after every batch, not just at the end, so a crash
    // partway through a big sync doesn't force re-sending already-confirmed rows.
    state[watermarkBucket][table] = maxKey;
    saveState(state);
  }

  console.log(`  ${table}: synced up to ${keyColumn} ${maxKey}`);
}

async function syncUsers(pool) {
  // AcUser has no CCode and no ever-increasing key like TransNo, and it's a
  // tiny table (a handful of roles), so we just re-send the whole thing
  // every run rather than tracking a watermark for it.
  const result = await pool.request().query(`
    SELECT UserID, UserName, Password, StOrSdorOt FROM dbo.AcUser
  `);
  const rows = result.recordset;

  if (rows.length === 0) {
    console.log('  AcUser: no local users found');
    return;
  }

  console.log(`  AcUser: pushing ${rows.length} user(s)...`);
  await axios.post(
    `${process.env.CLOUD_API_URL}/sync/users`,
    { storeUniqueCode: STORE_UNIQUE_CODE, rows },
    { headers: { 'X-Sync-Key': process.env.SYNC_SECRET_KEY }, timeout: 30000 }
  );
  console.log(`  AcUser: synced ${rows.length} user(s)`);
}

async function syncUnits(pool, state) {
  // PUnitMaster has no CCode column locally — store scoping happens via
  // STORE_UNIQUE_CODE tagging on the outgoing payload (pushBatch), same
  // as syncUsers(), not via a local WHERE filter. Rows can also be
  // UPDATED by another app, not just inserted — so a watermark (like
  // TransNo/InvNo) would silently miss edits to already-synced rows. We
  // deliberately don't track a watermark here: we re-send the full unit
  // list every time this runs, so edits are never skipped. This runs
  // every time regardless of day-open status.
  //
  // Returns true if the unit list changed since the last run (add/edit/
  // delete) — main() uses that to also trigger an immediate push of
  // today's sales tables, same as a day-close would.
  const result = await pool.request().query(`SELECT Id, Name FROM dbo.PUnitMaster ORDER BY Id`);
  const rows = result.recordset;

  const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const changed = state.unitsHash !== hash;

  if (rows.length === 0) {
    console.log('  PUnitMaster: no local units found');
  } else if (!changed) {
    console.log(`  PUnitMaster: unchanged since last run (${rows.length} unit(s)) — skipping push`);
  } else {
    console.log(`  PUnitMaster: pushing ${rows.length} unit(s) (changed since last run)...`);
    await pushBatchWithRetry('/sync/units', rows);
    console.log(`  PUnitMaster: synced ${rows.length} unit(s)`);
  }

  state.unitsHash = hash;
  saveState(state);
  return changed;
}

// Generic "re-send the whole table every run, but only bother if it
// actually changed" sync for a master table the user edits from the POS
// (department/category/first-category/item). Same reasoning as
// syncUnits(): these tables get UPDATED and DELETED, not just appended to,
// so a TransNo-style watermark would silently miss edits — we hash the
// full row set instead and re-push everything whenever the hash differs
// from last run. Each row is tagged with STORE_UNIQUE_CODE by pushBatch(),
// which the cloud MERGE key (see routes/sync.js) uses to keep each store's
// rows separate from every other store's rows sharing the same local Id.
// MASTER_BATCH_SIZE is deliberately smaller than the sales BATCH_SIZE
// (150) — the cloud PItemMaster table has an existing 'itemorderloc'
// trigger that does a table scan on every single-row INSERT the backend's
// upsertRows() loop performs. Smaller batches keep each individual HTTP
// request's total trigger-driven work under the per-request timeout below,
// even though the trigger itself is inefficient (out of our control here).
const MASTER_BATCH_SIZE = 25;
// Master-table pushes (especially PItemMaster, thousands of rows once the
// full catalog changes) can legitimately take longer per batch than a
// sales push, mainly because of that same trigger — 2 minutes gives real
// headroom without hanging forever on a genuinely stuck request.
const MASTER_PUSH_TIMEOUT_MS = 120000;

async function syncMasterTable(pool, state, { label, query, endpoint, hashKey }) {
  const result = await pool.request().query(query);
  const rows = result.recordset;

  const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const changed = state.masterHashes[hashKey] !== hash;

  if (rows.length === 0) {
    console.log(`  ${label}: no local rows found`);
    state.masterHashes[hashKey] = hash;
    saveState(state);
    return changed;
  }

  // Only pushes when the hash actually differs from the last SUCCESSFUL
  // push — see the incident where this used to push the FULL table every
  // single run regardless of `changed`.
  if (!changed) {
    console.log(`  ${label}: unchanged since last run (${rows.length} row(s)) — skipping push`);
    return changed;
  }

  console.log(`  ${label}: pushing ${rows.length} row(s) (changed since last run)...`);
  const batches = chunk(rows, MASTER_BATCH_SIZE);
  let pushed = 0;
  for (const batch of batches) {
    await pushBatchWithRetry(endpoint, batch, MASTER_PUSH_TIMEOUT_MS);
    pushed += batch.length;
    console.log(`    ...${pushed}/${rows.length}`);
  }

  // Only recorded as "synced" once every batch above has actually
  // succeeded — if pushBatchWithRetry throws, we never reach here, so the
  // hash in state stays at its OLD value and the next run will correctly
  // see `changed = true` again and retry the whole table, instead of
  // silently marking a failed push as done.
  state.masterHashes[hashKey] = hash;
  saveState(state);
  return changed;
}

// ⚠️ ADJUST ME: SELECT * is fine locally, but list columns explicitly here
// once you've confirmed the exact schema (see check-schema.js) so a stray
// extra local column never breaks the cloud MERGE in routes/sync.js.
async function syncDepartments(pool, state) {
  return syncMasterTable(pool, state, {
    label: 'PDepartmentMaster',
    query: `SELECT Id, Name, PurchaseAcCode, SalesAcCode, Code FROM dbo.PDepartmentMaster ORDER BY Id`,
    endpoint: '/sync/departments',
    hashKey: 'departments',
  });
}

// Matches PCategoryMaster's real cloud schema (see routes/sync.js).
async function syncCategories(pool, state) {
  return syncMasterTable(pool, state, {
    label: 'PCategoryMaster',
    query: `SELECT Id, Name, Code, groupedunderid FROM dbo.PCategoryMaster ORDER BY Id`,
    endpoint: '/sync/categories',
    hashKey: 'categories',
  });
}

// Matches pfirstcategory's real cloud schema (see routes/sync.js). Table
// name assumed to be the same locally as on the cloud ('pfirstcategory',
// confirmed via SSMS) — adjust if the local table is actually named
// differently.
async function syncFirstCategories(pool, state) {
  return syncMasterTable(pool, state, {
    label: 'pfirstcategory',
    query: `SELECT Id, Name, Code, groupedunderid FROM dbo.pfirstcategory ORDER BY Id`,
    endpoint: '/sync/first-categories',
    hashKey: 'firstCategories',
  });
}

// Matches PItemMaster's real cloud schema (see routes/sync.js) — 19k+
// rows, so this re-hashes/re-pushes the whole table every run. If that
// turns out too slow in practice, switch to a watermark sync on
// moddate/modtime instead (both columns already exist).
async function syncItems(pool, state) {
  return syncMasterTable(pool, state, {
    label: 'PItemMaster',
    // Only items that have actually been sold or purchased at least once
    // (matched via Barcode against PSalesDetails / PPurchaseDetails) get
    // pushed to the cloud — dead catalog entries that never moved are
    // omitted entirely, rather than syncing all 23k+ rows every run.
    query: `
      SELECT im.Id, im.ItemMasterCode, im.Name, im.ShortName, im.CategoryId, im.UnitId, im.SellingPrice,
             im.CostPrice, im.Barcode, im.ReorderLevel, im.ReorderQty, im.SupplierItemCode,
             im.DepartmentId, im.FirstcategoryId, im.SecondCategoryid, im.ColorId, im.Sizeid,
             im.NonStockItem, im.WeighingScaleItem, im.ShelfNo, im.RackNo, im.FOCitem,
             im.SellingUnitId, im.Leadtime, im.SellingpricePackingUnit, im.suppliercode,
             im.Discount, im.itemref, im.arabicname, im.avgcost, im.createddate, im.createduser,
             im.moddate, im.moduser, im.pcgst, im.psgst, im.scgst, im.ssgst, im.mrp, im.spsellingprice,
             im.price1, im.price2, im.price3, im.price4, im.cess, im.ACTIVESTATUS, im.modtime,
             im.tamilstatus, im.spcess, im.wktorpc, im.wkt
      FROM dbo.PItemMaster im
      WHERE EXISTS (SELECT 1 FROM dbo.PSalesDetails sd WHERE sd.Barcode = im.Barcode)
         OR EXISTS (SELECT 1 FROM dbo.PPurchaseDetails pd WHERE pd.Barcode = im.Barcode)
      ORDER BY im.Id
    `,
    endpoint: '/sync/items',
    hashKey: 'items',
  });
}

// ---- Item price changes: the ONE cloud -> local pull in this whole ----
// ---- agent. Everything else in this file only ever PUSHES local ->  ----
// ---- cloud; a manager changing a price on the mobile app writes to  ----
// ---- the cloud first (routes/items.js), and this is what brings     ----
// ---- that change back down to the till. ------------------------------

async function fetchPriceChanges(sinceId) {
  const res = await axios.get(
    `${process.env.CLOUD_API_URL}/sync/price-changes`,
    {
      params: { storeUniqueCode: STORE_UNIQUE_CODE, sinceId },
      headers: { 'X-Sync-Key': process.env.SYNC_SECRET_KEY },
      timeout: 30000,
    }
  );
  return res.data.changes || [];
}

async function applyPriceChanges(pool, state) {
  const changes = await fetchPriceChanges(state.lastPriceChangeId);

  if (changes.length === 0) {
    console.log(`  Price changes: nothing new (last applied Id ${state.lastPriceChangeId})`);
    return;
  }

  console.log(`  Price changes: applying ${changes.length} change(s) to local PItemMaster...`);
  for (const c of changes) {
    try {
      await pool
        .request()
        .input('Barcode', sql.VarChar(100), c.Barcode)
        .input('SellingPrice', sql.Money, c.SellingPrice)
        .input('CostPrice', sql.Money, c.CostPrice)
        .input('MRP', sql.Money, c.MRP)
        .query(`
          UPDATE dbo.PItemMaster
          SET
            SellingPrice = COALESCE(@SellingPrice, SellingPrice),
            CostPrice    = COALESCE(@CostPrice, CostPrice),
            mrp          = COALESCE(@MRP, mrp)
          WHERE Barcode = @Barcode
        `);
      console.log(`    ✅ applied change #${c.Id} (barcode ${c.Barcode})`);
    } catch (err) {
      // Don't let one bad barcode (e.g. item deleted locally since the
      // change was queued) block every change after it — log and move on.
      // The watermark still advances past it below, so it won't retry
      // forever; check the log if a price genuinely never lands locally.
      console.error(`    ⚠️  failed to apply change #${c.Id} (barcode ${c.Barcode}): ${err.message}`);
    }
    // Advance (and persist) the watermark after EACH change, not just at
    // the end of the loop — if the agent crashes partway through 500
    // queued changes, already-applied ones are never re-applied next run.
    state.lastPriceChangeId = c.Id;
    saveState(state);
  }
}

// Returns true if today has a CLOSED day-op row (DType = 1) for this
// store — i.e. the day has been finalized. Sales/back-sales are pushed
// once the day is closed (or immediately if units changed — see main()).
async function isDayClosed(pool) {
  const result = await pool
    .request()
    .input('ccode', sql.Int, STORE_CODE)
    .query(`
      SELECT COUNT(*) AS closedCount
      FROM dbo.PDailyOp
      WHERE CCode = @ccode
        AND CAST(DDate AS DATE) = CAST(GETDATE() AS DATE)
        AND DType = 1
    `);
  return result.recordset[0].closedCount > 0;
}

async function main() {
  if (!STORE_CODE) {
    throw new Error('STORE_CODE is not set in .env');
  }
  if (!STORE_UNIQUE_CODE) {
    throw new Error('STORE_UNIQUE_CODE is not set in .env');
  }

  if (!acquireLock()) {
    return; // another run is already in progress — exit quietly, not an error
  }

  console.log(`\n[${new Date().toISOString()}] Starting sync for store ${STORE_UNIQUE_CODE} (CCode=${STORE_CODE})`);
  const state = loadState();

  const pool = await sql.connect(localDbConfig);
  console.log(`Connected to local DB: ${process.env.LOCAL_DB_SERVER}`);

  try {
    await syncUsers(pool);
    const unitsChanged = await syncUnits(pool, state);

    // Department/category/first-category/item masters: pushed every run,
    // same as units — a user can edit these mid-day from the POS and we
    // want the cloud to reflect that promptly, not wait for day-close.
    await syncDepartments(pool, state);
    await syncCategories(pool, state);
    await syncFirstCategories(pool, state);
    await syncItems(pool, state);

    // Pull down any prices a manager changed from the mobile app since
    // last run, and apply them to THIS store's local PItemMaster. Runs
    // after syncItems() pushes local->cloud, so a price someone just
    // edited locally on the POS isn't immediately clobbered by a stale
    // cloud value from before that edit — the cloud is only "ahead" here
    // for prices actually changed through the mobile app.
    await applyPriceChanges(pool, state);

    // PSalesMaster/PSalesDetails/PBackSalesMaster/PBackSalesDetails are
    // pushed when EITHER of these is true:
    //   - today's day-op has been CLOSED (PDailyOp.DType = 1 for today), or
    //   - PUnitMaster changed this run (add/edit/delete) — an edit there
    //     also triggers an immediate push of today's sales data, same as
    //     a day-close would.
    // Otherwise (day still open, units unchanged) this run skips them —
    // adjust isDayClosed() above if "closed" should mean something
    // different for your workflow. PUnitMaster itself (above) is NOT
    // gated by this — units sync every run, open or closed.
    const dayClosed = await isDayClosed(pool);
    if (dayClosed || unitsChanged) {
      const reason = [dayClosed && 'day CLOSED', unitsChanged && 'units changed'].filter(Boolean).join(' + ');
      console.log(`  Pushing sales/back-sales tables (${reason})...`);

      // Computed every run, but only ever ACTED on for a table whose
      // watermark is still 0 (see syncTable) — cheap single-row lookups,
      // and harmless once real watermarks take over.
      const salesFloor = await computeInitialFloor(pool, 'PSalesMaster', 'InvNo', 'InvDate');
      const backSalesFloor = await computeInitialFloor(pool, 'PBackSalesMaster', 'InvNo', 'InvDate');

      await syncTable(pool, 'PSalesMaster', '/sync/psales-master', state, 'lastSyncedInvNo', 'InvNo', salesFloor);
      await syncTable(pool, 'PSalesDetails', '/sync/psales-details', state, 'lastSyncedInvNo', 'InvNo', salesFloor);
      await syncTable(pool, 'PBackSalesMaster', '/sync/pbacksales-master', state, 'lastSyncedInvNo', 'InvNo', backSalesFloor);
      await syncTable(pool, 'PBackSalesDetails', '/sync/pbacksales-details', state, 'lastSyncedInvNo', 'InvNo', backSalesFloor);
    } else {
      console.log('  Day is OPEN and units unchanged — skipping sales/back-sales sync.');
    }

    // To add AcTrans / AcTransDetails later, add matching lines here plus
    // matching entries in state.js's default state and a matching route
    // in freshmart-backend/routes/sync.js.
  } finally {
    await pool.close();
    releaseLock();
  }

  console.log(`[${new Date().toISOString()}] Sync complete.\n`);
}

main().catch((err) => {
  console.error('❌ Sync failed:', err.response?.data || err.message);
  releaseLock(); // safety net in case the failure happened before the try/finally around pool.close()
  process.exit(1);
});