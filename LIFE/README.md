# L.I.F.E. – Localized Intelligent First-aid Evaluator

An offline CPR practice aid. A webcam and in-browser pose estimation (MediaPipe Tasks Vision) check two things during chest compressions: whether the elbows are **locked** and whether the **rate** is within 100–120 compressions per minute. Results are stored on the same computer in SQLite.

Built with React + TypeScript (Vite) for the dashboard and Node.js + Express + better-sqlite3 for the local server. No internet connection is needed after installation, and camera video never leaves the browser.

> **Training aid only. Not a medical device.** It evaluates adult CPR practice for elbow lock and cadence only. A single 2D webcam cannot measure compression depth, recoil, hand placement or rescue breaths. The 80 % pass mark is a placeholder to be confirmed with a qualified first-aid trainer.

## Requirements

- Node.js **20 or newer** (LTS recommended)
- Chrome or Edge (current version); Firefox works but runs pose detection more slowly
- A webcam (720p at 30 fps recommended)
- Windows 10/11 (also runs on macOS and Linux)

## Starting L.I.F.E.

**Windows:** double-click the **L.I.F.E.** shortcut on the Desktop (or `run_life.bat`). To create the shortcut on another computer, run `npm run shortcut` once in this folder.

**Any platform:** in this folder run `npm start` (or `node start_life.js`).

The launcher installs dependencies on the first run, rebuilds the dashboard only when its source has changed, starts the server, and opens http://localhost:3001 in your browser. Keep the window open while using the app; press Ctrl+C to stop.

Options: `--no-browser` to skip opening the browser, `--rebuild` to force a dashboard build. Set `PORT` to use a port other than 3001.

### Sign-in background

The sign-in screen shows an animated CPR scene (a pose-tracked rescuer compressing at 110 BPM with an ECG trace and a 30:2 counter). To use your own video instead, put `login-bg.mp4` (or `.webm`) in `dashboard/src/assets/`; it is bundled at the next start, so it still works offline. The **Pause background** button stops the motion, and the animation is replaced by a still frame when the computer's "reduce motion" setting is on.

### First sign-in

On a new database the server creates one account: username **`admin`**, initial password **`admin123`**. You must choose a new password (at least 8 characters) immediately after signing in. Create trainer accounts under **Settings → User accounts**; each new user also replaces their temporary password at first sign-in.

Five wrong passwords lock sign-in for that username for 5 minutes.

### Network access

The server only accepts connections from this computer (`127.0.0.1`). To let another device on the network open the dashboard (for example a second screen showing the live monitor), start it with `HOST=0.0.0.0`. Only do this on a trusted network.

## Using it

1. **Trainees:** add each trainee and tick the consent box. Sessions cannot be saved until consent is recorded. When an **admin** adds a trainee, a sign-in account is created by default: the username (e.g. `juan.delacruz`) and a temporary password are shown **once** (copy or print a slip for the trainee). Trainees choose their own password at first sign-in and then see only **My Progress** (their sessions, accuracy trend and procedure results), **Practice** (the Live Session for themselves only, with the same camera feedback and step-by-step guide) and the CPR Guide. Self-practice sessions are marked by the server and shown with a **Self-practice** badge in History; they need recorded consent like any session, appear in the trainee's progress and History, and are **not counted** in the Leaderboard or any Dashboard statistic (sessions today, averages, 30-day trend, top 5), which use trainer-supervised sessions only; the Dashboard's Recent Sessions feed still lists them with the badge. For existing trainees use the key button to create a login, and the reset button for a new temporary password. Deactivating a trainee disables their sign-in.
2. **Live Session:** choose a trainee. A step-by-step panel follows the 2025 AHA adult sequence: the trainer confirms steps 1–2 (scene, response, breathing, calling 911 and an AED), then starts compressions (step 3). The trainer selects the victim (adult, child, infant) and the number of rescuers, which sets the ratio (30:2, or 15:2 for a child or infant with two rescuers); the panel counts each cycle toward about 5 cycles of 30:2 in 2 minutes and prompts for 2 breaths at the end of each cycle (step 4); "AED has arrived" walks through the AED steps and resumes CPR (step 5); the timer marks when to switch compressors (step 6). Finger tracking draws both hands and checks that they are stacked (it can be turned off on slow computers). Steps must be done in order, and the end-of-session summary shows a **Procedure followed** checklist and score (separate from the accuracy-based Pass/Needs Improvement). The camera starts so the trainee can get into position; **Start** becomes available once the arm is visible. A 3-2-1 countdown runs, then the session timer (default 2 minutes).
   - The large cue over the video says what to fix: *Push faster*, *Slow down*, *Lock your elbows* or *Good – keep going*. Optional metronome and spoken cues are available.
   - Sessions where the camera failed or nobody was in view are not saved.
   - Every session is stored in the browser first and then uploaded, so nothing is lost if the server is stopped or the sign-in expires. A badge in the top bar shows anything not yet uploaded; uploads retry automatically from any page.
