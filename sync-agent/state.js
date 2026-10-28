// state.js
// Tracks the last TransNo successfully synced for each table, so re-running
// the sync never re-sends (or loses) data. Stored as a plain JSON file next
// to this script — safe to delete if you ever want to force a full re-sync.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'sync-state.json');

const DEFAULT_STATE = {
  lastSyncedTransNo: { AcSales: 0, AcSalesDetails: 0 },
  lastSyncedInvNo: {
    PSalesMaster: 0,
    PSalesDetails: 0,
    PBackSalesMaster: 0,
    PBackSalesDetails: 0,
  },
  // Fingerprint of the last-pushed PUnitMaster contents, used to detect
  // when a unit gets added/edited/deleted between runs (see sync.js).
  unitsHash: null,
  // Same idea as unitsHash, but for the four master tables that the user
  // edits from the POS (department/category/first-category/item). Full
  // table re-sent every run when its hash changes, so add/edit/delete are
  // all caught — see syncDepartments/syncCategories/syncFirstCategories/
  // syncItems in sync.js.
  masterHashes: {
    departments: null,
    categories: null,
    firstCategories: null,
    items: null,
  },
  // Last dbo.PPriceChangeQueue.Id applied to THIS store's local DB (see
  // applyPriceChanges() in sync.js). This is the one place data flows
  // cloud -> local, so it gets its own watermark, same pattern as
  // lastSyncedInvNo but in reverse.
  lastPriceChangeId: 0,
};

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  // Merge in any new watermark keys added since this state file was last
  // written, so upgrading the agent never crashes on a missing key.
  return {
    lastSyncedTransNo: { ...DEFAULT_STATE.lastSyncedTransNo, ...(saved.lastSyncedTransNo || {}) },
    lastSyncedInvNo: { ...DEFAULT_STATE.lastSyncedInvNo, ...(saved.lastSyncedInvNo || {}) },
    unitsHash: saved.unitsHash !== undefined ? saved.unitsHash : DEFAULT_STATE.unitsHash,
    masterHashes: { ...DEFAULT_STATE.masterHashes, ...(saved.masterHashes || {}) },
    lastPriceChangeId: saved.lastPriceChangeId !== undefined ? saved.lastPriceChangeId : DEFAULT_STATE.lastPriceChangeId,
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState };