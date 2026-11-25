/* =========================================================
   SAFE-STAY FULL SYSTEM FRONTEND CLIENT (public/app.js)
   Connects to server.js via REST API + live SSE real-time sync.
   Includes offline cache fallback for Paper Backup resilience.
   ========================================================= */

const WORKFLOW_STAGES = [
  "1. Normal Preparation",
  "2. Emergency Activation",
  "3. Safe Status Reporting",
  "4. Assembly Verification",
  "5. Escalate Unresolved",
  "6. Consolidation & Review"
];

let state = null;
let boardView = "cards";
let eventSource = null;
let incidentTimerInterval = null;
let pendingScannedRoom = new URLSearchParams(window.location.search).get("room");
let isLocalMode = window.location.protocol === "file:";

// =========================================================
// BUILT-IN LOCAL / OFFLINE FALLBACK ENGINE
// Ensures SAFE-STAY works 100% even if opened directly via
// file:// (double-clicking index.html) without starting server.js
// =========================================================

const LOCAL_DB_KEY = "safestay_local_full_db_v1";
const LOCAL_USER_KEY = "safestay_local_session_v1";
const ASSISTANCE_ROLES = ["Emergency Coordinator", "Front Office", "Security / Safety"];

function createLocalDefaultDB() {
  const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDT = new Date().toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
    rooms: [
      { floor: 1, room: "101", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Assembly-Area Team", staffId: "AA-01", note: "All registered guests verified at assembly area", updatedAt: "09:10 AM" },
      { floor: 1, room: "102", occupied: true, expected: 3, confirmed: 3, status: "YELLOW", role: "Front Office",       staffId: "FO-01", note: "Guests arrived; awaiting floor check confirmation", updatedAt: "09:12 AM" },
      { floor: 1, room: "103", occupied: true, expected: 1, confirmed: 1, status: "GREEN",  role: "Assembly-Area Team", staffId: "AA-01", note: "Verified at assembly area", updatedAt: "09:11 AM" },
      { floor: 1, room: "104", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Housekeeping",       staffId: "HK-02", note: "Floor update shared safely; guests verified", updatedAt: "09:13 AM" },
      { floor: 2, room: "201", occupied: true, expected: 2, confirmed: 1, status: "RED",    role: "Assembly-Area Team", staffId: "AA-02", note: "1 guest unaccounted for - report to coordinator", updatedAt: "09:15 AM" },
      { floor: 2, room: "202", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Assembly-Area Team", staffId: "AA-02", note: "All registered guests verified at assembly area", updatedAt: "09:14 AM" },
      { floor: 2, room: "203", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Security / Safety",  staffId: "SEC-01", note: "Confirmed safe at assembly area", updatedAt: "09:14 AM" },
      { floor: 3, room: "301", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Assembly-Area Team", staffId: "AA-01", note: "Verified at assembly area", updatedAt: "09:16 AM" },
      { floor: 3, room: "302", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Assembly-Area Team", staffId: "AA-01", note: "Verified at assembly area", updatedAt: "09:16 AM" },
      { floor: 3, room: "303", occupied: true, expected: 2, confirmed: 2, status: "GREEN",  role: "Housekeeping",       staffId: "HK-03", note: "Verified at assembly area", updatedAt: "09:17 AM" }
    ],
    assistance: [
      { id: "AST-1", room: "102", type: "Mobility Support (Wheelchair / Walker)", role: "Security / Safety", status: "Assisted at Assembly", notes: "Voluntarily disclosed at check-in; escorted safely.", updatedAt: nowTime },
      { id: "AST-2", room: "201", type: "Elderly / Child Escort", role: "Emergency Coordinator", status: "Needs Verification", notes: "Relay discreetly to emergency coordinator/responders.", updatedAt: nowTime }
    ],
    logs: [
      { id: "LOG-3", dateTime: nowDT, room: "201", status: "RED",    role: "Assembly-Area Team (AA-02)", message: "1 guest unaccounted for - report to coordinator (Confirmed: 1/2)" },
      { id: "LOG-2", dateTime: nowDT, room: "102", status: "YELLOW", role: "Front Office (FO-01)",       message: "Guests arrived; awaiting floor check confirmation (Confirmed: 3/3)" },
      { id: "LOG-1", dateTime: nowDT, room: "101", status: "GREEN",  role: "Assembly-Area Team (AA-01)", message: "All registered guests verified at assembly area (Confirmed: 2/2)" }
    ],
    incidentArchives: [],
    evaluations: [],
    users: [
      { username: "coordinator", name: "Emergency Coordinator", role: "Emergency Coordinator", staffId: "EC-01", password: "safe1234" },
      { username: "frontoffice", name: "Front Desk Officer",    role: "Front Office",          staffId: "FO-01", password: "safe1234" },
      { username: "housekeeping", name: "Housekeeping Lead",    role: "Housekeeping",          staffId: "HK-01", password: "safe1234" },
      { username: "security",     name: "Safety & Security",    role: "Security / Safety",     staffId: "SEC-01", password: "safe1234" },
      { username: "assembly",     name: "Assembly Team Lead",   role: "Assembly-Area Team",    staffId: "AA-01", password: "safe1234" }
    ]
  };
}

function getLocalDB() {
  const raw = localStorage.getItem(LOCAL_DB_KEY);
  if (raw) return JSON.parse(raw);
  const fresh = createLocalDefaultDB();
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveLocalDB(db) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function buildLocalState(db, user) {
  const canViewAssistance = ASSISTANCE_ROLES.includes(user.role);
  const canAdmin = user.role === "Emergency Coordinator";
  return {
    user: { username: user.username, name: user.name, role: user.role, staffId: user.staffId, canViewAssistance, canAdmin },
    serverInfo: { port: 3000, lanUrls: [], connectedClients: 1, localMode: true },
    hotel: db.hotel,
    activeIncident: db.activeIncident,
    rooms: db.rooms,
    logs: db.logs,
    assistance: canViewAssistance ? db.assistance : null,
    incidentArchives: db.incidentArchives,
    evaluations: db.evaluations,
    users: canAdmin ? db.users.map(u => ({ username: u.username, name: u.name, role: u.role, staffId: u.staffId })) : null
  };
}

function localApi(url, method = "GET", body = {}) {
  const db = getLocalDB();
  const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDT = new Date().toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  if (url === "/api/login" && method === "POST") {
    const uname = String(body.username || "").trim().toLowerCase();
    const acc = db.users.find(u => u.username.toLowerCase() === uname && u.password === body.password);
    if (!acc) throw new Error("Invalid username or password. (Default password: safe1234)");
    sessionStorage.setItem(LOCAL_USER_KEY, JSON.stringify(acc));
    return { ok: true, state: buildLocalState(db, acc) };
  }

  if (url === "/api/logout" && method === "POST") {
    sessionStorage.removeItem(LOCAL_USER_KEY);
    return { ok: true };
  }

  const rawUser = sessionStorage.getItem(LOCAL_USER_KEY);
  if (!rawUser) throw new Error("Authentication required.");
  const user = JSON.parse(rawUser);

  if (url === "/api/state" && method === "GET") {
    return buildLocalState(db, user);
  }

  const pushLog = (room, status, msg) => {
    db.logs.unshift({ id: "LOG-" + Date.now(), dateTime: nowDT, room: String(room), status, role: `${user.role} (${user.staffId})`, message: msg });
  };

  if (url === "/api/rooms" && method === "POST") {
    const roomNum = String(body.room || "").trim();
    if (db.rooms.some(r => r.room.toLowerCase() === roomNum.toLowerCase())) throw new Error(`Room ${roomNum} already exists.`);
    const expected = Math.max(0, Number(body.expected) || 0);
    db.rooms.push({
      floor: Number(body.floor), room: roomNum, occupied: expected > 0, expected, confirmed: 0,
      status: expected > 0 ? "YELLOW" : "GREEN", role: user.role, staffId: user.staffId,
      note: expected > 0 ? "Registered occupancy added; pending verification" : "Vacant room", updatedAt: nowTime
    });
    pushLog(roomNum, expected > 0 ? "YELLOW" : "GREEN", `Room added to Floor ${body.floor} (${expected} registered guest(s))`);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url.startsWith("/api/rooms/") && method === "PUT") {
    const roomNum = decodeURIComponent(url.slice("/api/rooms/".length));
    const room = db.rooms.find(r => r.room === roomNum);
    if (!room) throw new Error("Room not found.");
    if (body.expected !== undefined) { room.expected = Math.max(0, Number(body.expected)); room.occupied = room.expected > 0; }
    if (body.confirmed !== undefined) room.confirmed = Math.max(0, Number(body.confirmed));
    if (body.status) room.status = body.status;
    if (body.note !== undefined) room.note = String(body.note).trim() || "Status updated";
    room.role = user.role; room.staffId = user.staffId; room.updatedAt = nowTime;
    pushLog(room.room, room.status, `${room.note} (Confirmed: ${room.confirmed}/${room.expected})`);
    saveLocalDB(db);
    return { ok: true, room };
  }

  if (url.startsWith("/api/rooms/") && method === "DELETE") {
    const roomNum = decodeURIComponent(url.slice("/api/rooms/".length));
    db.rooms = db.rooms.filter(r => r.room !== roomNum);
    pushLog(roomNum, "YELLOW", `Room ${roomNum} removed from monitoring board`);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/incident/activate" && method === "POST") {
    db.activeIncident = {
      active: true, id: "INC-" + Date.now().toString().slice(-6),
      title: body.title || "Emergency Evacuation", type: body.type || "Emergency",
      assemblyArea: body.assemblyArea || db.hotel.assemblyArea,
      startedAt: new Date().toISOString(), startedBy: `${user.name} (${user.staffId})`, workflowStage: 1
    };
    db.rooms.forEach(r => { r.confirmed = 0; r.status = r.expected > 0 ? "YELLOW" : "GREEN"; r.note = r.expected > 0 ? "Emergency activated — awaiting safe verification" : "Vacant room"; r.updatedAt = nowTime; });
    db.assistance.forEach(a => { a.status = "Needs Verification"; });
    db.logs = [];
    pushLog("SYSTEM", "RED", `EMERGENCY ACTIVATED: ${db.activeIncident.title}`);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/incident/workflow" && method === "PUT") {
    db.activeIncident.workflowStage = Number(body.stage) || 0;
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/incident/close" && method === "POST") {
    const totalExpected = db.rooms.reduce((s, r) => s + Number(r.expected), 0);
    const totalConfirmed = db.rooms.reduce((s, r) => s + Number(r.confirmed), 0);
    const unresolvedCount = db.rooms.filter(r => r.status === "RED").length;
    db.incidentArchives.unshift({
      id: db.activeIncident.id || "INC-" + Date.now().toString().slice(-6),
      title: db.activeIncident.title, type: db.activeIncident.type, assemblyArea: db.activeIncident.assemblyArea,
      startedAt: db.activeIncident.startedAt, closedAt: new Date().toISOString(), closedBy: `${user.name} (${user.staffId})`,
      totalRooms: db.rooms.length, totalExpected, totalConfirmed, unresolvedCount, summaryNote: body.summaryNote || "Archived."
    });
    db.activeIncident = { active: false, id: null, title: "Normal Hotel Operations", type: "Standby", assemblyArea: db.hotel.assemblyArea, startedAt: null, startedBy: null, workflowStage: 0 };
    db.rooms.forEach(r => { r.confirmed = 0; r.status = "GREEN"; r.note = r.expected > 0 ? "Normal operations — occupied" : "Vacant room"; r.updatedAt = nowTime; });
    pushLog("SYSTEM", "GREEN", `Incident closed & archived.`);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/assistance" && method === "POST") {
    if (!ASSISTANCE_ROLES.includes(user.role)) throw new Error("Restricted access.");
    db.assistance.unshift({ id: "AST-" + Date.now(), room: body.room, type: body.type, role: body.role || user.role, status: "Needs Verification", notes: body.notes || "Coordinate discreetly.", updatedAt: nowTime });
    saveLocalDB(db);
    return { ok: true };
  }

  if (url.startsWith("/api/assistance/") && method === "PUT") {
    const id = decodeURIComponent(url.slice("/api/assistance/".length));
    const item = db.assistance.find(a => a.id === id);
    if (item && body.status) item.status = body.status;
    saveLocalDB(db);
    return { ok: true };
  }

  if (url.startsWith("/api/assistance/") && method === "DELETE") {
    const id = decodeURIComponent(url.slice("/api/assistance/".length));
    db.assistance = db.assistance.filter(a => a.id !== id);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/hotel" && method === "PUT") {
    Object.assign(db.hotel, body);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/users" && method === "POST") {
    db.users.push({ username: body.username.toLowerCase(), name: body.name, role: body.role, staffId: body.username.toUpperCase(), password: body.password });
    saveLocalDB(db);
    return { ok: true };
  }

  if (url.startsWith("/api/users/") && method === "DELETE") {
    const u = decodeURIComponent(url.slice("/api/users/".length)).toLowerCase();
    db.users = db.users.filter(x => x.username.toLowerCase() !== u);
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/evaluations" && method === "POST") {
    db.evaluations.push({ id: "EVAL-" + Date.now(), dateTime: nowDT, reviewer: body.reviewer || user.name, clarity: body.clarity, usability: body.usability, accuracy: body.accuracy, coordination: body.coordination, backup: body.backup, privacy: body.privacy, comment: body.comment || "" });
    saveLocalDB(db);
    return { ok: true };
  }

  if (url === "/api/reset-demo" && method === "POST") {
    const fresh = createLocalDefaultDB();
    saveLocalDB(fresh);
    return { ok: true };
  }

  return { ok: true };
}

// =========================================================
// API HELPER (Auto-switches to Local Mode if opened via file://)
// =========================================================

async function api(url, method = "GET", body = null) {
  if (isLocalMode) {
    return localApi(url, method, body || {});
  }
  try {
    const options = { method, headers: {} };
    if (body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    // If server is unreachable (TypeError: Failed to fetch), fall back cleanly to Local Mode
    if (err instanceof TypeError) {
      isLocalMode = true;
      return localApi(url, method, body || {});
    }
    throw err;
  }
}

// =========================================================
// AUTHENTICATION & STARTUP
// =========================================================

async function initApp() {
  document.body.classList.add("print-mode-backup");
  try {
    const data = await api("/api/state");
    onAuthenticated(data);
  } catch {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
  const mobNav = document.getElementById("mobileBottomNav");
  if (mobNav) mobNav.classList.add("hidden");
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function fillRole(username) {
  document.getElementById("loginUsername").value = username;
  document.getElementById("loginPassword").value = "safe1234";
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";

  if (!username || !password) {
    errEl.textContent = "Please enter both your staff username and password.";
    return;
  }

  try {
    const res = await api("/api/login", "POST", { username, password });
    onAuthenticated(res.state);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleLogout() {
  const ok = await confirmAction({
    title: "Sign Out of SAFE-STAY?",
    message: "You will be signed out of this device and will need to sign in again to submit or view live updates.",
    okText: "Sign Out",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api("/api/logout", "POST");
  } catch {}
  state = null;
  showLoginScreen();
  showToast("Signed out safely.");
}

let activeTabId = "dashboardTab";
let alertSoundEnabled = localStorage.getItem("safestay_sound") !== "off";
let lastRedCount = 0;

function onAuthenticated(initialState) {
  state = initialState;
  lastRedCount = (state.rooms || []).filter(r => r.status === "RED").length;
  cacheOfflineState(state);

  if (localStorage.getItem("safestay_large_text") === "on") {
    document.body.classList.add("large-text");
  }
  updateSoundButtonUI();

  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("mobileBottomNav").classList.remove("hidden");

  activeTabId = "dashboardTab";
  renderAll();
  navigateTo("dashboardTab");
  prefillUpdateForm();
  populateHotelSettingsForm();
  connectRealTimeSync();
  startIncidentClock();

  // If staff scanned a room QR code on their phone, open that room immediately after login!
  if (pendingScannedRoom && state.rooms.some(r => r.room === pendingScannedRoom)) {
    openQuickEditModal(pendingScannedRoom);
    showToast(`QR Code opened Room ${pendingScannedRoom}.`);
    pendingScannedRoom = null;
  }
}

// =========================================================
// REAL-TIME MULTI-DEVICE SYNC (SSE)
// =========================================================

function connectRealTimeSync() {
  if (isLocalMode) {
    setSyncStatus("local");
    return;
  }
  if (eventSource) eventSource.close();
  eventSource = new EventSource("/api/events");

  eventSource.addEventListener("connected", () => {
    setSyncStatus("live");
  });

  eventSource.addEventListener("state_updated", async () => {
    await refreshState(true);
  });

  eventSource.addEventListener("clients_changed", async () => {
    await refreshState(false);
  });

  eventSource.onerror = () => {
    setSyncStatus("offline");
  };
}

function setSyncStatus(mode) {
  const el = document.getElementById("syncIndicator");
  if (!el) return;
  if (mode === "live" || mode === true) {
    const isPg = state && state.serverInfo && state.serverInfo.dbMode === "postgresql";
    const devices = state && state.serverInfo && state.serverInfo.connectedClients ? state.serverInfo.connectedClients : 1;
    const deviceLabel = devices > 1 ? ` &bull; ${devices} online` : "";
    el.className = "sync-badge sync-live";
    el.innerHTML = (isPg ? "&#9679; LIVE SYNC (PostgreSQL)" : "&#9679; LIVE SYNC") + deviceLabel;
  } else if (mode === "local") {
    el.className = "sync-badge sync-local";
    el.innerHTML = "&#9679; LOCAL MODE";
  } else {
    el.className = "sync-badge sync-offline";
    el.innerHTML = "&#9679; OFFLINE &mdash; PAPER BACKUP";
  }
}

async function refreshState(checkAlert = false) {
  try {
    state = await api("/api/state");
    cacheOfflineState(state);
    setSyncStatus(isLocalMode ? "local" : "live");

    const newRedCount = (state.rooms || []).filter(r => r.status === "RED").length;
    if (checkAlert && newRedCount > lastRedCount) {
      playRedAlertChime();
      showToast("URGENT: New RED unresolved escalation reported!");
    }
    lastRedCount = newRedCount;

    renderAll();
  } catch {
    setSyncStatus("offline");
  }
}

function cacheOfflineState(data) {
  try {
    localStorage.setItem("safestay_offline_cache", JSON.stringify(data));
  } catch {}
}

// =========================================================
// SIDEBAR NAVIGATION, VIEW TOGGLE & PRINT MODES
// =========================================================

function renderSidebarNav() {
  const navEl = document.getElementById("sidebarNav");
  if (!navEl || !state) return;
  const cfg = getRoleConfig(state.user.role);

  navEl.innerHTML = cfg.nav.map(item => `
    <button class="nav-item ${item.id === activeTabId ? "active" : ""}" onclick="navigateTo('${item.id}')">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `).join("");
}

function navigateTo(tabId) {
  const cfg = getRoleConfig(state.user.role);
  const allowedIds = cfg.nav.map(n => n.id);
  const targetId = allowedIds.includes(tabId) ? tabId : "dashboardTab";
  activeTabId = targetId;

  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const targetPanel = document.getElementById(targetId);
  if (targetPanel) targetPanel.classList.add("active");

  const navMatch = cfg.nav.find(n => n.id === targetId);
  const titleEl = document.getElementById("activePageTitle");
  if (titleEl && navMatch) {
    titleEl.textContent = targetId === "dashboardTab" ? cfg.dashboardTitle : navMatch.label;
  }

  renderSidebarNav();
  renderMobileBottomNav();
  toggleSidebar(false);
}

function renderMobileBottomNav() {
  const bar = document.getElementById("mobileBottomNav");
  if (!bar || !state) return;
  const cfg = getRoleConfig(state.user.role);
  const top3 = cfg.nav.slice(0, 3);

  bar.innerHTML = top3.map(item => `
    <button class="mob-nav-btn ${item.id === activeTabId ? "active" : ""}" onclick="navigateTo('${item.id}')">
      <span class="mob-icon">${item.icon}</span>
      <span>${item.label.split(" ")[0]}</span>
    </button>
  `).join("") + `
    <button class="mob-nav-btn" onclick="toggleSidebar(true)">
      <span class="mob-icon">&#9776;</span>
      <span>Menu</span>
    </button>
  `;
}

function toggleSidebar(open) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar || !overlay) return;
  sidebar.classList.toggle("open", open);
  overlay.classList.toggle("hidden", !open);
}

function setBoardView(view) {
  boardView = view;
  document.getElementById("btnViewCards").classList.toggle("active", view === "cards");
  document.getElementById("btnViewTable").classList.toggle("active", view === "table");
  renderMonitoringBoard();
}

function printSection(mode) {
  document.body.classList.remove("print-mode-backup", "print-mode-qr", "print-mode-cards", "print-mode-brief");
  document.body.classList.add(`print-mode-${mode}`);
  updatePrintHeader();
  window.print();
}

// =========================================================
// RENDER EVERYTHING
// =========================================================

function renderAll() {
  if (!state) return;

  // Header & Role Permissions
  document.getElementById("hotelTitle").textContent = state.hotel.name;
  document.getElementById("hotelAssemblySubtitle").textContent = `Assembly: ${state.hotel.assemblyArea}`;
  document.getElementById("currentUserName").textContent = `${state.user.name} (${state.user.staffId})`;
  document.getElementById("currentUserRole").textContent = state.user.role;

  const canManageRooms = ["Emergency Coordinator", "Front Office"].includes(state.user.role);
  document.getElementById("btnAddRoom").classList.toggle("hidden", !canManageRooms);
  document.getElementById("btnDeleteRoom").classList.toggle("hidden", !canManageRooms);
  document.getElementById("coordinatorDemoBox").classList.toggle("hidden", !state.user.canAdmin);

  renderSidebarNav();
  renderRoleDashboard(state);
  renderIncidentBar();
  renderSummary();
  renderEscalationBanner();
  renderWorkflowSteps();
  renderMonitoringBoard();
  renderAccountabilityTable();
  renderRoomDropdowns();
  renderActivityLog();
  renderAssistanceSection();
  renderQRLabels();
  renderIncidentArchives();
  renderStaffManagement();
  renderEvaluationSummary();
  updatePrintHeader();
}

function renderIncidentBar() {
  const bar = document.getElementById("incidentBar");
  const inc = state.activeIncident;
  const canActivate = ["Emergency Coordinator", "Security / Safety"].includes(state.user.role);

  if (inc && inc.active) {
    bar.className = "incident-bar incident-active no-print";
    bar.innerHTML = `
      <div>
        <strong>ACTIVE EMERGENCY: ${escapeHTML(inc.title)}</strong>
        <div class="incident-meta">
          ID: ${escapeHTML(inc.id)} &bull; Type: ${escapeHTML(inc.type)} &bull;
          Elapsed: <strong id="incidentElapsed">00:00:00</strong> &bull;
          Assembly: ${escapeHTML(inc.assemblyArea)}
        </div>
      </div>
      <div class="filter-bar">
        ${state.user.canAdmin ? `<button class="btn btn-warning btn-small" onclick="openCloseIncidentModal()">Close &amp; Archive Incident</button>` : ""}
      </div>
    `;
    updateIncidentElapsed();
  } else {
    bar.className = "incident-bar incident-standby no-print";
    bar.innerHTML = `
      <div>
        <strong>NORMAL HOTEL OPERATIONS (Standby)</strong>
        <div class="incident-meta">
          Front Office maintains occupancy &amp; assistance records. Activate emergency mode when an official alarm or drill begins.
        </div>
      </div>
      <div class="filter-bar">
        ${canActivate ? `<button class="btn btn-danger btn-small" onclick="openActivateModal()">Activate Emergency / Drill</button>` : ""}
      </div>
    `;
  }
}

function startIncidentClock() {
  if (incidentTimerInterval) clearInterval(incidentTimerInterval);
  incidentTimerInterval = setInterval(updateIncidentElapsed, 1000);
}

function updateIncidentElapsed() {
  const el = document.getElementById("incidentElapsed");
  if (!el || !state || !state.activeIncident || !state.activeIncident.startedAt) return;
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(state.activeIncident.startedAt).getTime()) / 1000));
  const hrs = String(Math.floor(diffSec / 3600)).padStart(2, "0");
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
  const secs = String(diffSec % 60).padStart(2, "0");
  el.textContent = `${hrs}:${mins}:${secs}`;
}

function renderSummary() {
  let expected = 0, confirmed = 0, green = 0, yellow = 0, red = 0;

  state.rooms.forEach(r => {
    expected += Number(r.expected);
    confirmed += Number(r.confirmed);
    if (r.status === "GREEN") green++;
    if (r.status === "YELLOW") yellow++;
    if (r.status === "RED") red++;
  });

  const unaccounted = Math.max(0, expected - confirmed);
  const pct = expected > 0 ? Math.round((confirmed / expected) * 100) : 100;

  document.getElementById("statTotalRooms").textContent = state.rooms.length;
  document.getElementById("statExpectedGuests").textContent = expected;
  document.getElementById("statConfirmedGuests").textContent = confirmed;
  document.getElementById("statUnaccountedGuests").textContent = unaccounted;
  document.getElementById("statGreen").textContent = green;
  document.getElementById("statYellow").textContent = yellow;
  document.getElementById("statRed").textContent = red;

  document.getElementById("progressText").textContent = `${confirmed} / ${expected} Guests Confirmed (${pct}%)`;
  document.getElementById("progressFill").style.width = `${pct}%`;
}

function renderEscalationBanner() {
  const banner = document.getElementById("escalationBanner");
  const redRooms = state.rooms.filter(r => r.status === "RED");

  if (redRooms.length > 0) {
    const roomList = redRooms.map(r => `Room ${escapeHTML(r.room)}`).join(", ");
    banner.className = "escalation-banner escalation-alert no-print";
    banner.innerHTML = `
      <div>
        <strong>URGENT ESCALATION (${redRooms.length} Unresolved):</strong>
        ${roomList} require immediate communication to the Emergency Coordinator &amp; Responders.
        <em>Staff must NOT independently re-enter the building.</em>
      </div>
      <button class="btn btn-danger btn-small" onclick="focusRedRooms()">Filter Unresolved</button>
    `;
  } else if (state.activeIncident.active && state.rooms.every(r => r.status === "GREEN")) {
    banner.className = "escalation-banner escalation-clear no-print";
    banner.innerHTML = `
      <div><strong>ALL ROOMS VERIFIED:</strong> No unresolved accountability cases reported. Preserve records for post-incident review.</div>
    `;
  } else {
    banner.className = "escalation-banner hidden no-print";
  }
}

function focusRedRooms() {
  navigateTo("boardTab");
  document.getElementById("boardFilter").value = "RED";
  renderMonitoringBoard();
}

function renderWorkflowSteps() {
  const container = document.getElementById("workflowSteps");
  const current = state.activeIncident.workflowStage || 0;
  container.innerHTML = WORKFLOW_STAGES.map((label, idx) => {
    let cls = "workflow-step";
    if (idx < current) cls += " done";
    if (idx === current) cls += " active";
    return `<button class="${cls}" onclick="setWorkflowStage(${idx})">${escapeHTML(label)}</button>`;
  }).join("");
}

async function setWorkflowStage(stage) {
  try {
    await api("/api/incident/workflow", "PUT", { stage });
    await refreshState();
  } catch (err) {
    showToast(err.message);
  }
}

function renderMonitoringBoard() {
  const container = document.getElementById("monitoringBoard");
  const filter = document.getElementById("boardFilter").value;
  const filteredRooms = state.rooms.filter(r => filter === "ALL" || r.status === filter);

  if (filteredRooms.length === 0) {
    container.innerHTML = `<div class="card"><p class="muted">No rooms match the selected status filter.</p></div>`;
    return;
  }

  if (boardView === "table") {
    const sorted = [...filteredRooms].sort((a, b) => b.floor - a.floor || a.room.localeCompare(b.room));
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Floor</th>
              <th>Room / Zone</th>
              <th>Latest Status</th>
              <th>Guests (Confirmed / Expected)</th>
              <th>Time Updated</th>
              <th>Source / Role</th>
              <th>Verified Note</th>
              <th class="no-print">Action</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(r => `
              <tr class="row-${r.status}">
                <td>Floor ${escapeHTML(r.floor)}</td>
                <td><strong>Room ${escapeHTML(r.room)}</strong></td>
                <td><span class="status-badge badge-${r.status}">${r.status}</span></td>
                <td>${r.confirmed} / ${r.expected}</td>
                <td>${escapeHTML(r.updatedAt)}</td>
                <td>${escapeHTML(formatSource(r))}</td>
                <td>${escapeHTML(r.note)}</td>
                <td class="no-print">
                  <button class="btn btn-outline btn-small" onclick="openQuickEditModal('${escapeHTML(r.room)}')">Update</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  const floors = {};
  filteredRooms.forEach(r => {
    if (!floors[r.floor]) floors[r.floor] = [];
    floors[r.floor].push(r);
  });

  const floorNumbers = Object.keys(floors).sort((a, b) => Number(b) - Number(a));
  container.innerHTML = floorNumbers.map(floorNum => {
    const roomsOnFloor = floors[floorNum].sort((a, b) => a.room.localeCompare(b.room));
    const fConf = roomsOnFloor.reduce((s, r) => s + Number(r.confirmed), 0);
    const fExp = roomsOnFloor.reduce((s, r) => s + Number(r.expected), 0);
    return `
      <div class="floor-section">
        <div class="floor-header">
          <span class="floor-title">Floor ${escapeHTML(floorNum)}</span>
          <span class="floor-stats">Assembly Verified: ${fConf} / ${fExp} guest(s)</span>
        </div>
        <div class="room-grid">
          ${roomsOnFloor.map(r => `
            <div class="room-card status-${r.status}" onclick="openQuickEditModal('${escapeHTML(r.room)}')">
              <div class="room-card-top">
                <span class="room-number">Room ${escapeHTML(r.room)}</span>
                <span class="status-badge badge-${r.status}">${r.status}</span>
              </div>
              <div class="room-guests">Assembly: ${r.confirmed} / ${r.expected} guest(s)</div>
              <div class="room-note">${escapeHTML(r.note || "No notes")}</div>
              <div class="room-meta">${escapeHTML(r.updatedAt)} &bull; ${escapeHTML(formatSource(r))}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderAccountabilityTable() {
  const tbody = document.getElementById("accountabilityTableBody");
  const search = document.getElementById("searchRoom").value.trim().toLowerCase();
  const accFilter = document.getElementById("accountabilityFilter").value;

  const filtered = state.rooms
    .filter(r => r.room.toLowerCase().includes(search))
    .filter(r => {
      const missing = Math.max(0, r.expected - r.confirmed);
      if (accFilter === "MISSING") return missing > 0 || r.status === "RED";
      if (accFilter === "CONFIRMED") return missing === 0 && r.status === "GREEN";
      return true;
    })
    .sort((a, b) => a.floor - b.floor || a.room.localeCompare(b.room));

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No rooms match your filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const missing = Math.max(0, r.expected - r.confirmed);
    return `
      <tr class="row-${r.status}">
        <td>Floor ${escapeHTML(r.floor)}</td>
        <td><strong>${escapeHTML(r.room)}</strong></td>
        <td>${r.expected}</td>
        <td><strong>${r.confirmed}</strong></td>
        <td class="${missing > 0 ? "text-red" : "text-green"}"><strong>${missing}</strong></td>
        <td><span class="status-badge badge-${r.status}">${getAccountabilityLabel(r.status)} (${r.status})</span></td>
        <td>${escapeHTML(r.note)}</td>
        <td>${escapeHTML(formatSource(r))}<br /><span class="muted">${escapeHTML(r.updatedAt)}</span></td>
        <td class="no-print">
          <button class="btn btn-primary btn-small" onclick="adjustConfirmed('${escapeHTML(r.room)}', 1)">+1 Arrived</button>
          <button class="btn btn-outline btn-small" onclick="adjustConfirmed('${escapeHTML(r.room)}', -1)">-1</button>
          ${missing > 0 && r.status !== "RED" ? `<button class="btn btn-danger btn-small" onclick="escalateRoom('${escapeHTML(r.room)}')">Escalate</button>` : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function renderRoomDropdowns() {
  const sorted = [...state.rooms].sort((a, b) => a.floor - b.floor || a.room.localeCompare(b.room));
  const options = sorted.map(r =>
    `<option value="${escapeHTML(r.room)}">Floor ${r.floor} - Room ${escapeHTML(r.room)} (${r.status})</option>`
  ).join("");

  const formRoom = document.getElementById("formRoom");
  const assistRoom = document.getElementById("assistRoom");
  const prevForm = formRoom.value;
  const prevAssist = assistRoom.value;

  formRoom.innerHTML = options;
  assistRoom.innerHTML = options;

  if (prevForm && sorted.some(r => r.room === prevForm)) formRoom.value = prevForm;
  if (prevAssist && sorted.some(r => r.room === prevAssist)) assistRoom.value = prevAssist;
}

function renderActivityLog() {
  const container = document.getElementById("activityLog");
  if (!state.logs || state.logs.length === 0) {
    container.innerHTML = `<p class="muted">No updates recorded yet.</p>`;
    return;
  }

  container.innerHTML = state.logs.map(log => `
    <div class="log-item log-${log.status}">
      <strong>Room ${escapeHTML(log.room)}</strong> &mdash;
      <span class="status-badge badge-${log.status}">${log.status}</span>
      <div style="margin-top:4px;">${escapeHTML(log.message)}</div>
      <div class="muted" style="font-size:0.78rem; margin-top:4px;">
        ${escapeHTML(log.dateTime)} &bull; ${escapeHTML(log.role)}
      </div>
    </div>
  `).join("");
}

function renderAssistanceSection() {
  const denied = document.getElementById("assistanceDenied");
  const allowed = document.getElementById("assistanceAuthorized");

  if (!state.user.canViewAssistance || state.assistance === null) {
    denied.classList.remove("hidden");
    allowed.classList.add("hidden");
    return;
  }

  denied.classList.add("hidden");
  allowed.classList.remove("hidden");

  const tbody = document.getElementById("assistanceTableBody");
  if (state.assistance.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No confidential assistance arrangements recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.assistance.map(item => `
    <tr>
      <td><strong>Room ${escapeHTML(item.room)}</strong></td>
      <td>${escapeHTML(item.type)}</td>
      <td>${escapeHTML(item.role)}</td>
      <td>
        <span class="status-badge ${item.status === "Assisted at Assembly" ? "badge-GREEN" : "badge-YELLOW"}">
          ${escapeHTML(item.status)}
        </span>
      </td>
      <td>${escapeHTML(item.notes)}</td>
      <td class="no-print">
        <button class="btn btn-outline btn-small" onclick="toggleAssistanceStatus('${escapeHTML(item.id)}', '${escapeHTML(item.status)}')">
          ${item.status === "Assisted at Assembly" ? "Mark Pending" : "Mark Assisted"}
        </button>
        <button class="btn btn-outline btn-small" onclick="deleteAssistance('${escapeHTML(item.id)}')">Remove</button>
      </td>
    </tr>
  `).join("");
}

function renderQRLabels() {
  const grid = document.getElementById("qrGrid");
  const infoBox = document.getElementById("lanInfoBox");
  if (!grid || typeof SafeStayQR === "undefined") return;

  const isCloudHost = !isLocalMode && !["localhost", "127.0.0.1"].includes(window.location.hostname);
  const lanBase = isCloudHost
    ? window.location.origin
    : ((state.serverInfo && state.serverInfo.lanUrls && state.serverInfo.lanUrls[0])
        ? state.serverInfo.lanUrls[0]
        : (isLocalMode ? "http://localhost:3000" : window.location.origin));

  infoBox.innerHTML = isLocalMode
    ? `<strong>Local Mode Tip:</strong> You opened the file directly. To scan QR codes from phones in real time, deploy to Railway or run <strong>START-SAFE-STAY.bat</strong>.`
    : isCloudHost
      ? `<strong>Live Cloud QR Access:</strong> Any staff phone with internet or Wi-Fi can scan these QR stickers to open <code>${escapeHTML(lanBase)}</code> directly to that room!`
      : `<strong>Live Mobile QR Access:</strong> Phones on the same Wi-Fi can open <code>${escapeHTML(lanBase)}</code> or scan any room QR sticker below for live sync!`;

  const mode = document.getElementById("qrMode").value;
  const sorted = [...state.rooms].sort((a, b) => a.floor - b.floor || a.room.localeCompare(b.room));

  grid.innerHTML = sorted.map(r => {
    let payload = "";
    if (mode === "lan") {
      payload = `${lanBase}/?room=${encodeURIComponent(r.room)}`;
    } else if (mode === "googleform") {
      payload = state.hotel.googleFormUrl || `SAFE-STAY | Room ${r.room} | Add Google Form URL in Settings`;
    } else {
      payload = `SAFE-STAY | Floor ${r.floor} | Room ${r.room} | Verify safely at assembly area`;
    }

    const svg = SafeStayQR.toSVG(payload, 145);
    return `
      <div class="qr-card">
        <div class="qr-card-title">SAFE-STAY &bull; Room ${escapeHTML(r.room)}</div>
        <div class="qr-card-sub">Floor ${escapeHTML(r.floor)} &bull; Authorized Staff Scan</div>
        <div class="qr-svg-wrap">${svg}</div>
        <div class="qr-payload">${escapeHTML(payload)}</div>
        <button class="btn btn-outline btn-small no-print" onclick="openQuickEditModal('${escapeHTML(r.room)}')">
          Simulate Scan
        </button>
      </div>
    `;
  }).join("");
}

function renderIncidentArchives() {
  const container = document.getElementById("incidentArchivesList");
  if (!state.incidentArchives || state.incidentArchives.length === 0) {
    container.innerHTML = `<p class="muted">No archived incidents yet. When an active emergency or drill is closed by the Emergency Coordinator, its full summary is preserved here.</p>`;
    return;
  }

  container.innerHTML = state.incidentArchives.map(a => `
    <div class="archive-card">
      <strong>${escapeHTML(a.id)} &mdash; ${escapeHTML(a.title)}</strong> (${escapeHTML(a.type)})
      <div class="muted" style="margin-top:4px;">
        Assembly: ${escapeHTML(a.assemblyArea)} &bull;
        Confirmed: <strong>${a.totalConfirmed}/${a.totalExpected}</strong> guests &bull;
        Unresolved at close: <strong>${a.unresolvedCount}</strong>
      </div>
      <div style="margin-top:4px;">Summary: ${escapeHTML(a.summaryNote)}</div>
      <div class="muted" style="font-size:0.78rem; margin-top:4px;">
        Closed by ${escapeHTML(a.closedBy)} on ${new Date(a.closedAt).toLocaleString()}
      </div>
    </div>
  `).join("");
}

function renderStaffManagement() {
  const box = document.getElementById("staffManagementArea");
  if (!state.user.canAdmin || !state.users) {
    box.innerHTML = `<p class="muted">Only the <strong>Emergency Coordinator</strong> can add or remove staff accounts.</p>`;
    return;
  }

  box.innerHTML = `
    <div class="table-wrap" style="margin-bottom:14px;">
      <table>
        <thead>
          <tr><th>Username</th><th>Name</th><th>Role</th><th>ID</th><th></th></tr>
        </thead>
        <tbody>
          ${state.users.map(u => `
            <tr>
              <td><code>${escapeHTML(u.username)}</code></td>
              <td>${escapeHTML(u.name)}</td>
              <td>${escapeHTML(u.role)}</td>
              <td>${escapeHTML(u.staffId)}</td>
              <td>
                ${u.username !== state.user.username
                  ? `<button class="btn btn-outline btn-small text-red" onclick="deleteStaffUser('${escapeHTML(u.username)}')">Remove</button>`
                  : `<span class="muted">You</span>`}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <form onsubmit="handleAddStaffUser(event)">
      <div class="form-row">
        <div class="form-group"><label>Username</label><input id="newStaffUser" required placeholder="e.g., desk2" /></div>
        <div class="form-group"><label>Full Name</label><input id="newStaffName" required placeholder="e.g., Maria Santos" /></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Department Role</label>
          <select id="newStaffRole">
            <option value="Front Office">Front Office</option>
            <option value="Housekeeping">Housekeeping</option>
            <option value="Security / Safety">Security / Safety</option>
            <option value="Assembly-Area Team">Assembly-Area Team</option>
            <option value="Emergency Coordinator">Emergency Coordinator</option>
          </select>
        </div>
        <div class="form-group"><label>Staff ID &amp; Password</label><input id="newStaffPass" type="password" required placeholder="Min 4 chars" /></div>
      </div>
      <button type="submit" class="btn btn-primary btn-small">Add Authorized Staff Account</button>
    </form>
  `;
}

function renderEvaluationSummary() {
  const box = document.getElementById("evaluationSummary");
  const evals = state.evaluations || [];
  if (evals.length === 0) {
    box.innerHTML = `<p class="muted">No evaluation responses submitted yet.</p>`;
    return;
  }
  const avg = key => (evals.reduce((s, e) => s + Number(e[key]), 0) / evals.length).toFixed(1);
  const comments = evals.filter(e => e.comment).slice(-5).reverse()
    .map(e => `<li><strong>${escapeHTML(e.reviewer)}</strong> (${escapeHTML(e.dateTime)}): "${escapeHTML(e.comment)}"</li>`)
    .join("");

  box.innerHTML = `
    <strong>Submitted Evaluations: ${evals.length}</strong>
    <div class="eval-scores-bar">
      <span class="eval-chip">Clarity: ${avg("clarity")}/5</span>
      <span class="eval-chip">Usability: ${avg("usability")}/5</span>
      <span class="eval-chip">Accuracy: ${avg("accuracy")}/5</span>
      <span class="eval-chip">Coordination: ${avg("coordination")}/5</span>
      <span class="eval-chip">Backup: ${avg("backup")}/5</span>
      <span class="eval-chip">Privacy &amp; Safety: ${avg("privacy")}/5</span>
    </div>
    ${comments ? `<ul class="guide-list">${comments}</ul>` : ""}
  `;
}

// =========================================================
// USER ACTIONS (ROOMS, INCIDENTS, ASSISTANCE, SETTINGS)
// =========================================================

function openQuickEditModal(roomNumber) {
  const room = state.rooms.find(r => r.room === roomNumber);
  if (!room) return;
  document.getElementById("quickEditTitle").textContent = `Update Floor ${room.floor} — Room ${room.room}`;
  document.getElementById("quickRoomNumber").value = room.room;
  selectQuickStatus(room.status);
  document.getElementById("quickExpected").value = room.expected;
  document.getElementById("quickConfirmed").value = room.confirmed;
  document.getElementById("quickNote").value = room.note;
  document.getElementById("quickEditModal").classList.remove("hidden");
}

function selectQuickStatus(status) {
  document.getElementById("quickStatus").value = status;
  ["GREEN", "YELLOW", "RED"].forEach(s => {
    const btn = document.getElementById(`pick${s}`);
    if (btn) btn.classList.toggle("selected", s === status);
  });
}

// =========================================================
// RESPONDER HANDOFF BRIEF, ALERT CHIME & ACCESSIBILITY
// =========================================================

function buildResponderBriefText() {
  const inc = state.activeIncident;
  const expected = state.rooms.reduce((s, r) => s + Number(r.expected), 0);
  const confirmed = state.rooms.reduce((s, r) => s + Number(r.confirmed), 0);
  const missing = Math.max(0, expected - confirmed);
  const redRooms = state.rooms.filter(r => r.status === "RED");
  const pendingAssist = (state.assistance || []).filter(a => a.status !== "Assisted at Assembly");

  const lines = [
    `SAFE-STAY EMERGENCY RESPONDER BRIEFING`,
    `Establishment: ${state.hotel.name} (${state.hotel.address || "N/A"})`,
    `Incident: ${inc.active ? `${inc.title} (${inc.type})` : "Normal Operations"}`,
    `Assembly Area: ${inc.assemblyArea || state.hotel.assemblyArea}`,
    `Time Generated: ${new Date().toLocaleString()}`,
    `----------------------------------------`,
    `GUEST ACCOUNTABILITY SUMMARY:`,
    `- Occupied Rooms: ${state.rooms.length}`,
    `- Registered Guests: ${expected}`,
    `- Confirmed at Assembly: ${confirmed}`,
    `- UNACCOUNTED GUESTS: ${missing}`,
    `----------------------------------------`,
    `UNRESOLVED (RED) ROOMS (${redRooms.length}):`
  ];

  if (redRooms.length === 0) {
    lines.push("  None reported.");
  } else {
    redRooms.forEach(r => {
      const rmMissing = Math.max(0, r.expected - r.confirmed);
      lines.push(`  * Floor ${r.floor} Room ${r.room}: ${rmMissing} unaccounted (${r.confirmed}/${r.expected}) - ${r.note} [${r.updatedAt}]`);
    });
  }

  if (state.user.canViewAssistance && pendingAssist.length > 0) {
    lines.push(`----------------------------------------`);
    lines.push(`RESTRICTED GUEST ASSISTANCE NEEDS (${pendingAssist.length} Pending):`);
    pendingAssist.forEach(a => {
      lines.push(`  * Room ${a.room}: ${a.type} (Assigned: ${a.role}) - ${a.notes}`);
    });
  }

  lines.push(`----------------------------------------`);
  lines.push(`SAFETY NOTICE: Hotel staff must NOT independently re-enter the building.`);
  return lines.join("\n");
}

function openResponderBrief() {
  if (!state) return;
  const inc = state.activeIncident;
  const expected = state.rooms.reduce((s, r) => s + Number(r.expected), 0);
  const confirmed = state.rooms.reduce((s, r) => s + Number(r.confirmed), 0);
  const missing = Math.max(0, expected - confirmed);
  const redRooms = state.rooms.filter(r => r.status === "RED");
  const pendingAssist = (state.assistance || []).filter(a => a.status !== "Assisted at Assembly");

  const body = document.getElementById("responderBriefBody");
  body.innerHTML = `
    <div>
      <strong>${escapeHTML(state.hotel.name)}</strong> &mdash; ${escapeHTML(state.hotel.address || "")}<br />
      <strong>Incident:</strong> ${escapeHTML(inc.active ? `${inc.title} (${inc.type})` : "Normal Operations")} &bull;
      <strong>Assembly Area:</strong> ${escapeHTML(inc.assemblyArea || state.hotel.assemblyArea)}<br />
      <strong>Prepared:</strong> ${new Date().toLocaleString()} by ${escapeHTML(state.user.name)} (${escapeHTML(state.user.role)})
    </div>

    <div class="brief-section">
      <h4>Guest Accountability Summary</h4>
      <div>
        Registered: <strong>${expected}</strong> &nbsp;|&nbsp;
        Confirmed at Assembly: <strong class="text-green">${confirmed}</strong> &nbsp;|&nbsp;
        Unaccounted: <strong class="${missing > 0 ? "text-red" : "text-green"}">${missing}</strong>
      </div>
    </div>

    <div class="brief-section">
      <h4>Unresolved (RED) Rooms &mdash; Priority for Responders (${redRooms.length})</h4>
      ${redRooms.length === 0
        ? `<p class="text-green"><strong>No unresolved (RED) rooms currently reported.</strong></p>`
        : `<div class="brief-red-box">
            ${redRooms.map(r => `
              <div style="margin-bottom:6px;">
                <strong>Floor ${r.floor} &bull; Room ${escapeHTML(r.room)}</strong>
                (${r.confirmed}/${r.expected} confirmed, ${Math.max(0, r.expected - r.confirmed)} unaccounted) &mdash;
                ${escapeHTML(r.note)} <span class="muted">[${escapeHTML(r.updatedAt)}]</span>
              </div>
            `).join("")}
          </div>`}
    </div>

    ${state.user.canViewAssistance ? `
      <div class="brief-section">
        <h4>Pending Special Assistance Needs (Confidential &mdash; ${pendingAssist.length})</h4>
        ${pendingAssist.length === 0
          ? `<p class="muted">No pending assistance cases.</p>`
          : pendingAssist.map(a => `
            <div style="margin-bottom:5px;">
              <strong>Room ${escapeHTML(a.room)}</strong>: ${escapeHTML(a.type)} &mdash; <em>${escapeHTML(a.notes)}</em>
            </div>
          `).join("")}
      </div>
    ` : ""}

    <div class="brief-section">
      <p class="muted"><strong>Safety Control (Proposal Sec. 16):</strong> Verified information handoff only. Hotel staff must NOT re-enter hazardous areas.</p>
    </div>
  `;

  document.getElementById("responderBriefModal").classList.remove("hidden");
}

function closeResponderBrief() {
  document.getElementById("responderBriefModal").classList.add("hidden");
}

async function copyResponderBrief() {
  const text = buildResponderBriefText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Responder Briefing copied! Ready to paste in SMS / Viber / Messenger.");
  } catch {
    showToast("Could not auto-copy; use Print Responder Brief instead.");
  }
}

function toggleAlertSound() {
  alertSoundEnabled = !alertSoundEnabled;
  localStorage.setItem("safestay_sound", alertSoundEnabled ? "on" : "off");
  updateSoundButtonUI();
  if (alertSoundEnabled) playRedAlertChime();
  showToast(`RED Alert Sound ${alertSoundEnabled ? "enabled" : "muted"}.`);
}

function updateSoundButtonUI() {
  const btn = document.getElementById("btnSoundToggle");
  if (!btn) return;
  btn.innerHTML = alertSoundEnabled ? "&#128276; Sound: ON" : "&#128263; Sound: OFF";
}

function playRedAlertChime() {
  if (!alertSoundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch {}
}

function toggleLargeText() {
  const isLarge = document.body.classList.toggle("large-text");
  localStorage.setItem("safestay_large_text", isLarge ? "on" : "off");
  showToast(isLarge ? "Large Text Emergency Mode ON." : "Standard text size restored.");
}

function closeQuickEditModal() {
  document.getElementById("quickEditModal").classList.add("hidden");
}

async function handleQuickEditSave(event) {
  event.preventDefault();
  const roomNum = document.getElementById("quickRoomNumber").value;
  const status = document.getElementById("quickStatus").value;
  const expected = Number(document.getElementById("quickExpected").value);
  const confirmed = Number(document.getElementById("quickConfirmed").value);
  const note = document.getElementById("quickNote").value.trim();

  const countErr = validateRoomCounts(expected, confirmed);
  if (countErr) return showToast(countErr);
  if (note.length > 240) return showToast("Note must be 240 characters or fewer.");

  // Safety guardrail: warn if marking GREEN while guests are still unaccounted for
  if (status === "GREEN" && confirmed < expected) {
    const missing = expected - confirmed;
    const proceed = await confirmAction({
      title: `Mark Room ${roomNum} GREEN with Unaccounted Guests?`,
      message: `Room ${roomNum} still has ${missing} unaccounted guest(s) (${confirmed}/${expected} confirmed). Are you sure you want to mark it GREEN (Verified)?`,
      okText: "Yes, Mark GREEN",
      okClass: "btn-warning"
    });
    if (!proceed) return;
  }

  try {
    await api(`/api/rooms/${encodeURIComponent(roomNum)}`, "PUT", { status, expected, confirmed, note });
    closeQuickEditModal();
    await refreshState();
    showToast(`Room ${roomNum} updated live.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteCurrentQuickRoom() {
  const roomNum = document.getElementById("quickRoomNumber").value;
  const ok = await confirmAction({
    title: `Remove Room ${roomNum}?`,
    message: `This will permanently remove Room ${roomNum} and its occupancy count from the monitoring board.`,
    okText: "Remove Room",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api(`/api/rooms/${encodeURIComponent(roomNum)}`, "DELETE");
    closeQuickEditModal();
    await refreshState();
    showToast(`Room ${roomNum} removed.`);
  } catch (err) {
    showToast(err.message);
  }
}

function prefillUpdateForm() {
  if (!state) return;
  const roomNum = document.getElementById("formRoom").value;
  const room = state.rooms.find(r => r.room === roomNum);
  if (!room) return;
  document.getElementById("formStatus").value = room.status;
  document.getElementById("formExpected").value = room.expected;
  document.getElementById("formConfirmed").value = room.confirmed;
  document.getElementById("formNote").value = room.note;
}

async function handleStatusUpdate(event) {
  event.preventDefault();
  const roomNum = document.getElementById("formRoom").value;
  const status = document.getElementById("formStatus").value;
  const expected = Number(document.getElementById("formExpected").value);
  const confirmed = Number(document.getElementById("formConfirmed").value);
  const note = document.getElementById("formNote").value.trim();

  if (!roomNum) return showToast("Please select a room.");
  const countErr = validateRoomCounts(expected, confirmed);
  if (countErr) return showToast(countErr);
  if (note.length > 240) return showToast("Note must be 240 characters or fewer.");

  if (status === "GREEN" && confirmed < expected) {
    const missing = expected - confirmed;
    const proceed = await confirmAction({
      title: `Mark Room ${roomNum} GREEN with Unaccounted Guests?`,
      message: `Room ${roomNum} still has ${missing} unaccounted guest(s) (${confirmed}/${expected} confirmed). Continue marking as GREEN?`,
      okText: "Yes, Mark GREEN",
      okClass: "btn-warning"
    });
    if (!proceed) return;
  }

  try {
    await api(`/api/rooms/${encodeURIComponent(roomNum)}`, "PUT", { status, expected, confirmed, note });
    await refreshState();
    showToast(`Room ${roomNum} update synced across all devices.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function adjustConfirmed(roomNum, change) {
  const room = state.rooms.find(r => r.room === roomNum);
  if (!room) return;
  const nextCount = room.confirmed + change;
  if (nextCount < 0) return showToast("Confirmed count cannot be less than 0.");
  if (nextCount > room.expected) return showToast(`Room ${roomNum} already has all ${room.expected} guest(s) confirmed.`);

  const missing = room.expected - nextCount;
  const nextStatus = missing === 0 ? "GREEN" : "RED";
  const nextNote = missing === 0
    ? "All registered guests verified at assembly area"
    : `${missing} guest(s) not yet accounted for - report to coordinator`;

  try {
    await api(`/api/rooms/${encodeURIComponent(roomNum)}`, "PUT", {
      confirmed: nextCount,
      status: nextStatus,
      note: nextNote
    });
    await refreshState();
    showToast(`Room ${roomNum}: ${nextCount}/${room.expected} confirmed.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function escalateRoom(roomNum) {
  const room = state.rooms.find(r => r.room === roomNum);
  if (!room) return;
  const missing = Math.max(0, room.expected - room.confirmed);

  const ok = await confirmAction({
    title: `Escalate Room ${roomNum} to RED?`,
    message: `This will flag Room ${roomNum} as UNRESOLVED (${missing} unaccounted) and immediately alert the Emergency Coordinator and connected staff devices.`,
    okText: "Escalate to RED",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api(`/api/rooms/${encodeURIComponent(roomNum)}`, "PUT", {
      status: "RED",
      note: `Escalated to coordinator/responders (${missing} guest(s) unaccounted for)`
    });
    await refreshState();
    showToast(`Room ${roomNum} escalated to RED.`);
  } catch (err) {
    showToast(err.message);
  }
}

function openAddRoomModal() { document.getElementById("addRoomModal").classList.remove("hidden"); }
function closeAddRoomModal() { document.getElementById("addRoomModal").classList.add("hidden"); }

async function handleAddRoom(event) {
  event.preventDefault();
  const floor = Number(document.getElementById("newRoomFloor").value);
  const room = document.getElementById("newRoomNumber").value.trim();
  const expected = Number(document.getElementById("newRoomExpected").value);

  if (!Number.isInteger(floor) || floor < 1 || floor > 50) return showToast("Floor must be a whole number between 1 and 50.");
  if (!/^[a-zA-Z0-9-]{1,12}$/.test(room)) return showToast("Room number must be 1–12 letters, numbers, or dashes (e.g., 105 or 204A).");
  if (!Number.isInteger(expected) || expected < 0 || expected > 20) return showToast("Registered guests must be between 0 and 20.");

  try {
    await api("/api/rooms", "POST", { floor, room, expected });
    closeAddRoomModal();
    document.getElementById("newRoomNumber").value = "";
    await refreshState();
    showToast(`Room ${room} added to Floor ${floor}.`);
  } catch (err) {
    showToast(err.message);
  }
}

// INCIDENT LIFECYCLE
function openActivateModal() {
  document.getElementById("incAssembly").value = state.hotel.assemblyArea || "";
  document.getElementById("activateModal").classList.remove("hidden");
}
function closeActivateModal() { document.getElementById("activateModal").classList.add("hidden"); }

async function handleActivateIncident(event) {
  event.preventDefault();
  const title = document.getElementById("incTitle").value.trim();
  const type = document.getElementById("incType").value;
  const assemblyArea = document.getElementById("incAssembly").value.trim();

  if (title.length < 3) return showToast("Incident title must be at least 3 characters.");
  if (assemblyArea.length < 3) return showToast("Please specify the designated assembly area.");

  const ok = await confirmAction({
    title: "Activate Emergency Tracking Mode?",
    message: `Activating "${title}" will reset all occupied rooms to YELLOW (pending verification) and notify all connected staff devices.`,
    okText: "Activate Emergency",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api("/api/incident/activate", "POST", { title, type, assemblyArea });
    closeActivateModal();
    await refreshState();
    showToast("Emergency tracking mode activated across all devices.");
  } catch (err) {
    showToast(err.message);
  }
}

function openCloseIncidentModal() { document.getElementById("closeIncidentModal").classList.remove("hidden"); }
function closeCloseIncidentModal() { document.getElementById("closeIncidentModal").classList.add("hidden"); }

async function handleCloseIncident(event) {
  event.preventDefault();
  const summaryNote = document.getElementById("closeSummaryNote").value.trim();
  if (summaryNote.length < 5) return showToast("Please enter a brief post-incident summary (at least 5 characters).");

  const redCount = state.rooms.filter(r => r.status === "RED").length;
  const warning = redCount > 0
    ? `WARNING: There are still ${redCount} unresolved (RED) room(s). `
    : "";

  const ok = await confirmAction({
    title: "Close & Archive This Incident?",
    message: `${warning}Closing will save a permanent Post-Incident Review record and return the hotel to Normal Operations.`,
    okText: "Close & Archive",
    okClass: "btn-warning"
  });
  if (!ok) return;

  try {
    await api("/api/incident/close", "POST", { summaryNote });
    closeCloseIncidentModal();
    document.getElementById("closeSummaryNote").value = "";
    await refreshState();
    showToast("Incident archived. Hotel returned to Normal Operations.");
  } catch (err) {
    showToast(err.message);
  }
}

// RESTRICTED ASSISTANCE
async function handleAddAssistance(event) {
  event.preventDefault();
  const room = document.getElementById("assistRoom").value;
  const type = document.getElementById("assistType").value;
  const role = document.getElementById("assistRole").value;
  const notes = document.getElementById("assistNotes").value.trim();

  if (!room || !type) return showToast("Please select a room and assistance type.");
  if (notes.length > 240) return showToast("Coordination notes must be 240 characters or fewer.");

  try {
    await api("/api/assistance", "POST", { room, type, role, notes });
    document.getElementById("assistNotes").value = "";
    await refreshState();
    showToast("Confidential assistance entry saved.");
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleAssistanceStatus(id, currentStatus) {
  const nextStatus = currentStatus === "Assisted at Assembly" ? "Needs Verification" : "Assisted at Assembly";
  try {
    await api(`/api/assistance/${encodeURIComponent(id)}`, "PUT", { status: nextStatus });
    await refreshState();
    showToast(`Assistance status updated to ${nextStatus}.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteAssistance(id) {
  const ok = await confirmAction({
    title: "Remove Confidential Assistance Entry?",
    message: "This will permanently delete this guest assistance record from the restricted registry.",
    okText: "Remove Entry",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api(`/api/assistance/${encodeURIComponent(id)}`, "DELETE");
    await refreshState();
    showToast("Assistance entry removed.");
  } catch (err) {
    showToast(err.message);
  }
}

// HOTEL SETTINGS, STAFF & EVALUATIONS
function populateHotelSettingsForm() {
  if (!state) return;
  document.getElementById("setHotelName").value = state.hotel.name || "";
  document.getElementById("setHotelAddress").value = state.hotel.address || "";
  document.getElementById("setAssemblyArea").value = state.hotel.assemblyArea || "";
  document.getElementById("setGoogleForm").value = state.hotel.googleFormUrl || "";
  document.getElementById("setGoogleSheet").value = state.hotel.googleSheetUrl || "";
}

async function handleSaveHotelSettings(event) {
  event.preventDefault();
  const name = document.getElementById("setHotelName").value.trim();
  const address = document.getElementById("setHotelAddress").value.trim();
  const assemblyArea = document.getElementById("setAssemblyArea").value.trim();
  const googleFormUrl = document.getElementById("setGoogleForm").value.trim();
  const googleSheetUrl = document.getElementById("setGoogleSheet").value.trim();

  if (name.length < 2) return showToast("Establishment name must be at least 2 characters.");
  if (assemblyArea.length < 3) return showToast("Please enter a valid designated assembly area.");
  if (!isValidOptionalUrl(googleFormUrl)) return showToast("Google Form URL must start with http:// or https://");
  if (!isValidOptionalUrl(googleSheetUrl)) return showToast("Google Sheet URL must start with http:// or https://");

  try {
    await api("/api/hotel", "PUT", { name, address, assemblyArea, googleFormUrl, googleSheetUrl });
    await refreshState();
    showToast("Hotel settings saved.");
  } catch (err) {
    showToast(err.message);
  }
}

function openExternalLink(type) {
  const url = type === "form" ? state.hotel.googleFormUrl : state.hotel.googleSheetUrl;
  if (!url) {
    showToast(`Add your Google ${type === "form" ? "Form" : "Sheet"} URL in Settings first.`);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

async function handleAddStaffUser(event) {
  event.preventDefault();
  const username = document.getElementById("newStaffUser").value.trim().toLowerCase();
  const name = document.getElementById("newStaffName").value.trim();
  const role = document.getElementById("newStaffRole").value;
  const password = document.getElementById("newStaffPass").value;

  if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
    return showToast("Username must be 3–24 characters (letters, numbers, _ or - only).");
  }
  if (name.length < 2) return showToast("Please enter the staff member's full name.");
  if (password.length < 4) return showToast("Password must be at least 4 characters.");

  try {
    await api("/api/users", "POST", { username, name, role, password });
    await refreshState();
    showToast(`Staff account "${username}" created.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteStaffUser(username) {
  const ok = await confirmAction({
    title: `Remove Staff Account "${username}"?`,
    message: `This user will immediately lose access to SAFE-STAY. This action cannot be undone.`,
    okText: "Remove Account",
    okClass: "btn-danger"
  });
  if (!ok) return;

  try {
    await api(`/api/users/${encodeURIComponent(username)}`, "DELETE");
    await refreshState();
    showToast(`Staff account "${username}" removed.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function handleSaveEvaluation(event) {
  event.preventDefault();
  const comment = document.getElementById("evalComment").value.trim();
  if (comment.length > 300) return showToast("Comment must be 300 characters or fewer.");

  try {
    await api("/api/evaluations", "POST", {
      reviewer: document.getElementById("evalReviewer").value.trim(),
      clarity: Number(document.getElementById("evalClarity").value),
      usability: Number(document.getElementById("evalUsability").value),
      accuracy: Number(document.getElementById("evalAccuracy").value),
      coordination: Number(document.getElementById("evalCoordination").value),
      backup: Number(document.getElementById("evalBackup").value),
      privacy: Number(document.getElementById("evalPrivacy").value),
      comment
    });
    document.getElementById("evalReviewer").value = "";
    document.getElementById("evalComment").value = "";
    await refreshState();
    showToast("Evaluation feedback recorded.");
  } catch (err) {
    showToast(err.message);
  }
}

async function handleResetDemo() {
  const ok = await confirmAction({
    title: "Load 10-Room Classroom Demo?",
    message: "This will reset all current rooms, guest counts, and logs back to the default 3-floor, 10-room, 20-guest demonstration scenario.",
    okText: "Reset to Demo",
    okClass: "btn-warning"
  });
  if (!ok) return;

  try {
    await api("/api/reset-demo", "POST");
    await refreshState();
    populateHotelSettingsForm();
    showToast("Classroom demo scenario loaded.");
  } catch (err) {
    showToast(err.message);
  }
}

// =========================================================
// REUSABLE CONFIRMATION DIALOG & VALIDATION HELPERS
// =========================================================

function confirmAction({ title, message, okText = "Confirm", okClass = "btn-danger" }) {
  return new Promise(resolve => {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const msgEl = document.getElementById("confirmMessage");
    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");

    titleEl.textContent = title || "Confirm Action";
    msgEl.textContent = message || "Are you sure you want to proceed?";
    okBtn.textContent = okText;
    okBtn.className = `btn ${okClass}`;
    modal.classList.remove("hidden");

    const cleanup = result => {
      modal.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onKey = e => {
      if (e.key === "Escape") cleanup(false);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    document.addEventListener("keydown", onKey);
  });
}

function validateRoomCounts(expected, confirmed) {
  if (!Number.isInteger(expected) || expected < 0 || expected > 20) {
    return "Registered occupants must be a whole number between 0 and 20.";
  }
  if (!Number.isInteger(confirmed) || confirmed < 0 || confirmed > 20) {
    return "Confirmed guests must be a whole number between 0 and 20.";
  }
  if (confirmed > expected) {
    return `Confirmed guests (${confirmed}) cannot exceed registered occupants (${expected}).`;
  }
  return null;
}

function isValidOptionalUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// =========================================================
// CSV EXPORTS & HELPERS
// =========================================================

function downloadCSV(filename, headers, rows) {
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) { return `"${String(v || "").replace(/"/g, '""')}"`; }

function exportToCSV() {
  const headers = ["Floor", "Room", "Expected Guests", "Confirmed at Assembly", "Unaccounted", "Status", "Color", "Source / Role", "Updated At", "Note"];
  const rows = state.rooms.map(r => [
    r.floor, csvCell(r.room), r.expected, r.confirmed, Math.max(0, r.expected - r.confirmed),
    csvCell(getAccountabilityLabel(r.status)), r.status, csvCell(formatSource(r)), csvCell(r.updatedAt), csvCell(r.note)
  ]);
  downloadCSV("SAFE-STAY-Accountability.csv", headers, rows);
  showToast("Accountability CSV exported.");
}

function exportLogCSV() {
  const headers = ["Date & Time", "Room", "Status", "Reporting Role", "Details"];
  const rows = state.logs.map(l => [csvCell(l.dateTime), csvCell(l.room), l.status, csvCell(l.role), csvCell(l.message)]);
  downloadCSV("SAFE-STAY-Audit-Log.csv", headers, rows);
  showToast("Audit Log CSV exported.");
}

function exportEvaluationsCSV() {
  if (!state.evaluations || state.evaluations.length === 0) return showToast("No evaluations to export yet.");
  const headers = ["Date & Time", "Reviewer", "Clarity", "Usability", "Accuracy", "Coordination", "Backup", "Privacy", "Comment"];
  const rows = state.evaluations.map(e => [
    csvCell(e.dateTime), csvCell(e.reviewer), e.clarity, e.usability, e.accuracy, e.coordination, e.backup, e.privacy, csvCell(e.comment)
  ]);
  downloadCSV("SAFE-STAY-Evaluations.csv", headers, rows);
  showToast("Evaluations CSV exported.");
}

function updatePrintHeader() {
  if (!state) return;
  document.getElementById("printHotelHeader").textContent = `${state.hotel.name} — OFFLINE PAPER BACKUP RECORD`;
  document.getElementById("printIncidentName").textContent = state.activeIncident.title || "Normal Operations";
  document.getElementById("printTimestamp").textContent = new Date().toLocaleString();
  document.getElementById("printAssemblyArea").textContent = state.activeIncident.assemblyArea || state.hotel.assemblyArea;
}

function getAccountabilityLabel(s) {
  if (s === "GREEN") return "Confirmed";
  if (s === "YELLOW") return "Pending";
  return "Unresolved";
}

function formatSource(r) { return r.staffId ? `${r.role} (${r.staffId})` : r.role; }

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.addEventListener("DOMContentLoaded", initApp);
window.addEventListener("beforeprint", updatePrintHeader);
