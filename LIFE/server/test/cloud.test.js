/**
 * Cloud mode (Render): the first admin never gets the public default password, and the
 * sign-in lockout uses each visitor's real address behind the proxy.
 * Runs in its own process with its own database.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-cloud-'));
process.env.LIFE_DB_PATH = path.join(tempDir, 'cloud.db');
process.env.LIFE_SECRET_PATH = path.join(tempDir, 'secret');
process.env.RENDER = 'true';
process.env.LIFE_ADMIN_PASSWORD = 'Cloud-Admin-Pass-2026';

const { createApp } = await import('../index.js');
const { initializeDatabase, closeDatabase } = await import('../db.js');
const { seedAdmin } = await import('../seed_admin.js');
const { resetLoginLockouts } = await import('../routes/auth.js');

let server;
let baseUrl;

const login = (username, password, ip) => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
    body: JSON.stringify({ username, password }),
});

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

test('online, the first admin uses LIFE_ADMIN_PASSWORD, never admin123', async () => {
    assert.equal((await login('admin', 'admin123', '203.0.113.1')).status, 401);
    const ok = await login('admin', 'Cloud-Admin-Pass-2026', '203.0.113.1');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.must_change_password, true);
});

test('behind the proxy, one visitor\'s failed sign-ins do not lock out others', async () => {
    resetLoginLockouts();
    for (let i = 0; i < 6; i += 1) await login(`nobody${i}`, 'wrong', '198.51.100.7');
    // The attacker's address is locked...
    assert.equal((await login('someone', 'wrong', '198.51.100.7')).status, 429);
    // ...but the admin signing in from another address is not.
    assert.equal((await login('admin', 'Cloud-Admin-Pass-2026', '203.0.113.9')).status, 200);
    resetLoginLockouts();
});

test('LIFE_RESET_ADMIN=1 resets the admin password (spaces around the value are ignored)', async () => {
    resetLoginLockouts();
    process.env.LIFE_RESET_ADMIN = '1';
    process.env.LIFE_ADMIN_PASSWORD = '  New-Cloud-Pass-99  ';
    seedAdmin();
    assert.equal((await login('admin', 'Cloud-Admin-Pass-2026', '203.0.113.20')).status, 401);
    const ok = await login('Admin', 'New-Cloud-Pass-99', '203.0.113.20');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.must_change_password, true);
});

test('a too-short LIFE_ADMIN_PASSWORD never crashes startup and is not used', async () => {
    resetLoginLockouts();
    process.env.LIFE_RESET_ADMIN = '1';
    process.env.LIFE_ADMIN_PASSWORD = 'short';
    assert.doesNotThrow(() => seedAdmin()); // a random one-time password is printed instead
    assert.equal((await login('admin', 'short', '203.0.113.30')).status, 401);
    assert.equal((await login('admin', 'New-Cloud-Pass-99', '203.0.113.30')).status, 401);
    delete process.env.LIFE_RESET_ADMIN;
});
