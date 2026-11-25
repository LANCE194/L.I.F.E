/**
 * L.I.F.E. Admin User Seeder
 * Creates the first admin account when no admin exists. The initial password must be changed
 * at first login (must_change_password = 1).
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { initializeDatabase, prepare, closeDatabase } from './db.js';

export const INITIAL_ADMIN = { username: 'admin', password: 'admin123' };

const isCloud = () => Boolean(process.env.RENDER) || process.env.LIFE_CLOUD === '1';

/**
 * Password for a newly created first admin.
 *  - LIFE_ADMIN_PASSWORD when set (at least 12 characters).
 *  - Online without it: a random password, printed once to the server log.
 *  - Locally: the documented initial password (the server only accepts local connections).
 */
function initialAdminPassword() {
    const configured = process.env.LIFE_ADMIN_PASSWORD;
    if (configured) {
        if (configured.length < 12) throw new Error('LIFE_ADMIN_PASSWORD must be at least 12 characters');
        return { password: configured, source: 'env' };
    }
    if (isCloud()) return { password: crypto.randomBytes(12).toString('base64url'), source: 'random' };
    return { password: INITIAL_ADMIN.password, source: 'default' };
}

export function seedAdmin() {
    initializeDatabase();

    const existingAdmin = prepare("SELECT user_id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!existingAdmin) {
        const { password, source } = initialAdminPassword();
        const result = prepare(`
            INSERT INTO users (username, password_hash, role, must_change_password)
            VALUES (?, ?, 'admin', 1)
        `).run(INITIAL_ADMIN.username, bcrypt.hashSync(password, 10));

        console.log('Initial admin account created (username "admin").');
        if (source === 'env') console.log('  Password: the value of LIFE_ADMIN_PASSWORD.');
        else if (source === 'random') console.log(`  One-time password: ${password}  (set LIFE_ADMIN_PASSWORD to choose your own)`);
        else console.log('  Sign in with the initial password from the README.');
        console.log('  You will be asked to choose a new password immediately.');
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
            console.log('The admin account used the default password; it has been replaced.');
            if (source === 'random') console.log(`  One-time password: ${password}`);
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
