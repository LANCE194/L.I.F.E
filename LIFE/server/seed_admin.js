/**
 * L.I.F.E. Admin User Seeder
 * Creates the first admin account when no admin exists. The initial password must be changed
 * at first login (must_change_password = 1).
 */

import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'url';
import { initializeDatabase, prepare, closeDatabase } from './db.js';

export const INITIAL_ADMIN = { username: 'admin', password: 'admin123' };

export function seedAdmin() {
    initializeDatabase();

    const existingAdmin = prepare("SELECT user_id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!existingAdmin) {
        const result = prepare(`
            INSERT INTO users (username, password_hash, role, must_change_password)
            VALUES (?, ?, 'admin', 1)
        `).run(INITIAL_ADMIN.username, bcrypt.hashSync(INITIAL_ADMIN.password, 10));

        console.log('Initial admin account created.');
        console.log(`  Sign in as "${INITIAL_ADMIN.username}" with the initial password from the README;`);
        console.log('  you will be asked to choose a new password immediately.');
        return { user_id: result.lastInsertRowid, created: true };
    }

    // Databases from earlier versions: force a change if the default password is still in use.
    const defaultAccount = prepare('SELECT user_id, password_hash, must_change_password FROM users WHERE username = ?')
        .get(INITIAL_ADMIN.username);
    if (defaultAccount && !defaultAccount.must_change_password &&
        bcrypt.compareSync(INITIAL_ADMIN.password, defaultAccount.password_hash)) {
        prepare('UPDATE users SET must_change_password = 1 WHERE user_id = ?').run(defaultAccount.user_id);
        console.log('The admin account still uses the default password; a change will be required at next login.');
    }

    return { user_id: existingAdmin.user_id, created: false };
}

// Run directly: node seed_admin.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    seedAdmin();
    closeDatabase();
}
