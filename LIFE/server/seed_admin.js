/**
 * L.I.F.E. Admin User Seeder
 * Creates the first admin account when no admin exists. The initial password must be changed
 * at first login (must_change_password = 1).
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { initializeDatabase, prepare, closeDatabase } from './db.js';
import { isCloudSyncConfigured } from './lib/cloudSync.js';

export const INITIAL_ADMIN = { username: 'admin', password: 'admin123' };
/** Built-in admin for the online demo (used when LIFE_ADMIN_PASSWORD is not set). */
export const ONLINE_ADMIN = { username: 'admin', password: 'LifeCPR@2026' };

const isCloud = () => Boolean(process.env.RENDER) || process.env.LIFE_CLOUD === '1';

/**
 * Online storage without a persistent disk (e.g. the Render free plan) loses the database on
 * every restart. Override with LIFE_STORAGE=ephemeral|persistent; by default, online storage is
 * persistent when the data is kept in Turso (TURSO_DATABASE_URL) or LIFE_DB_PATH points the
 * database at a disk.
 */
export function isEphemeralCloud() {
    if (!isCloud()) return false;
    if (process.env.LIFE_STORAGE) return process.env.LIFE_STORAGE === 'ephemeral';
    if (isCloudSyncConfigured()) return false;
    return !process.env.LIFE_DB_PATH;
}

/**
 * Password for a newly created first admin.
 *  - LIFE_ADMIN_PASSWORD when set (at least 12 characters).
 *  - Online without it: a random password, printed once to the server log.
 *  - Locally: the documented initial password (the server only accepts local connections).
 */
function initialAdminPassword() {
    // Spaces around the value usually come from copy and paste in a hosting dashboard.
    const configured = (process.env.LIFE_ADMIN_PASSWORD || '').trim();
    if (configured.length >= 12) return { password: configured, source: 'env' };
    if (configured) {
        console.error('LIFE_ADMIN_PASSWORD is shorter than 12 characters, so it was not used.');
    }
    if (isCloud()) return { password: ONLINE_ADMIN.password, source: 'online-default' };
    if (configured) return { password: crypto.randomBytes(12).toString('base64url'), source: 'random' };
    return { password: INITIAL_ADMIN.password, source: 'default' };
}

/** Online without a disk the password must keep working after every wipe, so no forced change. */
const mustChangeAfterSeed = () => (isEphemeralCloud() ? 0 : 1);

function announce(source, password) {
    if (source === 'env') console.log('  Username: admin   Password: the value of LIFE_ADMIN_PASSWORD.');
    else if (source === 'online-default') console.log(`  Username: admin   Password: ${ONLINE_ADMIN.password}  (built-in; set LIFE_ADMIN_PASSWORD to use your own)`);
    else if (source === 'random') console.log(`  One-time password: ${password}`);
    else console.log('  Sign in with the initial password from the README.');
    if (mustChangeAfterSeed()) console.log('  You will be asked to choose a new password at first sign-in.');
    else console.log('  No persistent disk: this admin password is restored at every start (data is not kept).');
}

/** Online without a disk: make sure "admin" signs in with the configured password at every start. */
function syncEphemeralAdmin() {
    const { password, source } = initialAdminPassword();
    const hash = bcrypt.hashSync(password, 10);
    const admin = prepare('SELECT user_id, password_hash FROM users WHERE lower(username) = ?').get(ONLINE_ADMIN.username);
    if (admin) {
        if (!bcrypt.compareSync(password, admin.password_hash)) {
            prepare(`UPDATE users SET password_hash = ?, role = 'admin', trainee_id = NULL, is_active = 1, must_change_password = 0,
                     token_version = token_version + 1 WHERE user_id = ?`).run(hash, admin.user_id);
        } else {
            prepare("UPDATE users SET role = 'admin', trainee_id = NULL, is_active = 1, must_change_password = 0 WHERE user_id = ?")
                .run(admin.user_id);
        }
    } else {
        prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, 'admin', 0)")
            .run(ONLINE_ADMIN.username, hash);
    }
    console.log('Online admin account ready.');
    announce(source, password);
    return prepare('SELECT user_id FROM users WHERE lower(username) = ?').get(ONLINE_ADMIN.username).user_id;
}

/**
 * Recovery switch: with LIFE_RESET_ADMIN=1, the "admin" account is reset to the
 * LIFE_ADMIN_PASSWORD value (or a printed one-time password) at startup, reactivated and
 * signed out everywhere. Remove the setting again afterwards.
 */
function resetAdminIfRequested() {
    if (process.env.LIFE_RESET_ADMIN !== '1') return false;
    const { password, source } = initialAdminPassword();
    const hash = bcrypt.hashSync(password, 10);
    const admin = prepare('SELECT user_id FROM users WHERE lower(username) = ?').get(INITIAL_ADMIN.username);
    if (admin) {
        prepare(`UPDATE users SET password_hash = ?, role = 'admin', trainee_id = NULL, is_active = 1, must_change_password = ?,
                 token_version = token_version + 1 WHERE user_id = ?`).run(hash, mustChangeAfterSeed(), admin.user_id);
    } else {
        prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, 'admin', ?)")
            .run(INITIAL_ADMIN.username, hash, mustChangeAfterSeed());
    }
    console.log('LIFE_RESET_ADMIN=1: the "admin" account was reset. Remove LIFE_RESET_ADMIN after signing in.');
    announce(source, password);
    return true;
}

export function seedAdmin() {
    initializeDatabase();
    if (resetAdminIfRequested()) {
        return { user_id: prepare("SELECT user_id FROM users WHERE lower(username) = 'admin'").get().user_id, created: false };
    }
    if (isEphemeralCloud()) return { user_id: syncEphemeralAdmin(), created: false };

    const existingAdmin = prepare("SELECT user_id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!existingAdmin) {
        const { password, source } = initialAdminPassword();
        const result = prepare(`
            INSERT INTO users (username, password_hash, role, must_change_password)
            VALUES (?, ?, 'admin', ?)
        `).run(INITIAL_ADMIN.username, bcrypt.hashSync(password, 10), mustChangeAfterSeed());

        console.log('Initial admin account created (username "admin").');
        announce(source, password);
        return { user_id: result.lastInsertRowid, created: true };
    }

    // An admin still using the publicly documented default password.
    const defaultAccount = prepare('SELECT user_id, password_hash, must_change_password FROM users WHERE username = ?')
        .get(INITIAL_ADMIN.username);
    if (defaultAccount && bcrypt.compareSync(INITIAL_ADMIN.password, defaultAccount.password_hash)) {
        if (isCloud()) {
            // Online, anyone could sign in with it: replace it before the server accepts requests.
            const { password, source } = initialAdminPassword();
            prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE user_id = ?')
                .run(bcrypt.hashSync(password, 10), defaultAccount.user_id);
            console.log('The admin account used the local default password; it has been replaced.');
            announce(source, password);
        } else if (!defaultAccount.must_change_password) {
            prepare('UPDATE users SET must_change_password = 1 WHERE user_id = ?').run(defaultAccount.user_id);
            console.log('The admin account still uses the default password; a change will be required at next login.');
        }
    }

    return { user_id: existingAdmin.user_id, created: false };
}

// Run directly: node seed_admin.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    seedAdmin();
    closeDatabase();
}
