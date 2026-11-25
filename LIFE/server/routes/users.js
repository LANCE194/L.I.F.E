/**
 * L.I.F.E. User Management Routes (admin only)
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { prepare } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { adminOnly } from '../middleware/roles.js';
import { optionalString, optionalBoolean, requiredId, validatePassword, fail } from '../lib/validate.js';

const router = express.Router();

router.use(authenticate);
router.use(adminOnly);

const USER_COLUMNS = 'user_id, username, role, is_active, must_change_password, created_at';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

function toPublic(user) {
    return {
        ...user,
        is_active: Boolean(user.is_active),
        must_change_password: Boolean(user.must_change_password),
    };
}

function validateUsername(value) {
    const username = optionalString(value, 'Username', { maxLength: 32, required: true });
    if (!USERNAME_PATTERN.test(username)) {
        fail('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
    }
    return username;
}

function usernameTaken(username, exceptUserId = null) {
    const existing = prepare('SELECT user_id FROM users WHERE lower(username) = lower(?)').get(username);
    return existing && existing.user_id !== exceptUserId;
}

function activeAdminCount() {
    return prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
}

router.get('/', (req, res) => {
    // Trainee accounts are managed from the Trainees page.
    const users = prepare(`SELECT ${USER_COLUMNS} FROM users WHERE role != 'trainee' ORDER BY created_at DESC`).all();
    res.json({ users: users.map(toPublic) });
});

router.post('/', (req, res) => {
    const { password, role } = req.body || {};
    const username = validateUsername(req.body?.username);

    if (!['admin', 'trainer'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or trainer' });
    }
    validatePassword(password);

    if (usernameTaken(username)) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    // New accounts must choose their own password at first login.
    const result = prepare(`
        INSERT INTO users (username, password_hash, role, must_change_password)
        VALUES (?, ?, ?, 1)
    `).run(username, bcrypt.hashSync(password, 10), role);

    const user = prepare(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`).get(result.lastInsertRowid);
    res.status(201).json({ user: toPublic(user) });
});

router.put('/:id', (req, res) => {
    const target = prepare('SELECT role FROM users WHERE user_id = ?').get(Number(req.params.id));
    if (target?.role === 'trainee') {
        return res.status(409).json({ error: 'Trainee accounts are managed from the Trainees page' });
    }
    const userId = requiredId(req.params.id, 'User ID');
    const user = prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const body = req.body || {};
    const isSelf = req.user.userId === userId;
    const username = body.username !== undefined ? validateUsername(body.username) : user.username;
    const role = body.role !== undefined ? body.role : user.role;
    const isActive = optionalBoolean(body.is_active, 'is_active');

    if (!['admin', 'trainer'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or trainer' });
    }
    if (isSelf && isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    if (isSelf && role !== user.role) {
        return res.status(400).json({ error: 'You cannot change your own role' });
    }
    if (usernameTaken(username, userId)) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    const losesAdmin = user.role === 'admin' && user.is_active && (role !== 'admin' || isActive === false);
    if (losesAdmin && activeAdminCount() <= 1) {
        return res.status(400).json({ error: 'At least one active admin account is required' });
    }

    let passwordHash = user.password_hash;
    let mustChange = user.must_change_password;
    if (body.password) {
        validatePassword(body.password);
        passwordHash = bcrypt.hashSync(body.password, 10);
        mustChange = 1; // an admin-set password is temporary
    }

    const nextActive = isActive === undefined ? user.is_active : (isActive ? 1 : 0);
    // Revoke existing sessions when credentials, role or access change.
    const revoke = Boolean(body.password) || role !== user.role || nextActive !== user.is_active;

    prepare(`
        UPDATE users
        SET username = ?, password_hash = ?, role = ?, is_active = ?, must_change_password = ?,
            token_version = token_version + ?
        WHERE user_id = ?
    `).run(username, passwordHash, role, nextActive, mustChange, revoke ? 1 : 0, userId);

    const updated = prepare(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`).get(userId);
    res.json({ user: toPublic(updated) });
});

router.delete('/:id', (req, res) => {
    const target = prepare('SELECT role FROM users WHERE user_id = ?').get(Number(req.params.id));
    if (target?.role === 'trainee') {
        return res.status(409).json({ error: 'Trainee accounts are managed from the Trainees page' });
    }
    const userId = requiredId(req.params.id, 'User ID');
    if (req.user.userId === userId) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const user = prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    if (user.role === 'admin' && user.is_active && activeAdminCount() <= 1) {
        return res.status(400).json({ error: 'At least one active admin account is required' });
    }

    prepare('DELETE FROM users WHERE user_id = ?').run(userId);
    res.json({ message: 'User deleted' });
});

export default router;
