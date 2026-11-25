/**
 * L.I.F.E. Role-Based Access Control Middleware
 */

import { authorize } from './auth.js';

/**
 * Admin only access
 */
export const adminOnly = authorize('admin');

/**
 * Trainer or Admin access
 */
export const trainerOrAdmin = authorize('trainer', 'admin');

/**
 * Trainee accounts (their own progress only)
 */
export const traineeOnly = authorize('trainee');

/**
 * Practice routes: staff, or a trainee acting on their own profile (each route checks
 * req.user.traineeId for trainee accounts).
 */
export const practiceAccess = authorize('trainer', 'admin', 'trainee');

/**
 * Staff (trainer or admin). Trainee accounts are never allowed on staff routes.
 */
export const authenticated = authorize('trainer', 'admin');