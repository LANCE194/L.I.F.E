/**
 * L.I.F.E. Authentication Middleware
 * JWT (Authorization: Bearer) validated against the users table on every request, so
 * deactivated users, role changes and revoked tokens take effect immediately.
 */

import jwt from 'jsonwebtoken';
import { prepare } from '../db.js';
import { getJwtSecret } from '../lib/secret.js';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export function generateToken(user) {
    return jwt.sign(
        {
            userId: user.user_id,
            username: user.username,
            role: user.role,
            tv: user.token_version || 0,
        },
        getJwtSecret(),
        { expiresIn: JWT_EXPIRES_IN }
    );
}

export function verifyToken(token) {
    try {
        return jwt.verify(token, getJwtSecret());
    } catch {
        return null;
    }
}

/**
 * Resolve the current user for a bearer token, or null if the token is invalid, expired,
 * revoked, or belongs to an inactive/deleted user.
 */
function userFromRequest(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const decoded = verifyToken(authHeader.substring(7));
    if (!decoded) return null;

    const user = prepare(
        'SELECT user_id, username, role, trainee_id, is_active, must_change_password, token_version FROM users WHERE user_id = ?'
    ).get(decoded.userId);

    if (!user || !user.is_active) return null;
    if ((user.token_version || 0) !== (decoded.tv || 0)) return null;

    return {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        traineeId: user.trainee_id ?? null,
        mustChangePassword: Boolean(user.must_change_password),
    };
}

// Routes a user may call while a password change is still required.
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

export function authenticate(req, res, next) {
    const user = userFromRequest(req);
    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split('?')[0])) {
        return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    req.user = user;
    next();
}

export function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}
