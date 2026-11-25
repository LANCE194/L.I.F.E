/**
 * JWT signing secret.
 * Uses the JWT_SECRET environment variable when set; otherwise generates a random secret on
 * first start and stores it in server/.jwt_secret (gitignored). There is no hard-coded fallback,
 * so tokens cannot be forged by anyone who has read the source code.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = process.env.LIFE_SECRET_PATH || path.join(__dirname, '..', '.jwt_secret');

let cachedSecret = null;

export function getJwtSecret() {
    if (cachedSecret) return cachedSecret;

    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
        cachedSecret = process.env.JWT_SECRET;
        return cachedSecret;
    }

    if (fs.existsSync(SECRET_FILE)) {
        const stored = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
        if (stored.length >= 32) {
            cachedSecret = stored;
            return cachedSecret;
        }
    }

    cachedSecret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, cachedSecret, { mode: 0o600 });
    console.log(`Generated a new JWT signing secret at ${SECRET_FILE}`);
    return cachedSecret;
}
