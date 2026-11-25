/**
 * API integration tests (node:test). Each run uses a throwaway database and secret file.
 * Run: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-test-'));
process.env.LIFE_DB_PATH = path.join(tempDir, 'test.db');
process.env.LIFE_SECRET_PATH = path.join(tempDir, 'secret');
process.env.NODE_ENV = 'test';

const { createApp } = await import('../index.js');
const { initializeDatabase, closeDatabase, prepare } = await import('../db.js');
const { seedAdmin, INITIAL_ADMIN } = await import('../seed_admin.js');
const { resetLoginLockouts } = await import('../routes/auth.js');

let server;
let baseUrl;
let adminToken;
let trainerToken;
let traineeId;

async function api(method, url, { token, body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
    initializeDatabase();
    seedAdmin();
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server?.close();
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('initial admin must change password before using the API', async () => {
    const login = await api('POST', '/api/auth/login', { body: INITIAL_ADMIN });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.must_change_password, true);

    const blocked = await api('GET', '/api/trainees', { token: login.json.token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');

    const tooShort = await api('POST', '/api/auth/change-password', {
        token: login.json.token,
        body: { currentPassword: INITIAL_ADMIN.password, newPassword: 'short' },
    });
    assert.equal(tooShort.status, 400);

    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token,
        body: { currentPassword: INITIAL_ADMIN.password, newPassword: 'Admin-pass-2026' },
    });
    assert.equal(changed.status, 200);
    adminToken = changed.json.token;

    // The token issued before the change is revoked.
    const oldToken = await api('GET', '/api/auth/me', { token: login.json.token });
    assert.equal(oldToken.status, 401);

    const ok = await api('GET', '/api/trainees', { token: adminToken });
    assert.equal(ok.status, 200);
});

test('server-side lockout after repeated failed logins', async () => {
    resetLoginLockouts();
    for (let i = 0; i < 5; i += 1) {
        const failed = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
        assert.equal(failed.status, 401);
    }
    const locked = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'Admin-pass-2026' } });
    assert.equal(locked.status, 429);
    resetLoginLockouts();
});

test('forged or tampered tokens are rejected', async () => {
    const [header, payload, signature] = adminToken.split('.');
    const tampered = `${header}.${payload}.${signature.slice(0, -2)}xx`;
    assert.equal((await api('GET', '/api/auth/me', { token: tampered })).status, 401);
    assert.equal((await api('GET', '/api/auth/me', { token: 'not-a-token' })).status, 401);
});

test('admin creates a trainer; trainer must change password; usernames are unique', async () => {
    const created = await api('POST', '/api/users', {
        token: adminToken,
        body: { username: 'trainer1', password: 'Temp-pass-1', role: 'trainer' },
    });
    assert.equal(created.status, 201);

    const duplicate = await api('POST', '/api/users', {
        token: adminToken,
        body: { username: 'TRAINER1', password: 'Temp-pass-1', role: 'trainer' },
    });
    assert.equal(duplicate.status, 409);

    const login = await api('POST', '/api/auth/login', { body: { username: 'trainer1', password: 'Temp-pass-1' } });
    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token,
        body: { currentPassword: 'Temp-pass-1', newPassword: 'Trainer-pass-1' },
    });
    assert.equal(changed.status, 200);
    trainerToken = changed.json.token;
});

test('RBAC: trainers cannot delete or deactivate trainees, manage users or change settings', async () => {
    const created = await api('POST', '/api/trainees', {
        token: trainerToken,
        body: { full_name: 'Juan Dela Cruz', organization: 'Safety Club', consent_given: true },
    });
    assert.equal(created.status, 201);
    traineeId = created.json.trainee.trainee_id;

    assert.equal((await api('DELETE', `/api/trainees/${traineeId}`, { token: trainerToken })).status, 403);
    assert.equal((await api('PUT', `/api/trainees/${traineeId}`, {
        token: trainerToken, body: { is_active: false },
    })).status, 403);
    assert.equal((await api('GET', '/api/users', { token: trainerToken })).status, 403);
    assert.equal((await api('PUT', '/api/settings', {
        token: trainerToken, body: { settings: { pass_mark_pct: 50 } },
    })).status, 403);

    // Trainers may still edit details.
    const edited = await api('PUT', `/api/trainees/${traineeId}`, {
        token: trainerToken, body: { notes: 'Left-handed' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.trainee.notes, 'Left-handed');
});

test('deactivating a user revokes their tokens immediately', async () => {
    const created = await api('POST', '/api/users', {
        token: adminToken,
        body: { username: 'temp_user', password: 'Temp-pass-2', role: 'trainer' },
    });
    const login = await api('POST', '/api/auth/login', { body: { username: 'temp_user', password: 'Temp-pass-2' } });
    assert.equal((await api('GET', '/api/auth/me', { token: login.json.token })).status, 200);

    await api('PUT', `/api/users/${created.json.user.user_id}`, { token: adminToken, body: { is_active: false } });
    assert.equal((await api('GET', '/api/auth/me', { token: login.json.token })).status, 401);
});

test('settings are validated against a whitelist and ranges', async () => {
    assert.equal((await api('PUT', '/api/settings', {
        token: adminToken, body: { settings: { not_a_setting: 1 } },
    })).status, 400);
    assert.equal((await api('PUT', '/api/settings', {
        token: adminToken, body: { settings: { bpm_min: 120, bpm_max: 110 } },
    })).status, 400);
    assert.equal((await api('PUT', '/api/settings', {
        token: adminToken, body: { settings: { angle_threshold: 'abc' } },
    })).status, 400);

    const ok = await api('PUT', '/api/settings', {
        token: adminToken, body: { settings: { pass_mark_pct: 75, bpm_window_intervals: 5 } },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.settings.pass_mark_pct, 75);
    assert.equal(ok.json.settings.bpm_window_intervals, 5);
});

test('sessions: validation, consent, idempotent retries, server-side pass/fail', async () => {
    const base = {
        trainee_id: traineeId,
        duration_sec: 120,
        total_compressions: 200,
        avg_bpm: 110,
        elbow_lock_pct: 90,
        accuracy_pct: 82,
        counts: { correct: 164, incorrect: 36, total: 200, unscorable: 0 },
        details: [{ ts: 1000, bpm: 110, elbow_angle: 170, elbow_locked: true }],
    };

    const invalid = await api('POST', '/api/sessions', {
        token: trainerToken, body: { ...base, accuracy_pct: 150 },
    });
    assert.equal(invalid.status, 400);

    const badDetail = await api('POST', '/api/sessions', {
        token: trainerToken, body: { ...base, details: [{ bpm: 110 }] },
    });
    assert.equal(badDetail.status, 400);

    const first = await api('POST', '/api/sessions', {
        token: trainerToken, body: { ...base, client_session_id: 'abc-123' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.session.result, 'Pass'); // pass mark set to 75 above
    assert.match(first.json.session.date_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const retry = await api('POST', '/api/sessions', {
        token: trainerToken, body: { ...base, client_session_id: 'abc-123' },
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.session.session_id, first.json.session.session_id);
    assert.equal(prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);

    const noConsent = await api('POST', '/api/trainees', {
        token: trainerToken, body: { full_name: 'No Consent', consent_given: false },
    });
    const blocked = await api('POST', '/api/sessions', {
        token: trainerToken, body: { ...base, trainee_id: noConsent.json.trainee.trainee_id },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, 'CONSENT_REQUIRED');

    const detail = await api('GET', `/api/sessions/${first.json.session.session_id}`, { token: trainerToken });
    assert.equal(detail.json.details.length, 1);
    assert.equal(detail.json.details[0].elbow_locked, true);
});

test('date range filters include the whole end day', async () => {
    prepare("UPDATE sessions SET date_time = '2026-11-25 15:30:00'").run();
    const sameDay = await api('GET', '/api/sessions?start_date=2026-11-25&end_date=2026-11-25', { token: trainerToken });
    assert.equal(sameDay.json.sessions.length, 1);
    const before = await api('GET', '/api/sessions?end_date=2026-11-24', { token: trainerToken });
    assert.equal(before.json.sessions.length, 0);

    // ISO instants for local (UTC+8) day 2026-11-25 = 2026-11-24T16:00Z .. 2026-11-25T16:00Z
    const local = await api('GET',
        '/api/sessions?start_date=2026-11-24T16:00:00.000Z&end_date=2026-11-25T16:00:00.000Z',
        { token: trainerToken });
    assert.equal(local.json.sessions.length, 1);

    const leaderboard = await api('GET', '/api/leaderboard?start_date=2026-11-25&end_date=2026-11-25', { token: trainerToken });
    assert.equal(leaderboard.json.leaderboard.length, 1);
});

test('sessions-today uses the client time zone', async () => {
    // A session at 23:30 UTC is "tomorrow" in the Philippines (UTC+8).
    prepare("UPDATE sessions SET date_time = datetime('now', 'start of day', '+23 hours', '+30 minutes')").run();
    const utc = await api('GET', '/api/stats/dashboard?tz_offset_min=0', { token: trainerToken });
    const manila = await api('GET', '/api/stats/dashboard?tz_offset_min=-480', { token: trainerToken });
    assert.equal(utc.json.stats.sessions_today, 1);
    assert.equal(manila.json.stats.sessions_today, 0);
});

test('certificate escapes HTML and CSV export neutralizes formulas', async () => {
    const evil = await api('POST', '/api/trainees', {
        token: trainerToken,
        body: { full_name: '<img src=x onerror=alert(1)>', organization: '=HYPERLINK("http://x")', consent_given: true },
    });
    const session = await api('POST', '/api/sessions', {
        token: trainerToken,
        body: { trainee_id: evil.json.trainee.trainee_id, accuracy_pct: 50, total_compressions: 10 },
    });

    const certificate = await api('GET', `/api/export/certificate/${session.json.session.session_id}`, { token: trainerToken });
    assert.equal(certificate.status, 200);
    assert.ok(!certificate.text.includes('<img src=x'));
    assert.ok(certificate.text.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.match(certificate.headers.get('content-disposition'), /filename\*=UTF-8''/);

    const csv = await api('GET', '/api/export/trainees', { token: trainerToken });
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes(`'=HYPERLINK`));
});

test('backup writes a database file', async () => {
    const backup = await api('POST', '/api/settings/backup', { token: adminToken });
    assert.equal(backup.status, 200);
    assert.ok(fs.existsSync(backup.json.path));
    fs.rmSync(backup.json.path);
});

test('unknown API routes return JSON 404 and malformed JSON returns 400', async () => {
    assert.equal((await api('GET', '/api/nope', { token: adminToken })).status, 404);
    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
    });
    assert.equal(malformed.status, 400);
});

test('last active admin cannot be demoted or deleted', async () => {
    const admin = prepare("SELECT user_id FROM users WHERE username = 'admin'").get();
    const other = await api('POST', '/api/users', {
        token: adminToken, body: { username: 'admin2', password: 'Admin2-pass-1', role: 'admin' },
    });
    // admin2 tries to demote admin -> allowed because admin2 remains
    const login = await api('POST', '/api/auth/login', { body: { username: 'admin2', password: 'Admin2-pass-1' } });
    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: 'Admin2-pass-1', newPassword: 'Admin2-pass-2' },
    });
    const demote = await api('PUT', `/api/users/${admin.user_id}`, { token: changed.json.token, body: { role: 'trainer' } });
    assert.equal(demote.status, 200);
    // now admin2 is the only admin; it cannot delete itself and nobody can demote it
    assert.equal((await api('DELETE', `/api/users/${other.json.user.user_id}`, { token: changed.json.token })).status, 400);
});

test('setup: fresh admin and trainer tokens for the account tests', async () => {
    // The previous test demoted the original admin (revoking its token); admin2 is the admin now.
    const admin = await api('POST', '/api/auth/login', { body: { username: 'admin2', password: 'Admin2-pass-2' } });
    assert.equal(admin.status, 200);
    adminToken = admin.json.token;
    await api('POST', '/api/users', { token: adminToken, body: { username: 'trainer3', password: 'Trainer3-pass-1', role: 'trainer' } });
    const login = await api('POST', '/api/auth/login', { body: { username: 'trainer3', password: 'Trainer3-pass-1' } });
    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: 'Trainer3-pass-1', newPassword: 'Trainer3-pass-2' },
    });
    assert.equal(changed.status, 200);
    trainerToken = changed.json.token;
});

test('admin creates a trainee with a sign-in account; trainee sees only their own progress', async () => {
    const created = await api('POST', '/api/trainees', {
        token: adminToken,
        body: { full_name: 'María Dela Cruz', organization: 'Club A', notes: 'private trainer note', consent_given: true, create_account: true },
    });
    assert.equal(created.status, 201);
    const { username, temporary_password: temp } = created.json.account;
    assert.equal(username, 'maria.delacruz');
    assert.match(temp, /^[A-Za-z0-9]{10}$/);
    assert.deepEqual(created.json.trainee.account, { username, is_active: true, must_change_password: true });
    const newTraineeId = created.json.trainee.trainee_id;

    // Same name again: the username gets a number.
    const twin = await api('POST', '/api/trainees', { token: adminToken, body: { full_name: 'Maria Dela Cruz', create_account: true } });
    assert.equal(twin.json.account.username, 'maria.delacruz2');

    // Trainers can add trainees but not create sign-in accounts.
    const byTrainer = await api('POST', '/api/trainees', { token: trainerToken, body: { full_name: 'No Account', create_account: true } });
    assert.equal(byTrainer.status, 403);

    // First sign-in requires a new password.
    const login = await api('POST', '/api/auth/login', { body: { username, password: temp } });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.role, 'trainee');
    assert.equal(login.json.user.trainee_id, newTraineeId);
    assert.equal((await api('GET', '/api/me/progress', { token: login.json.token })).status, 403);
    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token,
        body: { currentPassword: temp, newPassword: 'Trainee-pass-1' },
    });
    assert.equal(changed.status, 200);
    const traineeToken = changed.json.token;

    const progress = await api('GET', '/api/me/progress', { token: traineeToken });
    assert.equal(progress.status, 200);
    assert.equal(progress.json.trainee.full_name, 'María Dela Cruz');
    assert.equal(progress.json.trainee.notes, undefined); // trainer notes are not shown
    assert.deepEqual(progress.json.sessions, []);

    // Staff data stays closed to trainee accounts.
    // (GET /api/settings is readable for self-practice; changing settings is tested below.)
    for (const url of ['/api/trainees', '/api/sessions', '/api/leaderboard', '/api/users', '/api/live', `/api/stats/trainee/${traineeId}`, '/api/export/trainees']) {
        assert.equal((await api('GET', url, { token: traineeToken })).status, 403, url);
    }
    // Staff cannot use the trainee route.
    assert.equal((await api('GET', '/api/me/progress', { token: adminToken })).status, 403);

    // Trainee accounts are hidden from, and protected in, the staff user list.
    const users = await api('GET', '/api/users', { token: adminToken });
    assert.ok(users.json.users.every(user => user.role !== 'trainee'));
    const traineeUserId = prepare('SELECT user_id FROM users WHERE username = ?').get(username).user_id;
    assert.equal((await api('PUT', `/api/users/${traineeUserId}`, { token: adminToken, body: { role: 'admin' } })).status, 409);

    // Reset: old password stops working, the new temporary one works and must be changed.
    const reset = await api('POST', `/api/trainees/${newTraineeId}/account/reset`, { token: adminToken });
    assert.equal(reset.status, 200);
    assert.equal((await api('GET', '/api/me/progress', { token: traineeToken })).status, 401); // signed out
    assert.equal((await api('POST', '/api/auth/login', { body: { username, password: 'Trainee-pass-1' } })).status, 401);
    const relog = await api('POST', '/api/auth/login', { body: { username, password: reset.json.account.temporary_password } });
    assert.equal(relog.json.user.must_change_password, true);

    // Deactivating the trainee disables the account.
    assert.equal((await api('DELETE', `/api/trainees/${newTraineeId}`, { token: adminToken })).status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { username, password: reset.json.account.temporary_password } })).status, 401);
    const listed = await api('GET', `/api/trainees/${newTraineeId}`, { token: adminToken });
    assert.equal(listed.json.trainee.account.is_active, false);

    // Reactivating restores it.
    await api('PUT', `/api/trainees/${newTraineeId}`, { token: adminToken, body: { is_active: true } });
    assert.equal((await api('POST', '/api/auth/login', { body: { username, password: reset.json.account.temporary_password } })).status, 200);
});

test('create a sign-in account for an existing trainee (admin only, once)', async () => {
    const plain = await api('POST', '/api/trainees', { token: trainerToken, body: { full_name: 'Pedro Santos' } });
    const id = plain.json.trainee.trainee_id;
    assert.equal(plain.json.trainee.account, null);
    assert.equal((await api('POST', `/api/trainees/${id}/account`, { token: trainerToken })).status, 403);
    const custom = await api('POST', `/api/trainees/${id}/account`, { token: adminToken, body: { username: 'Pedro_S' } });
    assert.equal(custom.status, 201);
    assert.equal(custom.json.account.username, 'pedro_s');
    assert.equal((await api('POST', `/api/trainees/${id}/account`, { token: adminToken })).status, 400);
    const bad = await api('POST', '/api/trainees', { token: adminToken, body: { full_name: 'X', create_account: true, username: 'a b' } });
    assert.equal(bad.status, 400);
});

test('trainee self-practice: own sessions only, flagged by the server, live status scoped', async () => {
    const created = await api('POST', '/api/trainees', {
        token: adminToken, body: { full_name: 'Self Practice', consent_given: true, create_account: true },
    });
    const ownId = created.json.trainee.trainee_id;
    const { username, temporary_password: temp } = created.json.account;
    const login = await api('POST', '/api/auth/login', { body: { username, password: temp } });
    const changed = await api('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: temp, newPassword: 'Self-pass-123' },
    });
    const token = changed.json.token;

    // Settings are readable for practice; changing them is not.
    assert.equal((await api('GET', '/api/settings', { token })).status, 200);
    assert.equal((await api('PUT', '/api/settings', { token, body: { settings: { pass_mark_pct: 50 } } })).status, 403);

    const session = (traineeIdValue, extra = {}) => ({
        client_session_id: `self-${Math.random()}`,
        trainee_id: traineeIdValue,
        duration_sec: 120,
        total_compressions: 200,
        avg_bpm: 110,
        elbow_lock_pct: 90,
        accuracy_pct: 88,
        counts: { correct: 176, incorrect: 24, total: 200, self_practice: 0, ...extra },
        details: [{ ts: 1000, bpm: 110, elbow_angle: 170, elbow_locked: true }],
    });

    // Own session: saved and flagged as self-practice by the server.
    const saved = await api('POST', '/api/sessions', { token, body: session(ownId) });
    assert.equal(saved.status, 201);
    assert.equal(saved.json.session.counts.self_practice, 1);
    assert.equal(saved.json.session.result, 'Pass');

    // Another trainee's session: refused.
    assert.equal((await api('POST', '/api/sessions', { token, body: session(traineeId) })).status, 403);

    // Staff cannot fake the flag.
    const staff = await api('POST', '/api/sessions', { token: trainerToken, body: session(ownId, { self_practice: 1 }) });
    assert.equal(staff.status, 201);
    assert.equal(staff.json.session.counts.self_practice, undefined);

    // Shows up in the trainee's own progress.
    const progress = await api('GET', '/api/me/progress', { token });
    assert.equal(progress.json.sessions.length, 2);
    assert.equal(progress.json.trainee.consent_given, true);

    // Live status: own trainee only; reset cannot clear someone else's live session.
    assert.equal((await api('POST', '/api/live', { token, body: { trainee_id: ownId, status: 'In Progress', compressions: 5 } })).status, 200);
    assert.equal((await api('POST', '/api/live', { token, body: { trainee_id: traineeId, status: 'In Progress' } })).status, 403);
    await api('POST', '/api/live', { token: trainerToken, body: { trainee_id: traineeId, status: 'In Progress', compressions: 9 } });
    await api('POST', '/api/live/reset', { token });
    const live = await api('GET', '/api/live', { token: trainerToken });
    assert.equal(live.json.live.status, 'In Progress');
    assert.equal(live.json.live.trainee_id, traineeId);
    assert.equal((await api('GET', '/api/live', { token })).status, 403); // the monitor stays staff-only

    // Without consent the trainee gets a clear message.
    await api('PUT', `/api/trainees/${ownId}`, { token: adminToken, body: { consent_given: false } });
    const noConsent = await api('POST', '/api/sessions', { token, body: session(ownId) });
    assert.equal(noConsent.status, 409);
    assert.match(noConsent.json.error, /Ask your trainer/);
});

test('self-practice sessions are excluded from the leaderboard and dashboard top 5', async () => {
    const created = await api('POST', '/api/trainees', {
        token: adminToken, body: { full_name: 'Solo Ranker', organization: 'Solo Club', consent_given: true, create_account: true },
    });
    const id = created.json.trainee.trainee_id;
    const { username, temporary_password: temp } = created.json.account;
    const login = await api('POST', '/api/auth/login', { body: { username, password: temp } });
    const token = (await api('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: temp, newPassword: 'Solo-pass-123' },
    })).json.token;

    const body = accuracy => ({
        client_session_id: `rank-${Math.random()}`, trainee_id: id, duration_sec: 120, total_compressions: 200,
        avg_bpm: 110, elbow_lock_pct: 95, accuracy_pct: accuracy, counts: { correct: 190, incorrect: 10, total: 200 },
    });

    // A perfect self-practice session must not put the trainee on the leaderboard.
    assert.equal((await api('POST', '/api/sessions', { token, body: body(100) })).status, 201);
    const ranked = (await api('GET', '/api/leaderboard?limit=500', { token: adminToken })).json.leaderboard;
    assert.equal(ranked.some(entry => entry.trainee_id === id), false);
    const top5 = (await api('GET', '/api/stats/dashboard', { token: adminToken })).json.top5 ?? [];
    assert.equal(top5.some(entry => entry.trainee_id === id), false);
    const orgs = (await api('GET', '/api/leaderboard/organizations', { token: adminToken })).json.organizations;
    assert.equal(orgs.find(org => org.organization === 'Solo Club')?.session_count ?? 0, 0);

    // A supervised session counts; the self-practice one still does not.
    assert.equal((await api('POST', '/api/sessions', { token: trainerToken, body: body(60) })).status, 201);
    const after = (await api('GET', '/api/leaderboard?limit=500', { token: adminToken })).json.leaderboard;
    const entry = after.find(item => item.trainee_id === id);
    assert.ok(entry);
    assert.equal(entry.total_sessions, 1);
    assert.equal(entry.avg_accuracy, 60);

    // The trainee's own progress still includes both.
    assert.equal((await api('GET', '/api/me/progress', { token })).json.sessions.length, 2);
});

test('dashboard statistics ignore self-practice; the recent feed still lists it', async () => {
    const created = await api('POST', '/api/trainees', {
        token: adminToken, body: { full_name: 'Dash Solo', consent_given: true, create_account: true },
    });
    const id = created.json.trainee.trainee_id;
    const { username, temporary_password: temp } = created.json.account;
    const login = await api('POST', '/api/auth/login', { body: { username, password: temp } });
    const token = (await api('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: temp, newPassword: 'Dash-pass-123' },
    })).json.token;

    const offset = new Date().getTimezoneOffset();
    const before = (await api('GET', `/api/stats/dashboard?tz_offset_min=${offset}`, { token: adminToken })).json;

    const saved = await api('POST', '/api/sessions', {
        token,
        body: {
            client_session_id: `dash-${Math.random()}`, trainee_id: id, duration_sec: 120, total_compressions: 220,
            avg_bpm: 150, elbow_lock_pct: 100, accuracy_pct: 100, counts: { correct: 220, incorrect: 0, total: 220 },
        },
    });
    assert.equal(saved.status, 201);

    const after = (await api('GET', `/api/stats/dashboard?tz_offset_min=${offset}`, { token: adminToken })).json;
    assert.equal(after.stats.sessions_today, before.stats.sessions_today);
    assert.equal(after.stats.avg_accuracy, before.stats.avg_accuracy);
    assert.equal(after.stats.avg_bpm, before.stats.avg_bpm);
    assert.deepEqual(after.accuracy_trend, before.accuracy_trend);

    const recent = after.recent_sessions.find(session => session.session_id === saved.json.session.session_id);
    assert.ok(recent, 'self-practice appears in the recent feed');
    assert.equal(recent.counts.self_practice, 1);
});

test('sign-in ignores username capitals; lockout still counts every variant together', async () => {
    resetLoginLockouts();
    const created = await api('POST', '/api/trainees', { token: adminToken, body: { full_name: 'Case Tester', create_account: true } });
    const { username, temporary_password: temp } = created.json.account;
    assert.equal(username, 'case.tester');
    for (const variant of ['Case.Tester', 'CASE.TESTER', ' case.tester ']) {
        const login = await api('POST', '/api/auth/login', { body: { username: variant, password: temp } });
        assert.equal(login.status, 200, variant);
        assert.equal(login.json.user.username, 'case.tester');
    }
    // Wrong passwords under different capitalizations share one lockout counter.
    for (const variant of ['case.tester', 'Case.Tester', 'CASE.tester', 'case.TESTER', 'Case.tester']) {
        await api('POST', '/api/auth/login', { body: { username: variant, password: 'wrong-password' } });
    }
    assert.equal((await api('POST', '/api/auth/login', { body: { username: 'CASE.TESTER', password: temp } })).status, 429);
    resetLoginLockouts();
});

test('Reports & Export: PDF downloads (sessions, trainees, test data, certificate)', async () => {
    const download = async (url, token) => {
        const response = await fetch(`${baseUrl}${url}`, { headers: { Authorization: `Bearer ${token}` } });
        const bytes = Buffer.from(await response.arrayBuffer());
        return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), bytes };
    };
    const isPdf = file => file.bytes.subarray(0, 5).toString() === '%PDF-' && file.bytes.length > 1000;

    // A trainee with characters the built-in PDF fonts cannot show must not break the report.
    const created = await api('POST', '/api/trainees', { token: adminToken, body: { full_name: 'Zoë Ñuñez 李', organization: 'PDF Club', consent_given: true } });
    const saved = await api('POST', '/api/sessions', {
        token: trainerToken,
        body: {
            client_session_id: `pdf-${Math.random()}`, trainee_id: created.json.trainee.trainee_id, duration_sec: 120, total_compressions: 210,
            avg_bpm: 111.4, elbow_lock_pct: 92.5, accuracy_pct: 86.7, counts: { correct: 182, incorrect: 28, total: 210, procedure_pct: 88.9 },
            details: [{ ts: 1000, bpm: 110, elbow_angle: 168, elbow_locked: true }, { ts: 1545, bpm: 111, elbow_angle: null, elbow_locked: false }],
        },
    });
    assert.equal(saved.status, 201);
    const sessionId = saved.json.session.session_id;
    const tz = 'tz_offset_min=-480';

    for (const [url, token, name] of [
        [`/api/export/sessions?format=pdf&${tz}`, trainerToken, 'life_sessions_'],
        [`/api/export/sessions?format=pdf&trainee_id=${created.json.trainee.trainee_id}&${tz}`, trainerToken, 'life_sessions_'],
        [`/api/export/trainees?format=pdf&${tz}`, trainerToken, 'life_trainees_'],
        [`/api/export/test-data?format=pdf&session_id=${sessionId}&${tz}`, adminToken, 'life_test_data_'],
        [`/api/export/certificate/${sessionId}?format=pdf&${tz}`, trainerToken, 'certificate_'],
    ]) {
        const file = await download(url, token);
        assert.equal(file.status, 200, url);
        assert.equal(file.type, 'application/pdf', url);
        assert.ok(isPdf(file), `${url} returns a PDF`);
        assert.match(file.disposition, new RegExp(`filename="${name}[^"]*\\.pdf"`), url);
    }

    // CSV is still available for spreadsheets and the evaluation script.
    const csv = await download(`/api/export/test-data?session_id=${sessionId}`, adminToken);
    assert.match(csv.type, /text\/csv/);

    // Test data stays admin-only, and trainee accounts cannot export at all.
    assert.equal((await download('/api/export/test-data?format=pdf', trainerToken)).status, 403);
    const account = await api('POST', `/api/trainees/${created.json.trainee.trainee_id}/account`, { token: adminToken });
    const traineeLogin = await api('POST', '/api/auth/login', { body: { username: account.json.account.username, password: account.json.account.temporary_password } });
    const traineeToken = (await api('POST', '/api/auth/change-password', {
        token: traineeLogin.json.token, body: { currentPassword: account.json.account.temporary_password, newPassword: 'Zoe-pass-2026' },
    })).json.token;
    assert.equal((await download('/api/export/sessions?format=pdf', traineeToken)).status, 403);
    assert.equal((await download(`/api/export/certificate/${sessionId}?format=pdf`, traineeToken)).status, 403);
});
