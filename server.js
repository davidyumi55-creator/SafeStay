/* =========================================================
   SAFE-STAY FULL-BLOWN SERVER (server.js)
   Production-ready for Railway + PostgreSQL (Supabase or Railway PG)
   with automatic local JSON fallback when run offline.
   ========================================================= */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const dbAdapter = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public")
  : __dirname;

// Allowed static files when serving from flat root (prevents exposing server.js / db.js / .env)
const ALLOWED_ROOT_FILES = new Set([
  "index.html",
  "style.css",
  "app.js",
  "roleDashboards.js",
  "qrcode.js",
  "logo.jpg",
  "manifest.json",
  "sw.js"
]);

// Roles aligned with Proposal Section 8
const ROLES = {
  COORDINATOR: "Emergency Coordinator",
  FRONT_OFFICE: "Front Office",
  HOUSEKEEPING: "Housekeeping",
  SECURITY: "Security / Safety",
  ASSEMBLY: "Assembly-Area Team"
};

// Roles permitted to view/edit Restricted Guest Assistance Record (Proposal Section 5E & 16)
const ASSISTANCE_AUTHORIZED_ROLES = [
  ROLES.COORDINATOR,
  ROLES.FRONT_OFFICE,
  ROLES.SECURITY
];

const sseClients = new Set();
let db = null;

// =========================================================
// PASSWORD HASHING (PBKDF2 via built-in node:crypto)
// =========================================================

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored || "").split(":");
  if (!salt || !originalHash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 10000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(originalHash, "hex"));
}

// =========================================================
// DEFAULT DATA (Matches Proposal Section 14)
// =========================================================

function createDefaultUsers() {
  return [
    { username: "coordinator",  name: "Emergency Coordinator", role: ROLES.COORDINATOR,  staffId: "EC-01",  passwordHash: hashPassword("safe1234") },
    { username: "frontoffice",  name: "Front Desk Officer",    role: ROLES.FRONT_OFFICE, staffId: "FO-01",  passwordHash: hashPassword("safe1234") },
    { username: "housekeeping", name: "Housekeeping Lead",     role: ROLES.HOUSEKEEPING, staffId: "HK-01",  passwordHash: hashPassword("safe1234") },
    { username: "security",     name: "Safety & Security",     role: ROLES.SECURITY,     staffId: "SEC-01", passwordHash: hashPassword("safe1234") },
    { username: "assembly",     name: "Assembly Team Lead",    role: ROLES.ASSEMBLY,     staffId: "AA-01",  passwordHash: hashPassword("safe1234") }
  ];
}

function createDemoRooms() {
  return [
    { floor: 1, room: "101", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.ASSEMBLY,     staffId: "AA-01",  note: "All registered guests verified at assembly area", updatedAt: "09:10 AM" },
    { floor: 1, room: "102", occupied: true, expected: 3, confirmed: 3, status: "YELLOW", role: ROLES.FRONT_OFFICE, staffId: "FO-01",  note: "Guests arrived; awaiting floor check confirmation", updatedAt: "09:12 AM" },
    { floor: 1, room: "103", occupied: true, expected: 1, confirmed: 1, status: "GREEN",  role: ROLES.ASSEMBLY,     staffId: "AA-01",  note: "Verified at assembly area", updatedAt: "09:11 AM" },
    { floor: 1, room: "104", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.HOUSEKEEPING, staffId: "HK-02",  note: "Floor update shared safely; guests verified", updatedAt: "09:13 AM" },
    { floor: 2, room: "201", occupied: true, expected: 2, confirmed: 1, status: "RED",    role: ROLES.ASSEMBLY,     staffId: "AA-02",  note: "1 guest unaccounted for - report to coordinator", updatedAt: "09:15 AM" },
    { floor: 2, room: "202", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.ASSEMBLY,     staffId: "AA-02",  note: "All registered guests verified at assembly area", updatedAt: "09:14 AM" },
    { floor: 2, room: "203", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.SECURITY,     staffId: "SEC-01", note: "Confirmed safe at assembly area", updatedAt: "09:14 AM" },
    { floor: 3, room: "301", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.ASSEMBLY,     staffId: "AA-01",  note: "Verified at assembly area", updatedAt: "09:16 AM" },
    { floor: 3, room: "302", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.ASSEMBLY,     staffId: "AA-01",  note: "Verified at assembly area", updatedAt: "09:16 AM" },
    { floor: 3, room: "303", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: ROLES.HOUSEKEEPING, staffId: "HK-03",  note: "Verified at assembly area", updatedAt: "09:17 AM" }
  ];
}

