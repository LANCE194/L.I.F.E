/**
 * L.I.F.E. Health Check Route
 * Startup verification endpoint
 */

import express from 'express';
import { prepare } from '../db.js';
import { cloudSyncStatus } from '../lib/cloudSync.js';

const router = express.Router();

/** Where data is kept: 'turso' (permanent cloud copy) or 'local' (the database file only). */
function storageStatus() {
    const cloud = cloudSyncStatus();
    if (!cloud) return { mode: 'local' };
    return { mode: 'turso', last_saved_at: cloud.lastSavedAt, unsaved_changes: cloud.pending, error: cloud.lastError };
}

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', (req, res) => {
    try {
        // Test database connection
        prepare('SELECT 1').get();

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            service: 'L.I.F.E. Server',
            version: '1.0.0',
            database: 'connected',
            storage: storageStatus()
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            service: 'L.I.F.E. Server',
            version: '1.0.0',
            database: 'disconnected'
        });
    }
});

export default router;