3. **Dashboard:** today's figures, a 30-day trend and a live monitor of the session in progress.
4. **Leaderboard, History, Reports:** rankings, past sessions with charts, **PDF reports** (sessions, trainee list, test data; CSV also available) and a *Certificate of Practice Completion* downloadable as a **PDF** (this confirms a practice session only; it is not CPR certification).
5. **Settings** (admin): calibration values, metronome speed, database backup and user accounts.
6. **CPR Guide:** the adult CPR sequence (2025 American Heart Association guidelines) that the Live Session checklist follows, what the camera measures versus what the trainer observes, and notes for children and infants.

### Camera setup

- Place the camera to the side of the trainee or at about 45°, so the shoulder, elbow and wrist of the arm nearest the camera are clearly visible.
- Use even lighting and a plain background; avoid a bright window behind the trainee.
- Use a firm chest prop (high-density foam, stacked cardboard or a rolled towel) with a visible target mark.
- The elbow angle is measured in 2D, so it is most accurate when the arm is roughly side-on to the camera. A frontal view makes bent arms look straighter.

## How scoring works

- **Elbow angle:** the shoulder–elbow–wrist angle, smoothed over a few frames. The elbow counts as locked at or above the lock threshold (default 160°). If the elbow cannot be seen, the compression is **unscorable**: it is reported separately and is neither counted as locked nor as wrong.
- **Compressions:** detected as peaks in the wrist's vertical movement (time-based windows, so results do not depend on frame rate). Peak times are refined between frames.
- **Rate (BPM):** median of the last few intervals (default 4). A pause longer than 1.5 s (for example rescue breaths) starts a new run, so the first compressions afterwards are not marked slow.
- **Correct compression:** elbow locked **and** rate within 100–120 BPM.
- **Accuracy:** correct ÷ scorable compressions. **Pass** when accuracy ≥ the pass mark (default 80 %).

The arm nearest the camera is chosen when the session starts and stays fixed unless it disappears for more than a second.

## Settings

Edited on the Settings page (admin only). The server rejects values outside these ranges.

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `angle_threshold` | 160 | 120–180 | Elbow lock angle (°) |
| `smoothing_window` | 5 | 1–20 | Frames averaged for the angle |
| `visibility_threshold` | 0.5 | 0.1–1 | Minimum landmark visibility |
| `min_peak_distance_ms` | 400 | 200–1000 | Minimum time between compressions |
| `peak_prominence` | 0.012 | 0.002–0.2 | Minimum wrist movement (fraction of frame height); calibrated for a webcam 1.5–2.5 m away |
| `bpm_window_intervals` | 4 | 2–10 | Intervals used for the live BPM |
| `bpm_min` / `bpm_max` | 100 / 120 | 60–120 / 100–160 | Target rate |
| `session_duration_sec` | 120 | 30–600 | Session length |
| `pass_mark_pct` | 80 | 50–100 | Accuracy needed to pass |
| `metronome_bpm` | 110 | 80–140 | Metronome speed |
| `camera_width` × `camera_height` @ `camera_framerate` | 1280 × 720 @ 30 | | Requested camera mode |

## Testing and Chapter 4 evaluation

```bash
npm test                 # server API tests, vision unit tests, evaluation-script tests
```

- `server/test/` – authentication and lockout, roles, session saving, settings validation, date filters, CSV and certificate escaping (runs against a temporary database).
- `dashboard/src/vision/*.test.ts` – angle maths, elbow smoothing and visibility gaps, cadence on synthetic signals at 90/110/130 BPM (with noise, pauses, rate changes and different frame rates), scoring rules, side lock and coaching cues.

### Measuring accuracy against an observer

