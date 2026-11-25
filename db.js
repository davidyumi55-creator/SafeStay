/* =========================================================
   SAFE-STAY DATABASE ADAPTER (db.js)
   - Production (Railway / Supabase): Uses PostgreSQL via DATABASE_URL
   - Local Offline Fallback: Uses data/db.json if DATABASE_URL is not set
   Auto-creates tables on startup (zero manual SQL setup needed).
   ========================================================= */

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let pool = null;
let mode = "local-json";
const memorySessions = new Map();

async function initDatabase(createInitialDB) {
  const connStr = process.env.DATABASE_URL;

  if (connStr) {
    try {
      const { Pool } = require("pg");
      const isLocalPg = connStr.includes("localhost") || connStr.includes("127.0.0.1");
      pool = new Pool({
        connectionString: connStr,
        ssl: isLocalPg ? false : { rejectUnauthorized: false }
      });

      // Auto-create tables on first boot (no manual migration required)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS safestay_store (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS safestay_sessions (
          token TEXT PRIMARY KEY,
          user_data JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      mode = "postgresql";
      console.log("[DB] Connected to PostgreSQL successfully.");

      const res = await pool.query("SELECT data FROM safestay_store WHERE id = 'main'");
      if (res.rows.length > 0 && res.rows[0].data) {
        return res.rows[0].data;
      }

      const fresh = createInitialDB();
      await saveState(fresh);
      return fresh;
    } catch (err) {
      console.error("[DB] PostgreSQL connection failed, falling back to local JSON:", err.message);
      pool = null;
      mode = "local-json";
    }
  }

  // Local JSON file fallback (when running offline without DATABASE_URL)
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
  } catch (err) {
    console.error("[DB] Local JSON read error, creating fresh DB:", err.message);
  }
  const fresh = createInitialDB();
  await saveState(fresh);
  return fresh;
}

async function saveState(stateObj) {
  if (pool) {
    await pool.query(
      `INSERT INTO safestay_store (id, data, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(stateObj)]
    );
    return;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = DB_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(stateObj, null, 2), "utf8");
  fs.renameSync(tempFile, DB_FILE);
}

// Persistent sessions (survives Railway restarts when using PostgreSQL)
async function setSession(token, userData) {
  memorySessions.set(token, userData);
  if (pool) {
    await pool.query(
      `INSERT INTO safestay_sessions (token, user_data, created_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (token) DO UPDATE SET user_data = EXCLUDED.user_data`,
      [token, JSON.stringify(userData)]
    );
  }
}

async function getSessionByToken(token) {
  if (!token) return null;
  if (memorySessions.has(token)) return memorySessions.get(token);
  if (pool) {
    const res = await pool.query("SELECT user_data FROM safestay_sessions WHERE token = $1", [token]);
    if (res.rows.length > 0) {
      memorySessions.set(token, res.rows[0].user_data);
      return res.rows[0].user_data;
    }
  }
  return null;
}

async function deleteSession(token) {
  if (!token) return;
  memorySessions.delete(token);
  if (pool) {
    await pool.query("DELETE FROM safestay_sessions WHERE token = $1", [token]);
  }
}

function getDbMode() {
  return mode;
}

module.exports = {
  initDatabase,
  saveState,
  setSession,
  getSessionByToken,
  deleteSession,
  getDbMode
};
