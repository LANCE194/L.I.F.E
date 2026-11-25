-- L.I.F.E. Database Schema
-- SQLite database (better-sqlite3) for Localized Intelligent First-aid Evaluator
-- Tables: trainees, sessions, session_details, users, settings, live_status
-- All timestamps are stored in UTC ("YYYY-MM-DD HH:MM:SS"); the API returns them as ISO-8601 with "Z".
-- PRAGMAs (WAL, foreign keys) are applied by server/db.js when the connection opens.
-- Columns added after v1 are applied by the migration step in server/db.js.

-- Trainees table
CREATE TABLE IF NOT EXISTS trainees (
    trainee_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    organization TEXT,
    notes TEXT,
    consent_given INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    date_registered TEXT DEFAULT (datetime('now'))
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_session_id TEXT,
    trainee_id INTEGER NOT NULL,
    date_time TEXT DEFAULT (datetime('now')),
    duration_sec INTEGER DEFAULT 0,
    total_compressions INTEGER DEFAULT 0,
    avg_bpm REAL DEFAULT 0,
    elbow_lock_pct REAL DEFAULT 0,
    accuracy_pct REAL DEFAULT 0,
    counts TEXT DEFAULT '{}', -- JSON: {correct, incorrect, total, unscorable, fps, latency_ms}
    procedure_steps TEXT DEFAULT '{}', -- JSON: trainer-confirmed rescue steps and tracked CPR start
    result TEXT DEFAULT 'Needs Improvement', -- 'Pass' or 'Needs Improvement'
    FOREIGN KEY (trainee_id) REFERENCES trainees(trainee_id) ON DELETE CASCADE
);

-- Session details table (frame-by-frame or cycle-by-cycle data)
CREATE TABLE IF NOT EXISTS session_details (
    detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    ts INTEGER NOT NULL, -- timestamp in milliseconds
    bpm REAL,
    elbow_angle REAL,
    elbow_locked INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Users table (Admin/Trainer)
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'trainer', 'trainee')),
    trainee_id INTEGER REFERENCES trainees(trainee_id) ON DELETE CASCADE, -- set only for trainee accounts
    is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0, -- 1 = user must set a new password at next login
    token_version INTEGER DEFAULT 0,        -- bumped to revoke all issued tokens
    created_at TEXT DEFAULT (datetime('now')),
    CHECK ((role = 'trainee') = (trainee_id IS NOT NULL))
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('angle_threshold', '160'),
    ('smoothing_window', '5'),
    ('min_peak_distance_ms', '400'),
    ('peak_prominence', '0.02'),
    ('bpm_min', '100'),
    ('bpm_max', '120'),
    ('session_duration_sec', '120'),
    ('pass_mark_pct', '80'),
    ('camera_width', '1280'),
    ('camera_height', '720'),
    ('camera_framerate', '30'),
    ('visibility_threshold', '0.5'),
    ('bpm_window_intervals', '4'),
    ('metronome_bpm', '110');

-- Live status table (single row, id=1)
CREATE TABLE IF NOT EXISTS live_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    trainee_id INTEGER,
    status TEXT DEFAULT 'Waiting', -- 'Waiting', 'In Progress', 'Completed'
    accuracy_pct REAL DEFAULT 0,
    bpm REAL DEFAULT 0,
    elbow_lock_pct REAL DEFAULT 0,
    compressions INTEGER DEFAULT 0,
    elapsed_sec INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (trainee_id) REFERENCES trainees(trainee_id) ON DELETE SET NULL
);

-- Insert default live_status row
INSERT OR IGNORE INTO live_status (id) VALUES (1);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_trainee ON sessions(trainee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date_time);
CREATE INDEX IF NOT EXISTS idx_session_details_session ON session_details(session_id);
CREATE INDEX IF NOT EXISTS idx_trainees_active ON trainees(is_active);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);