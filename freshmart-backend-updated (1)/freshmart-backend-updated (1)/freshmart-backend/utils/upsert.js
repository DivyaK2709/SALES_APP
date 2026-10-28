// utils/upsert.js
//
// Generic helper to MERGE (upsert) an array of plain-object rows into a
// cloud table, given: the table name, the column(s) that uniquely identify
// a row (the MATCH key), and the full list of columns + their mssql types.
//
// Every table synced through this helper also gets a UniqueCode column
// stamped with the pushing store's unique code (for easy filtering/
// retrieval later) - UniqueCode is NOT part of the match key, since CCode
// already disambiguates rows between stores for tables that have it.
//
// PERFORMANCE: rows are sent in batches (default 500) as a single JSON
// string, unpacked server-side with OPENJSON, and MERGEd in ONE round trip
// per batch - not one round trip per row. That's the difference between
// ~46 round trips and 23,094 round trips for a table the size of
// PItemMaster. (Requires SQL Server 2016+ / Azure SQL, which supports
// OPENJSON - true for any currently-supported SQL Server version.)
//
// If a batch's MERGE fails (e.g. one bad row - a value too long for its
// column, a bad numeric, etc.), that one batch - and ONLY that batch -
// falls back to the old row-by-row MERGE so the exact offending row can be
// identified without paying the row-by-row cost for the other 22,500+
// good rows.

const sql = require('mssql');

// ---- optional: temporarily disable slow/misbehaving triggers ----------
//
// PItemMaster carries a known-slow row-level trigger ('itemorderloc' -
// see inspect-itemorderloc-trigger.js) that does extra work on every
// single INSERT. Callers that know a table has an expensive trigger they
// don't need firing during a bulk sync can pass
// options.disableTriggers: ['itemorderloc'] to have upsertRows() disable
// it for the duration of the call and always re-enable it afterwards
// (even on error), instead of eating that trigger's cost on every one of
// the (up to) tens of thousands of rows being upserted.
//
// This does NOT delete or alter the trigger - it only suspends it for
// this one call. If other parts of the app depend on that trigger's side
// effects happening in near-real-time (not just eventually), read what it
// actually does (inspect-itemorderloc-trigger.js) before enabling this,
// and reconcile separately if needed.
async function withTriggersDisabled(pool, table, triggerNames, fn) {
  if (!triggerNames || triggerNames.length === 0) {
    return fn();
  }
  for (const name of triggerNames) {
    await pool.request().query(`ALTER TABLE dbo.${table} DISABLE TRIGGER ${name}`);
  }
  try {
    return await fn();
  } finally {
    for (const name of triggerNames) {
      try {
        await pool.request().query(`ALTER TABLE dbo.${table} ENABLE TRIGGER ${name}`);
      } catch (reEnableErr) {
        // Never swallow this silently - a trigger left disabled is a much
        // worse failure mode than a slow sync, since every future write
        // (from anywhere in the app, not just sync) would skip it too.
        console.error(
          `  upsertRows: FAILED to re-enable trigger ${name} on ${table} - it may still be disabled! ${reEnableErr.message}`
        );
      }
    }
  }
}

// ---- row-by-row fallback (used only for a batch that failed) ----------

function buildMergeQuery(table, keyCols, allColNames) {
  const onClause = keyCols.map((k) => `target.${k} = src.${k}`).join(' AND ');
  const updateCols = allColNames.filter((c) => !keyCols.includes(c));
  const updateSet = updateCols.map((c) => `${c} = src.${c}`).join(', ');
  const insertCols = allColNames.join(', ');
  const insertVals = allColNames.map((c) => `src.${c}`).join(', ');
  const selectSrc = allColNames.map((c) => `@${c} AS ${c}`).join(', ');

  return `
    MERGE dbo.${table} AS target
    USING (SELECT ${selectSrc}) AS src
      ON ${onClause}
    WHEN MATCHED THEN
      UPDATE SET ${updateSet}
    WHEN NOT MATCHED THEN
      INSERT (${insertCols})
      VALUES (${insertVals});
  `;
}

async function upsertChunkRowByRow(pool, table, keyCols, columnDefs, chunk, overrides, uniqueCode, continueOnError, errors) {
  const allColNames = [...columnDefs.map((c) => c.name), 'UniqueCode'];
  const query = buildMergeQuery(table, keyCols, allColNames);

  let count = 0;
  for (const row of chunk) {
    try {
      const request = pool.request();
      for (const col of columnDefs) {
        const val = Object.prototype.hasOwnProperty.call(overrides, col.name)
          ? overrides[col.name]
          : row[col.name] ?? null;
        request.input(col.name, col.type, val);
      }
      request.input('UniqueCode', sql.VarChar(50), uniqueCode);
      await request.query(query);
      count++;
    } catch (err) {
      const keyDesc = keyCols.map((k) => `${k}=${row[k]}`).join(', ');

      if (!continueOnError) {
        const enriched = new Error(`${table} row [${keyDesc}] failed: ${err.message}`);
        enriched.original = err;
        throw enriched;
      }

      console.error(`  upsertRows: skipping bad row in ${table} [${keyDesc}]: ${err.message}`);
      errors.push({ key: keyDesc, message: err.message });
    }
  }
  return count;
}

// ---- fast batched path --------------------------------------------------

