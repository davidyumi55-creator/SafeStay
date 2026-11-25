# SAFE-STAY: Hotel Emergency Guest Accountability & Assistance System

A complete, real-time, multi-device web system built from the **SAFE-STAY** proposal, ready for **Railway + PostgreSQL** cloud deployment (or offline local hotel use).

---

## How to Deploy on Railway (5 Easy Steps)
1. **Push this folder to a GitHub repository** (e.g., `safe-stay`).
2. Go to [railway.app](https://railway.app) → click **New Project** → **Deploy from GitHub repo** → select your `safe-stay` repo.
3. **Add PostgreSQL Database** (choose either option):
   - **Option A (Easiest — Railway PostgreSQL):** Inside your Railway project, click **+ New** → **Database** → **Add PostgreSQL**. Then in your SAFE-STAY service → **Variables** tab → add `DATABASE_URL` referencing your PostgreSQL service (`${{Postgres.DATABASE_URL}}`).
   - **Option B (Supabase PostgreSQL):** Copy your Supabase PostgreSQL Connection String (URI) and paste it as `DATABASE_URL` in your Railway service **Variables** tab.
4. Go to your SAFE-STAY service → **Settings** → **Networking** → click **Generate Domain**.
5. Open your new `https://....up.railway.app` URL! Tables (`safestay_store` and `safestay_sessions`) are created **automatically** on first startup—no SQL commands needed.

> You can verify the database is connected anytime by visiting `https://your-app.up.railway.app/api/health` — it will show `{"ok":true,"db":"postgresql"}`.

---

## How to Run Locally on Windows
- **Full Server Mode (Multi-Device Wi-Fi):** Double-click **`START-SAFE-STAY.bat`** → opens `http://localhost:3000`.
- **Instant Offline Mode:** Double-click **`public/index.html`** directly (works even with no server or internet!).

## Default Staff Accounts (Password: `safe1234`)
| Username | Department / Role | Tailored Dashboard |
| --- | --- | --- |
| `coordinator` | Emergency Coordinator / Management | Command Center, Escalations, Incident Controls, Archives, Staff Admin, Restricted Assistance |
| `frontoffice` | Front Office | Occupancy Snapshot, Room Manager, Hotel Settings, Restricted Assistance |
| `security` | Security / Designated Safety | Escalations, Emergency Activation, Restricted Assistance Coordination |
| `housekeeping` | Housekeeping | Pending Rooms Safe Status Reporting (clean, distraction-free) |
| `assembly` | Assembly-Area Team | Live Headcount Progress Bar & Quick `+1 Arrived` / `Escalate` Queue |
