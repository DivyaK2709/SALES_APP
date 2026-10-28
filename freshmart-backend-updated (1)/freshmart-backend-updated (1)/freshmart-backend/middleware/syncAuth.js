// middleware/syncAuth.js
// Sync requests come from an unattended machine-to-machine script, not a
// logged-in user, so they use a static shared secret instead of a JWT.

function requireSyncKey(req, res, next) {
  const key = req.headers['x-sync-key'];
  if (!key || key !== process.env.SYNC_SECRET_KEY) {
    return res.status(401).json({ error: 'Invalid or missing sync key' });
  }
  next();
}

module.exports = { requireSyncKey };
