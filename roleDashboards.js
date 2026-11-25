/* =========================================================
   SAFE-STAY ROLE-SPECIFIC DASHBOARDS (public/roleDashboards.js)
   Each of the 5 staff roles (Proposal Section 8) gets its own
   tailored sidebar menu and home dashboard view.
   ========================================================= */

const ROLE_CONFIG = {
  "Emergency Coordinator": {
    dashboardTitle: "Emergency Coordinator Command Center",
    responsibility: "Maintain the overall accountability picture, resolve conflicting information, and communicate with emergency services.",
    nav: [
      { id: "dashboardTab",      label: "Command Dashboard",    icon: "&#9638;" },
      { id: "boardTab",          label: "Monitoring Board",     icon: "&#9635;" },
      { id: "accountabilityTab", label: "Guest Accountability", icon: "&#10003;" },
      { id: "updateTab",         label: "Digital Tracker & Log", icon: "&#9998;" },
      { id: "assistanceTab",     label: "Assistance Record",    icon: "&#128274;" },
      { id: "qrTab",             label: "QR Labels & Cards",    icon: "&#9641;" },
      { id: "adminTab",          label: "Incidents, Staff & Eval", icon: "&#9881;" }
    ]
  },
  "Front Office": {
    dashboardTitle: "Front Office Occupancy & Prep Dashboard",
    responsibility: "Maintain current occupancy information and provide the authorized coordinator with the required guest count or room record.",
    nav: [
      { id: "dashboardTab",      label: "Front Office Home",    icon: "&#9638;" },
      { id: "boardTab",          label: "Monitoring Board",     icon: "&#9635;" },
      { id: "accountabilityTab", label: "Guest Accountability", icon: "&#10003;" },
      { id: "updateTab",         label: "Digital Tracker & Log", icon: "&#9998;" },
      { id: "assistanceTab",     label: "Assistance Record",    icon: "&#128274;" },
      { id: "qrTab",             label: "QR Labels & Cards",    icon: "&#9641;" },
      { id: "adminTab",          label: "Hotel Settings & Eval", icon: "&#9881;" }
    ]
  },
  "Security / Safety": {
    dashboardTitle: "Security & Safety Coordination Dashboard",
    responsibility: "Support the hotel's emergency plan, coordinate information flow, and communicate with responders as assigned.",
    nav: [
      { id: "dashboardTab",      label: "Security Dashboard",   icon: "&#9638;" },
      { id: "boardTab",          label: "Monitoring Board",     icon: "&#9635;" },
      { id: "accountabilityTab", label: "Guest Accountability", icon: "&#10003;" },
      { id: "updateTab",         label: "Digital Tracker & Log", icon: "&#9998;" },
      { id: "assistanceTab",     label: "Assistance Record",    icon: "&#128274;" },
      { id: "qrTab",             label: "QR Labels & Cards",    icon: "&#9641;" }
    ]
  },
  "Housekeeping": {
    dashboardTitle: "Housekeeping Safe Status Reporting",
    responsibility: "Share only safe, verified room or floor information obtained within assigned duties and approved procedures. Never enter hazardous areas.",
    nav: [
      { id: "dashboardTab",      label: "Housekeeping Home",    icon: "&#9638;" },
      { id: "boardTab",          label: "Monitoring Board",     icon: "&#9635;" },
      { id: "updateTab",         label: "Submit Room Update",   icon: "&#9998;" },
      { id: "qrTab",             label: "QR Labels & Cards",    icon: "&#9641;" }
    ]
  },
  "Assembly-Area Team": {
    dashboardTitle: "Assembly-Area Guest Verification Desk",
    responsibility: "Record guests who arrive at the designated assembly area and promptly report discrepancies to the emergency coordinator.",
    nav: [
      { id: "dashboardTab",      label: "Assembly Check-In",    icon: "&#9638;" },
      { id: "accountabilityTab", label: "Full Guest Record",    icon: "&#10003;" },
      { id: "boardTab",          label: "Monitoring Board",     icon: "&#9635;" },
      { id: "updateTab",         label: "Submit Update",        icon: "&#9998;" }
    ]
  }
};