// Map an mssql column-type declaration (either a bare type like sql.Int,
// or a sized instance like sql.VarChar(50)) to the SQL type string OPENJSON
// needs in its WITH clause.
function sqlTypeToDDL(t) {
  const typeFn = typeof t === 'function' ? t : t.type;
  const name = typeFn.name;
  const length = t.length;

  switch (name) {
    case 'VarChar': return `VARCHAR(${length === sql.MAX ? 'MAX' : (length || 255)})`;
    case 'NVarChar': return `NVARCHAR(${length === sql.MAX ? 'MAX' : (length || 255)})`;
    case 'Char': return `CHAR(${length || 10})`;
    case 'Int': return 'INT';
    case 'BigInt': return 'BIGINT';
    case 'SmallInt': return 'SMALLINT';
    case 'TinyInt': return 'TINYINT';
    case 'Money': return 'MONEY';
    case 'SmallMoney': return 'SMALLMONEY';
    case 'Float': return 'FLOAT';
    case 'Real': return 'REAL';
    case 'Bit': return 'BIT';
    case 'DateTime': return 'DATETIME';
    case 'Date': return 'DATE';
    default: return 'NVARCHAR(MAX)'; // safe fallback, never crashes on an unmapped type
  }
}

function buildBatchMergeQuery(table, keyCols, allColNames, typeByName) {
  const withCols = allColNames
    .map((c) => `[${c}] ${sqlTypeToDDL(typeByName[c])} '$."${c}"'`)
    .join(',\n        ');

  const onClause = keyCols.map((k) => `target.${k} = src.${k}`).join(' AND ');
  const updateCols = allColNames.filter((c) => !keyCols.includes(c));
  const updateSet = updateCols.map((c) => `${c} = src.${c}`).join(', ');
  const insertCols = allColNames.join(', ');
  const insertVals = allColNames.map((c) => `src.${c}`).join(', ');

  return `
    MERGE dbo.${table} AS target
    USING (
      SELECT *
      FROM OPENJSON(@rowsJson)
      WITH (
        ${withCols}
      )
    ) AS src
      ON ${onClause}
    WHEN MATCHED THEN
      UPDATE SET ${updateSet}
    WHEN NOT MATCHED THEN
      INSERT (${insertCols})
      VALUES (${insertVals});
  `;
}

/**
 * @param pool          mssql connection pool
 * @param table         cloud table name, e.g. 'PSalesMaster'
 * @param keyCols       array of column names that form the MERGE match key, e.g. ['CCode', 'InvNo']
 * @param columnDefs    array of { name, type } for every column EXCEPT UniqueCode, e.g. [{ name: 'CCode', type: sql.Int }, ...]
 * @param rows          array of plain row objects from the local DB (as received in req.body.rows)
 * @param overrides     object of { columnName: value } to force a value instead of trusting the row body (use this for CCode - always trust the authenticated store's code, never the row's own value)
 * @param uniqueCode    the store's unique code, stamped onto every row
 * @param options.continueOnError  when true, a row that fails even after
 *   the row-by-row fallback is logged and skipped instead of aborting the
 *   rest of the sync. Return shape changes to { count, errors } when this
 *   is on - every caller passing this option MUST destructure accordingly
 *   instead of treating the return value as a plain number.
 * @param options.batchSize  rows per round trip (default 500). Lower this
 *   if a single table's row is very wide/has huge text fields and you hit
 *   SQL Server's request size limits; there's little reason to raise it.
 * @param options.disableTriggers  array of trigger names on `table` to
 *   disable for the duration of this call (see withTriggersDisabled()
 *   above). Only use this for triggers you've confirmed are safe to skip
 *   during a bulk sync - it is always re-enabled afterwards, even on error.
 */
async function upsertRows(pool, table, keyCols, columnDefs, rows, overrides, uniqueCode, options = {}) {
  const { continueOnError = false, batchSize = 500, disableTriggers = [] } = options;

  const allColNames = [...columnDefs.map((c) => c.name), 'UniqueCode'];
  const typeByName = {};
  columnDefs.forEach((c) => { typeByName[c.name] = c.type; });
  typeByName.UniqueCode = sql.VarChar(50);

  const batchQuery = buildBatchMergeQuery(table, keyCols, allColNames, typeByName);

  return withTriggersDisabled(pool, table, disableTriggers, async () => {
    let count = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);

      // Fast path: the whole chunk in ONE round trip.
      try {
        const payload = chunk.map((row) => {
          const obj = {};
          for (const col of columnDefs) {
            obj[col.name] = Object.prototype.hasOwnProperty.call(overrides, col.name)
              ? overrides[col.name]
              : row[col.name] ?? null;
          }
          obj.UniqueCode = uniqueCode;
          return obj;
        });

        const request = pool.request();
        request.input('rowsJson', sql.NVarChar(sql.MAX), JSON.stringify(payload));
        await request.query(batchQuery);

        count += chunk.length;
        continue;
      } catch (batchErr) {
        // One bad row anywhere in the chunk fails the WHOLE batch MERGE.
        // Fall back to row-by-row for ONLY this chunk so we can pin down
        // exactly which row it is, without slowing down the rest of the sync.
        console.error(
          `  upsertRows: batch of ${chunk.length} failed for ${table} (rows ${i}-${i + chunk.length - 1}), retrying row-by-row: ${batchErr.message}`
        );
      }

      count += await upsertChunkRowByRow(
        pool, table, keyCols, columnDefs, chunk, overrides, uniqueCode, continueOnError, errors
      );
    }

    return continueOnError ? { count, errors } : count;
  });
}

module.exports = { upsertRows };