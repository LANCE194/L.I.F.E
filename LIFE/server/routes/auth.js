/**
 * L.I.F.E. Authentication Routes
 * Login (with server-side lockout), logout (token revocation), current user, password change.
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { prepare } from '../db.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import { validatePassword, handle } from '../lib/validate.js';

const router = express.Router();

// Compared against when the username doesn't exist, to keep timing uniform.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', 10);

// ---- Failed-login lockout (per username and per client address) ----
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const failedAttempts = new Map(); // key -> { count, lockedUntil, lastFailure }

function lockoutKeys(req, username) {
    return [`user:${String(username).toLowerCase()}`, `ip:${req.ip}`];
}

function lockedForMs(keys) {
    const now = Date.now();
    let remaining = 0;
    for (const key of keys) {
        const entry = failedAttempts.get(key);
        if (entry?.lockedUntil && entry.lockedUntil > now) {
            remaining = Math.max(remaining, entry.lockedUntil - now);
        }
    }
    return remaining;
}

function recordFailure(keys) {
    const now = Date.now();
    for (const key of keys) {
        const entry = failedAttempts.get(key) || { count: 0, lockedUntil: 0, lastFailure: 0 };
        // Forget old failures after the lockout window.
        if (now - entry.lastFailure > LOCKOUT_MS) entry.count = 0;
        entry.count += 1;
        entry.lastFailure = now;
        if (entry.count >= MAX_FAILED_ATTEMPTS) {
            entry.lockedUntil = now + LOCKOUT_MS;
            entry.count = 0;
        }
        failedAttempts.set(key, entry);
    }
}

function clearFailures(keys) {
    for (const key of keys) failedAttempts.delete(key);
}

export function resetLoginLockouts() {
    failedAttempts.clear();
}

function publicUser(user) {
    return {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        trainee_id: user.trainee_id ?? null,
        is_active: Boolean(user.is_active),
        must_change_password: Boolean(user.must_change_password),
        created_at: user.created_at,
    };
}

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const keys = lockoutKeys(req, username.trim());
    const lockedMs = lockedForMs(keys);
    if (lockedMs > 0) {
        const seconds = Math.ceil(lockedMs / 1000);
        res.setHeader('Retry-After', String(seconds));
        return res.status(429).json({
            error: `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
            retry_after_sec: seconds,
        });
    }

    // Usernames are unique ignoring case, so "Client.Paul" signs in as "client.paul"
    // (phones and browsers often capitalize the first letter).
    const user = prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND is_active = 1').get(username.trim());
    // Always run a bcrypt comparison so response time doesn't reveal whether the user exists.
    const hash = user?.password_hash || DUMMY_HASH;
    const validPassword = bcrypt.compareSync(password, hash) && Boolean(user);

    if (!validPassword) {
        recordFailure(keys);
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    clearFailures(keys);
    res.json({ token: generateToken(user), user: publicUser(user) });
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, (req, res) => {
    const user = prepare(
        'SELECT user_id, username, role, trainee_id, is_active, must_change_password, created_at FROM users WHERE user_id = ?'
    ).get(req.user.userId);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: publicUser(user) });
});

/**
 * POST /api/auth/logout
 * Revokes every token issued to this user.
 */
router.post('/logout', authenticate, (req, res) => {
    prepare('UPDATE users SET token_version = token_version + 1 WHERE user_id = ?').run(req.user.userId);
    res.json({ message: 'Logged out successfully' });
});

/**
 * POST /api/auth/change-password
 * Returns a fresh token because older tokens are revoked.
 */
router.post('/change-password', authenticate, handle((req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== 'string' || !currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
    }
    validatePassword(newPassword, 'New password');
    if (newPassword === currentPassword) {
        return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const user = prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(400).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    }

    prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 0, token_version = token_version + 1
        WHERE user_id = ?
    `).run(bcrypt.hashSync(newPassword, 10), user.user_id);

    const updated = prepare('SELECT * FROM users WHERE user_id = ?').get(user.user_id);
    res.json({ message: 'Password changed successfully', token: generateToken(updated), user: publicUser(updated) });
}));

export default router;
