/**
 * L.I.F.E. Server Entry Point
 * Node.js + Express API, also serving the built React dashboard.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { initializeDatabase, closeDatabase, resolveDbPath } from './db.js';
import { startAutoBackups } from './lib/autoBackup.js';
import { getJwtSecret } from './lib/secret.js';

import authRoutes from './routes/auth.js';
import traineesRoutes from './routes/trainees.js';
import sessionsRoutes from './routes/sessions.js';
import liveRoutes from './routes/live.js';
import leaderboardRoutes from './routes/leaderboard.js';
import statsRoutes from './routes/stats.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import usersRoutes from './routes/users.js';
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import { seedAdmin } from './seed_admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
// Cloud hosting (Render sets RENDER=true): accept traffic from Render's proxy and trust its
// X-Forwarded-For header so each visitor's real address is used for the sign-in lockout.
export const CLOUD = Boolean(process.env.RENDER) || process.env.LIFE_CLOUD === '1';
// Local-only by default. Set HOST=0.0.0.0 to allow other devices on the network (not recommended
// on shared school Wi-Fi, because trainee records would be reachable).
const HOST = process.env.HOST || (CLOUD ? '0.0.0.0' : '127.0.0.1');
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    // Behind exactly one proxy in the cloud; never trust forwarded headers when running locally.
    app.set('trust proxy', CLOUD ? 1 : false);

    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                'default-src': ["'self'"],
                // MediaPipe compiles its WebAssembly model runtime in the page.
                'script-src': ["'self'", "'wasm-unsafe-eval'"],
                'style-src': ["'self'", "'unsafe-inline'"],
                'img-src': ["'self'", 'data:', 'blob:'],
                'media-src': ["'self'", 'blob:'],
                'connect-src': ["'self'"],
                'worker-src': ["'self'", 'blob:'],
                'font-src': ["'self'", 'data:'],
                'object-src': ["'none'"],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    }));

    // Same-origin requests need no CORS; only the Vite dev server is allowed cross-origin.
    app.use(cors({
        origin: (origin, callback) => callback(null, !origin || DEV_ORIGINS.has(origin)),
    }));

    app.use(express.json({ limit: '1mb' }));

    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            if (process.env.NODE_ENV !== 'test') {
                console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
            }
        });
        next();
    });

    app.use('/api/auth', authRoutes);
    app.use('/api/trainees', traineesRoutes);
    app.use('/api/sessions', sessionsRoutes);
    app.use('/api/live', liveRoutes);
    app.use('/api/leaderboard', leaderboardRoutes);
    app.use('/api/stats', statsRoutes);
    app.use('/api/export', exportRoutes);
    app.use('/api/settings', settingsRoutes);
    app.use('/api/users', usersRoutes);
    app.use('/api/me', meRoutes);
    app.use('/api/health', healthRoutes);

    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    // Built React app. Hashed assets can be cached; index.html must always be revalidated.
    const dashboardDist = path.join(__dirname, '..', 'dashboard', 'dist');
    app.use(express.static(dashboardDist, {
        index: false,
        setHeaders: (res, filePath) => {
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }));

    app.get('*', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(dashboardDist, 'index.html'), (err) => {
            if (err && !res.headersSent) {
                res.status(404).send('Dashboard not built. Run "npm run build" in the dashboard folder.');
            }
        });
    });

    // Validation errors and malformed JSON become 4xx; everything else is a logged 500.
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const status = Number(err.status || err.statusCode) || 500;
        if (status >= 400 && status < 500) {
            const message = err.type === 'entity.parse.failed'
                ? 'Request body is not valid JSON'
                : err.type === 'entity.too.large'
                    ? 'Request body is too large'
                    : err.message;
            return res.status(status).json({ error: message });
        }
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

function startServer() {
    try {
        initializeDatabase();
        getJwtSecret();
        seedAdmin();
        startAutoBackups(resolveDbPath());
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }

    const server = createApp().listen(PORT, HOST, () => {
        const url = `http://localhost:${PORT}`;
        console.log('');
        console.log('  L.I.F.E. Server - Localized Intelligent First-aid Evaluator');
        console.log(`  Dashboard: ${url}`);
        console.log(`  API:       ${url}/api`);
        console.log(`  Listening on ${HOST}${HOST === '127.0.0.1' ? ' (this computer only)' : ''}`);
        console.log('');
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Is L.I.F.E. already running?`);
        } else {
            console.error('Server error:', err);
        }
        closeDatabase();
        process.exit(1);
    });

    const shutdown = () => {
        console.log('\nShutting down...');
        server.close();
        closeDatabase();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startServer();
}
