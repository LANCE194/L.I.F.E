/**
 * Online demo without a persistent disk (e.g. Render free plan): the built-in admin
 * (admin / LifeCPR@2026) works right after deploying and again after every restart.
 * Runs in its own process with its own database.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-demo-'));
process.env.LIFE_DB_PATH = path.join(tempDir, 'demo.db');
process.env.LIFE_SECRET_PATH = path.join(tempDir, 'secret');
process.env.RENDER = 'true';
process.env.LIFE_STORAGE = 'ephemeral';
delete process.env.LIFE_ADMIN_PASSWORD;
delete process.env.LIFE_RESET_ADMIN;

const { createApp } = await import('../index.js');
const { initializeDatabase, closeDatabase } = await import('../db.js');
const { seedAdmin, ONLINE_ADMIN } = await import('../seed_admin.js');

let server;
let baseUrl;

async function call(method, url, { body, token } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'X-Forwarded-For': '192.0.2.10',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
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

test('built-in online admin signs in straight away, without a forced password change', async () => {
    assert.deepEqual(ONLINE_ADMIN, { username: 'admin', password: 'LifeCPR@2026' });
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })).status, 401);
    const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'LifeCPR@2026' } });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.must_change_password, false);
    // Full access immediately (no "password change required").
    assert.equal((await call('GET', '/api/trainees', { token: login.json.token })).status, 200);
});

test('after a restart the built-in password works again, even if it was changed before', async () => {
    const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'LifeCPR@2026' } });
    const changed = await call('POST', '/api/auth/change-password', {
        token: login.json.token, body: { currentPassword: 'LifeCPR@2026', newPassword: 'Changed-Before-Restart' },
    });
    assert.equal(changed.status, 200);

    seedAdmin(); // what happens at the next start

    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'Admin', password: 'LifeCPR@2026' } })).status, 200);
});

test('opening API addresses in a browser explains instead of a bare "Not found"', async () => {
    const root = await call('GET', '/api');
    assert.equal(root.status, 200);
    assert.match(root.json.hint, /without \/api/);
    const loginGet = await call('GET', '/api/auth/login');
    assert.equal(loginGet.status, 405);
    assert.match(loginGet.json.error, /sign-in page/);
    const unknown = await call('GET', '/api/nothing-here');
    assert.equal(unknown.status, 404);
    assert.match(unknown.json.hint, /without \/api/);
});
