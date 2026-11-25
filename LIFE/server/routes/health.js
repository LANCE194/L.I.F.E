/**
 * L.I.F.E. Health Check Route
 * Startup verification endpoint
 */

import express from 'express';
import { prepare } from '../db.js';

const router = express.Router();

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
            database: 'connected'
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