function createInitialDB() {
  return {
    hotel: {
      name: "SAFE-STAY Grand Hotel",
      address: "Main Hospitality Avenue",
      assemblyArea: "North Parking Open Grounds (Assembly Point A)",
      googleFormUrl: "",
      googleSheetUrl: ""
    },
    activeIncident: {
      active: true,
      id: "INC-DEMO-001",
      title: "Simulated Fire Evacuation Drill",
      type: "Emergency Drill",
      assemblyArea: "North Parking Open Grounds (Assembly Point A)",
      startedAt: new Date().toISOString(),
      startedBy: "Emergency Coordinator (EC-01)",
      workflowStage: 3
    },
    rooms: createDemoRooms(),
    assistance: [
      { id: "AST-1", room: "102", type: "Mobility Support (Wheelchair / Walker)", role: ROLES.SECURITY, status: "Assisted at Assembly", notes: "Voluntarily disclosed at check-in; escorted safely.", updatedAt: formatTimeNow() },
      { id: "AST-2", room: "201", type: "Elderly / Child Escort", role: ROLES.COORDINATOR, status: "Needs Verification", notes: "Relay discreetly to emergency coordinator/responders.", updatedAt: formatTimeNow() }
    ],
    logs: [
      { id: "LOG-3", dateTime: formatDateTimeNow(), room: "201", status: "RED",    role: "Assembly-Area Team (AA-02)", message: "1 guest unaccounted for - report to coordinator (Confirmed: 1/2)" },
      { id: "LOG-2", dateTime: formatDateTimeNow(), room: "102", status: "YELLOW", role: "Front Office (FO-01)",       message: "Guests arrived; awaiting floor check confirmation (Confirmed: 3/3)" },
      { id: "LOG-1", dateTime: formatDateTimeNow(), room: "101", status: "GREEN",  role: "Assembly-Area Team (AA-01)", message: "All registered guests verified at assembly area (Confirmed: 2/2)" }
    ],
    incidentArchives: [],
    evaluations: [],
    users: createDefaultUsers()
  };
}

async function persistDB() {
  await dbAdapter.saveState(db);
}

// =========================================================
// REAL-TIME BROADCAST (Server-Sent Events)
// =========================================================

function broadcastUpdate(eventType = "state_updated") {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Keep Railway / reverse-proxy SSE connections alive with a heartbeat every 25s
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      sseClients.delete(res);
    }
  }
}, 25000);

// =========================================================
// HELPERS
// =========================================================

function formatTimeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTimeNow() {
  return new Date().toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  });
  return cookies;
}

async function getSession(req) {
  const cookies = parseCookies(req);
  return await dbAdapter.getSessionByToken(cookies.safestay_session);
}

function isHttpsRequest(req) {
  return req.headers["x-forwarded-proto"] === "https";
}

function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function addLog(room, status, user, message) {
  const source = user.staffId ? `${user.role} (${user.staffId})` : user.role;
  db.logs.unshift({
    id: "LOG-" + Date.now(),
    dateTime: formatDateTimeNow(),
    room: String(room),
    status: status,
    role: source,
    message: message
  });
  if (db.logs.length > 500) db.logs = db.logs.slice(0, 500);
}

