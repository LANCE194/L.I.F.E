/**
 * Trainee sign-in accounts: username and temporary-password generation.
 * Temporary passwords are shown once to the admin and must be changed at first sign-in.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prepare } from '../db.js';
import { fail } from './validate.js';

// No look-alike characters (0/O, 1/l/I) so the password is easy to read out or copy by hand.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** 10 random characters from the alphabet above, with at least one digit (about 57 bits). */
export function generateTemporaryPassword(length = 10) {
    for (;;) {
        let password = '';
        for (let i = 0; i < length; i += 1) password += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
        if (/\d/.test(password) && /[A-Za-z]/.test(password)) return password;
    }
}

function usernameTaken(username) {
    return Boolean(prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username));
}

/**
 * "Juan Dela Cruz" -> "juan.delacruz"; "María José" -> "maria.jose". Adds 2, 3, ... if taken.
 */
export function suggestUsername(fullName, isTaken = usernameTaken) {
    const parts = String(fullName || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    let base = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : (parts[0] || 'trainee');
    base = base.replace(/-/g, '').slice(0, 28);
    if (base.length < 3) base = `${base}trainee`.slice(0, 28);

    if (!isTaken(base)) return base;
    for (let n = 2; n < 1000; n += 1) {
        const candidate = `${base}${n}`;
        if (!isTaken(candidate)) return candidate;
    }
    return `${base}${crypto.randomInt(1000, 9999)}`;
}

export function traineeAccount(traineeId) {
    return prepare(`SELECT user_id, username, is_active, must_change_password, created_at FROM users WHERE trainee_id = ?`).get(traineeId) || null;
}

/**
 * Create the sign-in account for a trainee. Returns the username and the one-time temporary
 * password (only the bcrypt hash is stored).
 */
export function createTraineeAccount(trainee, requestedUsername) {
    if (traineeAccount(trainee.trainee_id)) fail('This trainee already has a sign-in account');

    let username;
    if (requestedUsername !== undefined && requestedUsername !== null && String(requestedUsername).trim() !== '') {
        username = String(requestedUsername).trim().toLowerCase();
        if (!USERNAME_PATTERN.test(username)) fail('Username must be 3–32 characters: letters, numbers, dot, dash or underscore');
        if (usernameTaken(username)) fail('That username is already in use');
    } else {
        username = suggestUsername(trainee.full_name);
    }

    const temporaryPassword = generateTemporaryPassword();
    prepare(`
        INSERT INTO users (username, password_hash, role, trainee_id, is_active, must_change_password)
        VALUES (?, ?, 'trainee', ?, ?, 1)
    `).run(username, bcrypt.hashSync(temporaryPassword, 10), trainee.trainee_id, trainee.is_active ? 1 : 0);

    return { username, temporary_password: temporaryPassword };
}

/** New temporary password; signs the trainee out everywhere and requires a change at next sign-in. */
export function resetTraineePassword(traineeId) {
    const account = traineeAccount(traineeId);
    if (!account) fail('This trainee has no sign-in account yet');
    const temporaryPassword = generateTemporaryPassword();
    prepare(`
        UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1
        WHERE user_id = ?
    `).run(bcrypt.hashSync(temporaryPassword, 10), account.user_id);
    return { username: account.username, temporary_password: temporaryPassword };
}

/** Keep the account in step with the trainee's active flag (deactivating also signs them out). */
export function setTraineeAccountActive(traineeId, active) {
    prepare(`
        UPDATE users SET is_active = ?, token_version = token_version + CASE WHEN ? = 0 THEN 1 ELSE 0 END
        WHERE trainee_id = ?
    `).run(active ? 1 : 0, active ? 1 : 0, traineeId);
}
