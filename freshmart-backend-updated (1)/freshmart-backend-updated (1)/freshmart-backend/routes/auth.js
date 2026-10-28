// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');

const router = express.Router();

// POST /auth/login
// Body: { username, password }
// Returns: { token, user: { username, name, uniqueCode } }
//
// ⚠️ ADJUST ME: this query assumes a table dbo.AcUser with columns
//   UserName, Password, EmpName, UniqueCode, CCode
// Rename the columns below to match your actual schema (check the
// AcUser table in SSMS — see the screenshot you sent — and update
// the SELECT/WHERE below accordingly).
router.post('/login', async (req, res) => {
  const { username, password, uniqueCode } = req.body || {};

  if (!username || !password || !uniqueCode) {
    return res.status(400).json({ error: 'username, password, and uniqueCode (store code) are required' });
  }

  try {
    const pool = await getPool();
    const request = pool
      .request()
      .input('username', sql.NVarChar, username)
      .input('uniqueCode', sql.VarChar, uniqueCode);

    // uniqueCode is REQUIRED: AcUser has the same username (e.g. "Cashier")
    // reused across multiple stores with different passwords, so a lookup
    // without it is ambiguous — `SELECT TOP 1 ... WHERE UserName = @username`
    // with no ORDER BY can silently return a different store's row.
    const query = `
      SELECT TOP 1 UserID, UserName, Password, StOrSdorOt, UniqueCode
      FROM dbo.AcUser
      WHERE UserName = @username AND UniqueCode = @uniqueCode
    `;

    const result = await request.query(query);

    const row = result.recordset[0];
    if (!row) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // If passwords are stored as bcrypt hashes, use bcrypt.compare.
    // If they're stored as plain text (common in older legacy systems),
    // fall back to a direct comparison. Prefer migrating to bcrypt ASAP.
    let passwordOk = false;
    const storedPassword = (row.Password || '').trim(); // char() columns are space-padded
    if (storedPassword.startsWith('$2')) {
      passwordOk = await bcrypt.compare(password, storedPassword);
    } else {
      passwordOk = password === storedPassword;
    }

    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // AcUser has no name/company columns in your schema, so we fall back
    // to sensible defaults the app already expects (see AuthContext.js /
    // api.js, which default to 'YNOT001' when missing).
    const user = {
      userId: row.UserID,
      username: row.UserName,
      name: row.UserName,
      uniqueCode: row.UniqueCode || 'YNOT001',
      ccode: 1,
      // StOrSdorOt looks like a role/type flag (Store/SuperDealer/Other?) —
      // passed through in case the app wants to use it later.
      userType: row.StOrSdorOt,
    };

    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });

    return res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

module.exports = router;