function getRoleConfig(role) {
  return ROLE_CONFIG[role] || ROLE_CONFIG["Housekeeping"];
}

function renderRoleDashboard(state) {
  const container = document.getElementById("roleDashboardContent");
  if (!container || !state) return;

  const role = state.user.role;
  const cfg = getRoleConfig(role);

  const totalRooms = state.rooms.length;
  const expected = state.rooms.reduce((s, r) => s + Number(r.expected), 0);
  const confirmed = state.rooms.reduce((s, r) => s + Number(r.confirmed), 0);
  const unaccounted = Math.max(0, expected - confirmed);
  const pct = expected > 0 ? Math.round((confirmed / expected) * 100) : 100;

  const redRooms = state.rooms.filter(r => r.status === "RED");
  const yellowRooms = state.rooms.filter(r => r.status === "YELLOW");
  const greenRooms = state.rooms.filter(r => r.status === "GREEN");

  // Header Banner for every Role Dashboard
  let html = `
    <div class="role-hero">
      <div>
        <span class="role-pill">${escapeHTML(role)}</span>
        <h2>${escapeHTML(cfg.dashboardTitle)}</h2>
        <p class="muted" style="margin-top:4px;">${escapeHTML(cfg.responsibility)}</p>
      </div>
      <div class="role-hero-actions">
        ${role === "Emergency Coordinator" || role === "Front Office"
          ? `<button class="btn btn-primary" onclick="openAddRoomModal()">+ Add Room</button>` : ""}
        ${(role === "Emergency Coordinator" || role === "Security / Safety") && !state.activeIncident.active
          ? `<button class="btn btn-danger" onclick="openActivateModal()">Activate Emergency</button>` : ""}
        ${role === "Emergency Coordinator" && state.activeIncident.active
          ? `<button class="btn btn-warning" onclick="openCloseIncidentModal()">Close &amp; Archive</button>` : ""}
        <button class="btn btn-outline" onclick="navigateTo('boardTab')">Open Monitoring Board</button>
      </div>
    </div>
  `;

  // =========================================================
  // 1. EMERGENCY COORDINATOR COMMAND DASHBOARD
  // =========================================================
  if (role === "Emergency Coordinator") {
    html += `
      <div class="dash-grid-2">
        <div class="card">
          <div class="card-header-row">
            <div>
              <h3>Unresolved &amp; Escalated Rooms (${redRooms.length})</h3>
              <p class="muted">Relay immediately to emergency responders. Never re-enter the building.</p>
            </div>
            <button class="btn btn-outline btn-small" onclick="focusRedRooms()">View All</button>
          </div>
          <div style="margin-top:12px;">
            ${redRooms.length === 0
              ? `<p class="text-green" style="font-weight:600;">No unresolved (RED) rooms right now.</p>`
              : redRooms.map(r => `
                <div class="dash-alert-item">
                  <div>
                    <strong>Floor ${r.floor} &bull; Room ${escapeHTML(r.room)}</strong>
                    <div class="muted">${r.confirmed}/${r.expected} confirmed &mdash; ${escapeHTML(r.note)}</div>
                  </div>
                  <button class="btn btn-danger btn-small" onclick="openQuickEditModal('${escapeHTML(r.room)}')">Update</button>
                </div>
              `).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header-row">
            <div>
              <h3>Recent Live Updates</h3>
              <p class="muted">Latest reports from hotel departments.</p>
            </div>
            <button class="btn btn-outline btn-small" onclick="navigateTo('updateTab')">Full Log</button>
          </div>
          <div class="log-list" style="max-height:240px;">
            ${(state.logs || []).slice(0, 6).map(l => `
              <div class="log-item log-${l.status}">
                <strong>Room ${escapeHTML(l.room)}</strong> <span class="status-badge badge-${l.status}">${l.status}</span>
                <div style="margin-top:3px;">${escapeHTML(l.message)}</div>
                <div class="muted" style="font-size:0.76rem;">${escapeHTML(l.dateTime)} &bull; ${escapeHTML(l.role)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================
  // 2. FRONT OFFICE OCCUPANCY & PREP DASHBOARD
  // =========================================================
  else if (role === "Front Office") {
    const assistCount = (state.assistance || []).length;
    const occupiedCount = state.rooms.filter(r => r.expected > 0).length;
    html += `
      <div class="dash-grid-2">
        <div class="card">
          <div class="card-header-row">
            <div>
              <h3>Current Occupancy Snapshot</h3>
              <p class="muted">${occupiedCount} of ${totalRooms} rooms occupied &bull; ${expected} registered guests.</p>
            </div>
            <button class="btn btn-primary btn-small" onclick="openAddRoomModal()">+ Add Room</button>
          </div>
          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead><tr><th>Room</th><th>Floor</th><th>Registered</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${state.rooms.slice(0, 8).map(r => `
                  <tr>
                    <td><strong>Room ${escapeHTML(r.room)}</strong></td>
                    <td>Floor ${r.floor}</td>
                    <td>${r.expected} guest(s)</td>
                    <td><span class="status-badge badge-${r.status}">${r.status}</span></td>
                    <td><button class="btn btn-outline btn-small" onclick="openQuickEditModal('${escapeHTML(r.room)}')">Edit</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header-row">
            <div>
              <h3>Confidential Assistance Registry (${assistCount})</h3>
              <p class="muted">Voluntarily disclosed needs prepared during check-in.</p>
            </div>
            <button class="btn btn-outline btn-small" onclick="navigateTo('assistanceTab')">Manage</button>
          </div>
          <div style="margin-top:12px;">
            ${assistCount === 0
              ? `<p class="muted">No assistance entries recorded.</p>`
              : state.assistance.map(a => `
                <div class="dash-list-item">
                  <div>
                    <strong>Room ${escapeHTML(a.room)}</strong> &mdash; ${escapeHTML(a.type)}
                    <div class="muted">Assigned: ${escapeHTML(a.role)} &bull; ${escapeHTML(a.status)}</div>
                  </div>
                </div>
              `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================
  // 3. SECURITY / SAFETY COORDINATION DASHBOARD
  // =========================================================
  else if (role === "Security / Safety") {
    const pendingAssist = (state.assistance || []).filter(a => a.status !== "Assisted at Assembly");
    html += `
      <div class="dash-grid-2">
        <div class="card">
          <h3>Urgent Escalations &amp; Floor Status</h3>
          <p class="muted" style="margin-bottom:12px;">Coordinate safe information flow and brief emergency responders.</p>
          ${redRooms.length === 0
            ? `<p class="text-green" style="font-weight:600;">No RED alerts. ${yellowRooms.length} room(s) pending, ${greenRooms.length} verified.</p>`
            : redRooms.map(r => `
              <div class="dash-alert-item">
                <div>
                  <strong>Floor ${r.floor} &bull; Room ${escapeHTML(r.room)}</strong>
                  <div class="muted">${r.confirmed}/${r.expected} confirmed &mdash; ${escapeHTML(r.note)}</div>
                </div>
                <button class="btn btn-danger btn-small" onclick="openQuickEditModal('${escapeHTML(r.room)}')">Update</button>
              </div>
            `).join("")}
        </div>

        <div class="card">
          <div class="card-header-row">
            <div>
              <h3>Guests Needing Assistance (${pendingAssist.length} Pending)</h3>
              <p class="muted">Restricted safety coordination list.</p>
            </div>
            <button class="btn btn-outline btn-small" onclick="navigateTo('assistanceTab')">Open Registry</button>
          </div>
          <div style="margin-top:12px;">
            ${(state.assistance || []).map(a => `
              <div class="dash-list-item">
                <div>
                  <strong>Room ${escapeHTML(a.room)}</strong> &mdash; ${escapeHTML(a.type)}
                  <div class="muted">${escapeHTML(a.notes)}</div>
                </div>
                <span class="status-badge ${a.status === "Assisted at Assembly" ? "badge-GREEN" : "badge-YELLOW"}">${escapeHTML(a.status)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================
  // 4. HOUSEKEEPING SAFE STATUS REPORTING DASHBOARD
  // =========================================================
  else if (role === "Housekeeping") {
    const needsUpdate = state.rooms.filter(r => r.status !== "GREEN");
    html += `
      <div class="card">
        <div class="card-header-row">
          <div>
            <h3>Rooms Pending Safe Status Update (${needsUpdate.length})</h3>
            <p class="muted">Tap any room below only if you have safe, verified information from approved duties. Never enter hazardous areas.</p>
          </div>
          <button class="btn btn-primary btn-small" onclick="navigateTo('updateTab')">Open Update Form</button>
        </div>
        <div class="room-grid" style="margin-top:14px;">
          ${needsUpdate.length === 0
            ? `<p class="text-green" style="font-weight:600;">All rooms are currently marked GREEN (verified).</p>`
            : needsUpdate.map(r => `
              <div class="room-card status-${r.status}" onclick="openQuickEditModal('${escapeHTML(r.room)}')">
                <div class="room-card-top">
                  <span class="room-number">Room ${escapeHTML(r.room)}</span>
                  <span class="status-badge badge-${r.status}">${r.status}</span>
                </div>
                <div class="room-guests">Floor ${r.floor} &bull; ${r.confirmed}/${r.expected} confirmed</div>
                <div class="room-note">${escapeHTML(r.note)}</div>
              </div>
            `).join("")}
        </div>
      </div>
    `;
  }

  // =========================================================
  // 5. ASSEMBLY-AREA TEAM VERIFICATION DASHBOARD
  // =========================================================
  else if (role === "Assembly-Area Team") {
    const unverifiedRooms = state.rooms.filter(r => r.confirmed < r.expected || r.status !== "GREEN");
    html += `
      <div class="progress-card">
        <div class="progress-header">
          <span><strong>Assembly-Area Headcount Progress (${escapeHTML(state.activeIncident.assemblyArea || state.hotel.assemblyArea)})</strong></span>
          <span><strong>${confirmed} / ${expected} Guests Confirmed (${pct}%)</strong></span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header-row">
          <div>
            <h3>Quick Assembly Check-In Queue (${unverifiedRooms.length} Rooms Remaining)</h3>
            <p class="muted">Tap <strong>+1 Arrived</strong> as guests check in, or <strong>Escalate</strong> to notify the Emergency Coordinator.</p>
          </div>
          <button class="btn btn-outline btn-small" onclick="navigateTo('accountabilityTab')">View All Rooms</button>
        </div>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead>
              <tr><th>Room</th><th>Expected</th><th>Confirmed</th><th>Missing</th><th>Status</th><th>Quick Action</th></tr>
            </thead>
            <tbody>
              ${unverifiedRooms.length === 0
                ? `<tr><td colspan="6" class="text-green" style="font-weight:700;">All registered guests are verified at the assembly area!</td></tr>`
                : unverifiedRooms.map(r => {
                  const missing = Math.max(0, r.expected - r.confirmed);
                  return `
                    <tr class="row-${r.status}">
                      <td><strong>Floor ${r.floor} &bull; Room ${escapeHTML(r.room)}</strong></td>
                      <td>${r.expected}</td>
                      <td><strong>${r.confirmed}</strong></td>
                      <td class="${missing > 0 ? "text-red" : "text-green"}"><strong>${missing}</strong></td>
                      <td><span class="status-badge badge-${r.status}">${r.status}</span></td>
                      <td>
                        <button class="btn btn-primary btn-small" onclick="adjustConfirmed('${escapeHTML(r.room)}', 1)">+1 Arrived</button>
                        <button class="btn btn-outline btn-small" onclick="adjustConfirmed('${escapeHTML(r.room)}', -1)">-1</button>
                        ${missing > 0 && r.status !== "RED" ? `<button class="btn btn-danger btn-small" onclick="escalateRoom('${escapeHTML(r.room)}')">Escalate</button>` : ""}
                      </td>
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}