function getPublicStateForUser(user) {
  const canViewAssistance = ASSISTANCE_AUTHORIZED_ROLES.includes(user.role);
  const canAdmin = user.role === ROLES.COORDINATOR;
  const lanIPs = getLanIPs();

  return {
    user: {
      username: user.username,
      name: user.name,
      role: user.role,
      staffId: user.staffId,
      canViewAssistance,
      canAdmin
    },
    serverInfo: {
      port: PORT,
      dbMode: dbAdapter.getDbMode(),
      lanUrls: lanIPs.map(ip => `http://${ip}:${PORT}`),
      connectedClients: sseClients.size
    },
    hotel: db.hotel,
    activeIncident: db.activeIncident,
    rooms: db.rooms,
    logs: db.logs,
    assistance: canViewAssistance ? db.assistance : null,
    incidentArchives: db.incidentArchives,
    evaluations: db.evaluations,
    users: canAdmin
      ? db.users.map(u => ({ username: u.username, name: u.name, role: u.role, staffId: u.staffId }))
      : null
  };
}

// =========================================================
// STATIC FILE SERVER
// =========================================================

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const cleanName = normalized.replace(/^[/\\]+/, "");

  // When serving from root directory, only allow frontend files
  if (PUBLIC_DIR === __dirname && !ALLOWED_ROOT_FILES.has(cleanName)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  const fullPath = path.join(PUBLIC_DIR, cleanName);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// =========================================================
// API ROUTER
// =========================================================

async function handleAPI(req, res, pathname) {
  const method = req.method;

  // --- HEALTHCHECK (Railway Monitoring) ---
  if (pathname === "/api/health" && method === "GET") {
    return sendJSON(res, 200, { ok: true, db: dbAdapter.getDbMode(), uptimeSec: Math.floor(process.uptime()) });
  }

  // --- AUTH: LOGIN ---
  if (pathname === "/api/login" && method === "POST") {
    const body = await readJSONBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    const account = db.users.find(u => u.username.toLowerCase() === username);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      return sendJSON(res, 401, { error: "Invalid username or password." });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const sessionUser = {
      username: account.username,
      name: account.name,
      role: account.role,
      staffId: account.staffId,
      createdAt: Date.now()
    };
    await dbAdapter.setSession(token, sessionUser);

    const secureFlag = isHttpsRequest(req) ? "; Secure" : "";
    return sendJSON(
      res,
      200,
      { ok: true, state: getPublicStateForUser(sessionUser) },
      { "Set-Cookie": `safestay_session=${token}; HttpOnly; Path=/; SameSite=Lax${secureFlag}` }
    );
  }

  // --- AUTH: LOGOUT ---
  if (pathname === "/api/logout" && method === "POST") {
    const cookies = parseCookies(req);
    if (cookies.safestay_session) await dbAdapter.deleteSession(cookies.safestay_session);
    return sendJSON(
      res,
      200,
      { ok: true },
      { "Set-Cookie": "safestay_session=; HttpOnly; Path=/; Max-Age=0" }
    );
  }

  // --- REQUIRE AUTH FOR ALL OTHER /api ROUTES ---
  const user = await getSession(req);
  if (!user) {
    return sendJSON(res, 401, { error: "Authentication required." });
  }

  // --- REAL-TIME SSE STREAM ---
  if (pathname === "/api/events" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);
    broadcastUpdate("clients_changed");
    req.on("close", () => {
      sseClients.delete(res);
      broadcastUpdate("clients_changed");
    });
    return;
  }

  // --- GET FULL STATE ---
  if (pathname === "/api/state" && method === "GET") {
    return sendJSON(res, 200, getPublicStateForUser(user));
  }

  // --- ROOMS: ADD ROOM ---
  if (pathname === "/api/rooms" && method === "POST") {
    if (![ROLES.COORDINATOR, ROLES.FRONT_OFFICE].includes(user.role)) {
      return sendJSON(res, 403, { error: "Only Front Office or Emergency Coordinator can add rooms." });
    }
    const body = await readJSONBody(req);
    const floor = Number(body.floor);
    const roomNum = String(body.room || "").trim();
    const expected = Number(body.expected);
    const occupied = expected > 0;

    if (!Number.isInteger(floor) || floor < 1 || floor > 50) {
      return sendJSON(res, 400, { error: "Floor must be a whole number between 1 and 50." });
    }
    if (!/^[a-zA-Z0-9-]{1,12}$/.test(roomNum)) {
      return sendJSON(res, 400, { error: "Room number must be 1-12 letters, numbers, or dashes." });
    }
    if (!Number.isInteger(expected) || expected < 0 || expected > 20) {
      return sendJSON(res, 400, { error: "Registered occupants must be a whole number between 0 and 20." });
    }
    if (db.rooms.some(r => r.room.toLowerCase() === roomNum.toLowerCase())) {
      return sendJSON(res, 409, { error: `Room ${roomNum} already exists.` });
    }

    const newRoom = {
      floor,
      room: roomNum,
      occupied,
      expected,
      confirmed: 0,
      status: occupied ? "YELLOW" : "GREEN",
      role: user.role,
      staffId: user.staffId,
      note: occupied ? "Registered occupancy added; pending verification" : "Vacant room",
      updatedAt: formatTimeNow()
    };

    db.rooms.push(newRoom);
    addLog(roomNum, newRoom.status, user, `Room added to Floor ${floor} (${expected} registered guest(s))`);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 201, { ok: true, room: newRoom });
  }

  // --- ROOMS: UPDATE STATUS / CHECK-IN ---
  if (pathname.startsWith("/api/rooms/") && method === "PUT") {
    const roomNum = decodeURIComponent(pathname.slice("/api/rooms/".length));
    const room = db.rooms.find(r => r.room === roomNum);
    if (!room) return sendJSON(res, 404, { error: "Room not found." });

    const body = await readJSONBody(req);
    const nextExpected = body.expected !== undefined ? Number(body.expected) : room.expected;
    const nextConfirmed = body.confirmed !== undefined ? Number(body.confirmed) : room.confirmed;

    if (!Number.isInteger(nextExpected) || nextExpected < 0 || nextExpected > 20) {
      return sendJSON(res, 400, { error: "Registered occupants must be a whole number between 0 and 20." });
    }
    if (!Number.isInteger(nextConfirmed) || nextConfirmed < 0 || nextConfirmed > nextExpected) {
      return sendJSON(res, 400, { error: `Confirmed guests (${nextConfirmed}) cannot exceed registered occupants (${nextExpected}).` });
    }

    room.expected = nextExpected;
    room.occupied = nextExpected > 0;
    room.confirmed = nextConfirmed;
    if (body.status && ["GREEN", "YELLOW", "RED"].includes(body.status)) {
      room.status = body.status;
    }
    if (body.note !== undefined) {
      room.note = String(body.note).trim().slice(0, 240) || "Status updated";
    }

    room.role = user.role;
    room.staffId = user.staffId;
    room.updatedAt = formatTimeNow();

    addLog(room.room, room.status, user, `${room.note} (Confirmed: ${room.confirmed}/${room.expected})`);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true, room });
  }

  // --- ROOMS: DELETE ROOM ---
  if (pathname.startsWith("/api/rooms/") && method === "DELETE") {
    if (![ROLES.COORDINATOR, ROLES.FRONT_OFFICE].includes(user.role)) {
      return sendJSON(res, 403, { error: "Only Front Office or Emergency Coordinator can remove rooms." });
    }
    const roomNum = decodeURIComponent(pathname.slice("/api/rooms/".length));
    db.rooms = db.rooms.filter(r => r.room !== roomNum);
    addLog(roomNum, "YELLOW", user, `Room ${roomNum} removed from monitoring board`);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true });
  }

  // --- INCIDENT: ACTIVATE EMERGENCY / DRILL ---
  if (pathname === "/api/incident/activate" && method === "POST") {
    if (![ROLES.COORDINATOR, ROLES.SECURITY].includes(user.role)) {
      return sendJSON(res, 403, { error: "Only Emergency Coordinator or Security can activate an emergency." });
    }
    const body = await readJSONBody(req);
    const title = String(body.title || "Emergency Evacuation").trim();
    const type = String(body.type || "Fire / Evacuation").trim();
    const assemblyArea = String(body.assemblyArea || db.hotel.assemblyArea).trim();

    db.activeIncident = {
      active: true,
      id: "INC-" + Date.now().toString().slice(-6),
      title,
      type,
      assemblyArea,
      startedAt: new Date().toISOString(),
      startedBy: `${user.name} (${user.staffId})`,
      workflowStage: 1
    };

    db.rooms.forEach(r => {
      r.confirmed = 0;
      r.status = r.expected > 0 ? "YELLOW" : "GREEN";
      r.note = r.expected > 0 ? "Emergency activated — awaiting safe verification" : "Vacant room";
      r.role = user.role;
      r.staffId = user.staffId;
      r.updatedAt = formatTimeNow();
    });

    db.assistance.forEach(a => { a.status = "Needs Verification"; });
    db.logs = [];
    addLog("SYSTEM", "RED", user, `EMERGENCY ACTIVATED: ${title} (${type}) — Assembly: ${assemblyArea}`);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true, activeIncident: db.activeIncident });
  }

  // --- INCIDENT: UPDATE WORKFLOW STAGE ---
  if (pathname === "/api/incident/workflow" && method === "PUT") {
    const body = await readJSONBody(req);
    const stage = Number(body.stage);
    if (!isNaN(stage) && stage >= 0 && stage <= 5) {
      db.activeIncident.workflowStage = stage;
      await persistDB();
      broadcastUpdate();
    }
    return sendJSON(res, 200, { ok: true });
  }

  // --- INCIDENT: CLOSE & ARCHIVE ---
  if (pathname === "/api/incident/close" && method === "POST") {
    if (user.role !== ROLES.COORDINATOR) {
      return sendJSON(res, 403, { error: "Only Emergency Coordinator can close and archive an incident." });
    }
    const body = await readJSONBody(req);
    const summaryNote = String(body.summaryNote || "Incident resolved and archived for post-incident review.").trim();

    const totalExpected = db.rooms.reduce((s, r) => s + Number(r.expected), 0);
    const totalConfirmed = db.rooms.reduce((s, r) => s + Number(r.confirmed), 0);
    const unresolvedCount = db.rooms.filter(r => r.status === "RED").length;

    const archiveEntry = {
      id: db.activeIncident.id || "INC-" + Date.now().toString().slice(-6),
      title: db.activeIncident.title || "Emergency Event",
      type: db.activeIncident.type || "Emergency",
      assemblyArea: db.activeIncident.assemblyArea || db.hotel.assemblyArea,
      startedAt: db.activeIncident.startedAt,
      closedAt: new Date().toISOString(),
      closedBy: `${user.name} (${user.staffId})`,
      totalRooms: db.rooms.length,
      totalExpected,
      totalConfirmed,
      unresolvedCount,
      summaryNote,
      logsSnapshot: db.logs.slice(0, 100)
    };

    db.incidentArchives.unshift(archiveEntry);
    db.activeIncident = {
      active: false,
      id: null,
      title: "Normal Hotel Operations",
      type: "Standby",
      assemblyArea: db.hotel.assemblyArea,
      startedAt: null,
      startedBy: null,
      workflowStage: 0
    };

    db.rooms.forEach(r => {
      r.confirmed = 0;
      r.status = "GREEN";
      r.note = r.expected > 0 ? "Normal operations — occupied" : "Vacant room";
      r.updatedAt = formatTimeNow();
    });

    addLog("SYSTEM", "GREEN", user, `Incident ${archiveEntry.id} closed & archived. ${summaryNote}`);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true, archive: archiveEntry });
  }

  // --- RESTRICTED ASSISTANCE RECORD ---
  if (pathname === "/api/assistance" && method === "POST") {
    if (!ASSISTANCE_AUTHORIZED_ROLES.includes(user.role)) {
      return sendJSON(res, 403, { error: "Restricted: Your role is not authorized to access Guest Assistance Records." });
    }
    const body = await readJSONBody(req);
    const entry = {
      id: "AST-" + Date.now(),
      room: String(body.room || "").trim(),
      type: String(body.type || "").trim(),
      role: String(body.role || user.role).trim(),
      status: "Needs Verification",
      notes: String(body.notes || "Coordinate discreetly.").trim(),
      updatedAt: formatTimeNow()
    };
    db.assistance.unshift(entry);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 201, { ok: true, entry });
  }

  if (pathname.startsWith("/api/assistance/") && method === "PUT") {
    if (!ASSISTANCE_AUTHORIZED_ROLES.includes(user.role)) return sendJSON(res, 403, { error: "Restricted access." });
    const id = decodeURIComponent(pathname.slice("/api/assistance/".length));
    const item = db.assistance.find(a => a.id === id);
    if (!item) return sendJSON(res, 404, { error: "Entry not found." });
    const body = await readJSONBody(req);
    if (body.status) item.status = body.status;
    item.updatedAt = formatTimeNow();
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true, item });
  }

  if (pathname.startsWith("/api/assistance/") && method === "DELETE") {
    if (!ASSISTANCE_AUTHORIZED_ROLES.includes(user.role)) return sendJSON(res, 403, { error: "Restricted access." });
    const id = decodeURIComponent(pathname.slice("/api/assistance/".length));
    db.assistance = db.assistance.filter(a => a.id !== id);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true });
  }

  // --- HOTEL SETTINGS ---
  if (pathname === "/api/hotel" && method === "PUT") {
    if (![ROLES.COORDINATOR, ROLES.FRONT_OFFICE].includes(user.role)) {
      return sendJSON(res, 403, { error: "Only Emergency Coordinator or Front Office can update hotel settings." });
    }
    const body = await readJSONBody(req);
    if (body.name !== undefined) db.hotel.name = String(body.name).trim() || db.hotel.name;
    if (body.address !== undefined) db.hotel.address = String(body.address).trim();
    if (body.assemblyArea !== undefined) db.hotel.assemblyArea = String(body.assemblyArea).trim();
    if (body.googleFormUrl !== undefined) db.hotel.googleFormUrl = String(body.googleFormUrl).trim();
    if (body.googleSheetUrl !== undefined) db.hotel.googleSheetUrl = String(body.googleSheetUrl).trim();
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true, hotel: db.hotel });
  }

  // --- STAFF ACCOUNT MANAGEMENT (Admin / Emergency Coordinator Only) ---
  if (pathname === "/api/users" && method === "POST") {
    if (user.role !== ROLES.COORDINATOR) return sendJSON(res, 403, { error: "Only Admin (Emergency Coordinator) can manage staff accounts." });
    const body = await readJSONBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim();
    const staffId = String(body.staffId || "").trim() || username.toUpperCase();
    const password = String(body.password || "");
    if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
      return sendJSON(res, 400, { error: "Username must be 3-24 characters (letters, numbers, _ or - only)." });
    }
    if (name.length < 2 || !Object.values(ROLES).includes(role) || password.length < 4) {
      return sendJSON(res, 400, { error: "Valid name, department role, and password (4+ chars) are required." });
    }
    if (db.users.some(u => u.username.toLowerCase() === username)) {
      return sendJSON(res, 409, { error: "Username already exists." });
    }
    db.users.push({ username, name, role, staffId: staffId.slice(0, 16), passwordHash: hashPassword(password) });
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 201, { ok: true });
  }

  if (pathname.startsWith("/api/users/") && method === "PUT") {
    if (user.role !== ROLES.COORDINATOR) return sendJSON(res, 403, { error: "Only Admin (Emergency Coordinator) can edit staff accounts." });
    const targetUsername = decodeURIComponent(pathname.slice("/api/users/".length)).toLowerCase();
    const target = db.users.find(u => u.username.toLowerCase() === targetUsername);
    if (!target) return sendJSON(res, 404, { error: "Staff account not found." });

    const body = await readJSONBody(req);
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim();
    const staffId = String(body.staffId || "").trim();
    const newPassword = String(body.password || "");

    if (name.length < 2) return sendJSON(res, 400, { error: "Full name must be at least 2 characters." });
    if (!Object.values(ROLES).includes(role)) return sendJSON(res, 400, { error: "Invalid department role." });
    if (targetUsername === user.username.toLowerCase() && role !== ROLES.COORDINATOR) {
      return sendJSON(res, 400, { error: "You cannot demote your own active Admin account." });
    }
    if (newPassword && newPassword.length < 4) {
      return sendJSON(res, 400, { error: "New password must be at least 4 characters." });
    }

    target.name = name;
    target.role = role;
    if (staffId) target.staffId = staffId.slice(0, 16);
    if (newPassword) target.passwordHash = hashPassword(newPassword);

    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname.startsWith("/api/users/") && method === "DELETE") {
    if (user.role !== ROLES.COORDINATOR) return sendJSON(res, 403, { error: "Only Admin (Emergency Coordinator) can remove staff accounts." });
    const targetUsername = decodeURIComponent(pathname.slice("/api/users/".length)).toLowerCase();
    if (targetUsername === user.username.toLowerCase()) return sendJSON(res, 400, { error: "Cannot delete your own active account." });
    db.users = db.users.filter(u => u.username.toLowerCase() !== targetUsername);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true });
  }

  // --- EVALUATIONS ---
  if (pathname === "/api/evaluations" && method === "POST") {
    const body = await readJSONBody(req);
    const entry = {
      id: "EVAL-" + Date.now(),
      dateTime: formatDateTimeNow(),
      reviewer: String(body.reviewer || user.name).trim(),
      clarity: Number(body.clarity) || 5,
      usability: Number(body.usability) || 5,
      accuracy: Number(body.accuracy) || 5,
      coordination: Number(body.coordination) || 5,
      backup: Number(body.backup) || 5,
      privacy: Number(body.privacy) || 5,
      comment: String(body.comment || "").trim()
    };
    db.evaluations.push(entry);
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 201, { ok: true, entry });
  }

  // --- RESET DEMO ---
  if (pathname === "/api/reset-demo" && method === "POST") {
    if (user.role !== ROLES.COORDINATOR) return sendJSON(res, 403, { error: "Only Emergency Coordinator can reset to the demo scenario." });
    const preservedUsers = db.users;
    const preservedArchives = db.incidentArchives;
    db = createInitialDB();
    db.users = preservedUsers;
    db.incidentArchives = preservedArchives;
    await persistDB();
    broadcastUpdate();
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { error: "API endpoint not found." });
}

// =========================================================
// BOOT SEQUENCE
// =========================================================

async function startServer() {
  db = await dbAdapter.initDatabase(createInitialDB);
  if (!db.users || db.users.length === 0) db.users = createDefaultUsers();
  if (!db.incidentArchives) db.incidentArchives = [];
  if (!db.evaluations) db.evaluations = [];

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (parsedUrl.pathname.startsWith("/api/")) {
        await handleAPI(req, res, parsedUrl.pathname);
      } else {
        serveStatic(req, res, parsedUrl.pathname);
      }
    } catch (err) {
      console.error("Server error:", err);
      if (!res.headersSent) {
        sendJSON(res, 500, { error: err.message || "Internal server error" });
      }
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("=======================================================");
    console.log(`  SAFE-STAY Server Running (DB: ${dbAdapter.getDbMode()})`);
    console.log(`  Port: ${PORT}`);
    console.log("=======================================================");
  });
}

startServer().catch(err => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