1. Run practice sessions while an observer (or a video recording) notes, for each compression, whether the elbows were locked, and the reference rate (for example from a metronome).
2. **Reports → Test data → CSV** (admin), optionally for one session. (The PDF version is for reading and printing; the script needs the CSV.)
3. Create a label sheet with one row per detected compression:
   ```bash
   node scripts/evaluate.mjs --template life_test_data_2026-11-25.csv --session 12 > labels.csv
   ```
   Fill in `observer_locked` (Yes/No) and `reference_bpm`. To measure missed or extra detections, label by `timestamp_ms` instead of `compression` number.
4. Compute the results:
   ```bash
   node scripts/evaluate.mjs life_test_data_2026-11-25.csv labels.csv
   ```
   This prints the confusion matrix, accuracy, precision, recall, specificity and F1 for elbow lock and for correct compressions, plus BPM MAE, RMSE, bias and the share within ±5 BPM. Add `--json` for machine-readable output.

Each saved session also records the average camera frame rate and pose-inference time (shown in the History detail view) for performance testing.

## Data, backups and privacy

- Database: `database/life.db` (SQLite in WAL mode, so a crash or power cut cannot corrupt it). Not committed to Git.
- **Settings → Back up database** writes a consistent copy to `database/backups/`.
- The server also makes an automatic backup once a day (`database/backups/auto_YYYY-MM-DD.db`) and keeps the newest 14. Manual backups are never deleted. Set `LIFE_AUTO_BACKUP=0` to turn this off.
- Only metrics are stored (times, BPM, elbow angles, lock state, procedure checklist). No images or video are saved.
- Passwords are hashed with bcrypt. Sign-in uses a JWT signed with a random secret generated on first start (`server/.jwt_secret`, not committed). Changing a password or deactivating a user signs them out everywhere.

## Online copy on Render (optional)

The repository includes a Render Blueprint (`render.yaml`). See [docs/deploy-render.md](docs/deploy-render.md) for the steps, the free-plan data limits and how to keep data on a paid plan. Online admin sign-in: **admin** / **LifeCPR@2026** (built in; restored at every start on the free plan), or your own `LIFE_ADMIN_PASSWORD`. The local default `admin123` is never used online.

## Development

```bash
npm run dev    # API with auto-restart + dashboard with hot reload at http://localhost:5173 (one command; Ctrl+C stops both)
```

Environment variables (server): `PORT` (3001), `HOST` (127.0.0.1), `LIFE_DB_PATH` (database file, relative to `database/`), `JWT_SECRET` (optional, at least 32 characters), `LIFE_SECRET_PATH`, `LIFE_AUTO_BACKUP` (`0` disables daily backups).

The MediaPipe pose model and WebAssembly runtime are bundled in `dashboard/public/mediapipe/` and served locally; nothing is downloaded at run time.

## Project structure

```
LIFE/
├── run_life.bat, start_life.js, package.json   Launcher and project-wide scripts
├── server/                Express API
│   ├── index.js           Entry point (security headers, CSP, static dashboard)
│   ├── db.js              better-sqlite3 connection, migrations, backups
│   ├── seed_admin.js      First admin account
│   ├── lib/               Validation, escaping, JWT secret
│   ├── middleware/        Authentication and roles
│   ├── routes/            auth, trainees, sessions, live, leaderboard, stats, export, settings, users, health
│   └── test/              API tests
├── dashboard/             React + TypeScript + Vite
│   ├── public/mediapipe/  Pose model and WASM runtime (offline)
│   └── src/
│       ├── api/           API client, types, offline session outbox (IndexedDB)
│       ├── components/    Layout, camera view, feedback, live monitor, summary, shared UI
│       ├── hooks/         Auth, outbox sync, preferences
│       ├── pages/         Login, Dashboard, Live Session, Trainees, Leaderboard, History, Reports, Settings
│       ├── utils/         Formatting, metronome
│       └── vision/        camera, pose, angle, cadence, scoring, coach, pipeline (+ unit tests)
├── database/schema.sql    Database schema
├── scripts/evaluate.mjs   Accuracy evaluation for Chapter 4
├── docs/                  Calibration, camera setup and known limitations (calibration-and-limitations.md)
└── docs/brand/            Original emblem (logo-source.jpg); web sizes live in dashboard/public/brand/
```

## Acknowledgments

MediaPipe Tasks Vision, React, Vite, Recharts, Express, better-sqlite3.
"# L.I.F.E" 
