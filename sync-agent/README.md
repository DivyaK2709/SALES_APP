# FreshMart Sync Agent

Runs on the local store PC (the one with `WIN-KM7F76OMGU9\SQLEXPRESS`).
Pushes new sales data — and this store's users — up to the cloud database,
tagged with this store's unique code (`STORE_UNIQUE_CODE`, e.g. `YNOT01`)
and `CCode` so multiple stores can safely share the same cloud tables.

## 1. Create a read-only login on the LOCAL SQL Server

In SSMS, connected to your local server, run (pick your own password):

```sql
-- Only needed if SQL Auth / Mixed Mode isn't already enabled here —
-- Server Properties → Security → "SQL Server and Windows Authentication
-- mode" → OK → restart the SQL Server service.

CREATE LOGIN sync_reader WITH PASSWORD = 'Choose_A_Strong_Password_123!';
USE ynot;  -- or whatever your local database is actually named
CREATE USER sync_reader FOR LOGIN sync_reader;
ALTER ROLE db_datareader ADD MEMBER sync_reader;
```

## 2. Install and run the setup wizard

```bash
cd sync-agent
npm install
npm run setup
```

(or just double-click `setup.bat`)

This asks a handful of questions — the store's unique code, its local SQL
Server address/instance/database, and the login from Step 1 — tests the
connection, and writes `.env` for you. This is the step to run fresh on
every new client/store PC; nothing needs to be hand-edited.

## 3. Test it manually

```bash
node sync.js
```

First run pushes everything that exists so far (sales, sale details, and
all local users). Every run after that only sends what's new for sales;
users are small enough that the whole table just re-syncs every time.

## 4. Automate it with Windows Task Scheduler

1. Open **Task Scheduler** → **Create Basic Task**
2. Name it "FreshMart Sync"
3. Trigger: choose how often (e.g. **Daily**, or **Repeat every 15 minutes**
   via the Advanced/Repeat task option after creating it)
4. Action: **Start a program**
5. Program/script: browse to `run-sync.bat` in this folder
6. Finish

You can still double-click `run-sync.bat` any time for an on-demand
"Sync Now" — it's the exact same script Task Scheduler runs.

Check `sync.log` in this folder any time to see the history of what ran
and whether it succeeded.

## Notes

- Currently syncs `AcSales`, `AcSalesDetails`, and `AcUser`. `AcTrans` /
  `AcTransDetails` (likely where the real invoice date lives) will be
  added the same way once that schema is confirmed — see `sync.js`, the
  spot is commented.
- `sync-state.json` tracks how far this store has synced (sales only).
  Don't delete it unless you want to force a full re-sync from scratch —
  safe to do, re-sent rows just overwrite themselves, no duplicates.
- User syncing matches on `(UniqueCode, UserName)`, never on `UserID` —
  each store's local `UserID` values will collide with each other (every
  store starts at 1), so those stay local-only and are never written to
  the cloud table.
- To add a second store later: copy this whole folder onto that store's
  PC and run `npm run setup` again there with a different unique code
  (e.g. `YNOT02`) and that store's own local database. No cloud-side
  changes needed.
