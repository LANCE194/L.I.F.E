/**
 * L.I.F.E. Trainee Routes
 */

import express from 'express';
import { prepare, transaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { trainerOrAdmin, adminOnly } from '../middleware/roles.js';
import { optionalString, optionalBoolean, requiredId, handle } from '../lib/validate.js';
import { createTraineeAccount, resetTraineePassword, setTraineeAccountActive, traineeAccount } from '../lib/accounts.js';

const router = express.Router();

router.use(authenticate);

function toPublic(trainee) {
    if (!trainee) return trainee;
    const { account_username, account_active, account_must_change, ...rest } = trainee;
    return {
        ...rest,
        consent_given: Boolean(trainee.consent_given),
        is_active: Boolean(trainee.is_active),
        account: account_username
            ? { username: account_username, is_active: Boolean(account_active), must_change_password: Boolean(account_must_change) }
            : null,
    };
}

const SELECT_WITH_ACCOUNT = `
    SELECT t.*, u.username AS account_username, u.is_active AS account_active, u.must_change_password AS account_must_change
    FROM trainees t LEFT JOIN users u ON u.trainee_id = t.trainee_id`;

function findTrainee(traineeId) {
    return prepare(`${SELECT_WITH_ACCOUNT} WHERE t.trainee_id = ?`).get(traineeId);
}

/**
 * GET /api/trainees?search=&organization=&is_active=true|false
 */
router.get('/', trainerOrAdmin, (req, res) => {
    const { search, organization, is_active } = req.query;

    let query = `${SELECT_WITH_ACCOUNT} WHERE 1=1`;
    const params = [];

    if (search) {
        query += " AND (t.full_name LIKE ? ESCAPE '\\' OR t.organization LIKE ? ESCAPE '\\')";
        const pattern = `%${String(search).replace(/[\\%_]/g, character => `\\${character}`)}%`;
        params.push(pattern, pattern);
    }

    if (organization) {
        query += ' AND t.organization = ?';
        params.push(String(organization));
    }

    if (is_active === 'true' || is_active === 'false') {
        query += ' AND t.is_active = ?';
        params.push(is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY t.full_name COLLATE NOCASE';

    res.json({ trainees: prepare(query).all(...params).map(toPublic) });
});

/**
 * GET /api/trainees/organizations/list
 * (declared before /:id so the path is never treated as an ID)
 */
router.get('/organizations/list', trainerOrAdmin, (req, res) => {
    const orgs = prepare(`
        SELECT DISTINCT organization FROM trainees
        WHERE organization IS NOT NULL AND organization != ''
        ORDER BY organization COLLATE NOCASE
    `).all();

    res.json({ organizations: orgs.map(o => o.organization) });
});

router.get('/:id', trainerOrAdmin, (req, res) => {
    const trainee = findTrainee(requiredId(req.params.id, 'Trainee ID'));
    if (!trainee) {
        return res.status(404).json({ error: 'Trainee not found' });
    }
    res.json({ trainee: toPublic(trainee) });
});

/**
 * POST /api/trainees. Admins may pass create_account: true (and optionally username) to create
 * the trainee's sign-in account at the same time; the temporary password is returned once.
 */
router.post('/', trainerOrAdmin, handle((req, res) => {
    const body = req.body || {};
    const createAccount = optionalBoolean(body.create_account, 'create_account') ?? false;
    if (createAccount && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can create trainee sign-in accounts' });
    }
    const fullName = optionalString(body.full_name, 'Full name', { maxLength: 120, required: true });
    const organization = optionalString(body.organization, 'Organization', { maxLength: 120 }) || null;
    const notes = optionalString(body.notes, 'Notes', { maxLength: 1000 }) || null;
    const consent = optionalBoolean(body.consent_given, 'consent_given') ?? false;

    let account = null;
    const traineeId = transaction(() => {
        const result = prepare(`
            INSERT INTO trainees (full_name, organization, notes, consent_given)
            VALUES (?, ?, ?, ?)
        `).run(fullName, organization, notes, consent ? 1 : 0);
        if (createAccount) {
            const created = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(result.lastInsertRowid);
            account = createTraineeAccount(created, body.username);
        }
        return result.lastInsertRowid;
    });

    res.status(201).json({ trainee: toPublic(findTrainee(traineeId)), account });
}));

/**
 * POST /api/trainees/:id/account (admin): create the sign-in account for an existing trainee.
 */
router.post('/:id/account', adminOnly, handle((req, res) => {
    const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(requiredId(req.params.id, 'Trainee ID'));
    if (!trainee) return res.status(404).json({ error: 'Trainee not found' });
    const account = createTraineeAccount(trainee, req.body?.username);
    res.status(201).json({ trainee: toPublic(findTrainee(trainee.trainee_id)), account });
}));

/**
 * POST /api/trainees/:id/account/reset (admin): issue a new temporary password.
 */
router.post('/:id/account/reset', adminOnly, handle((req, res) => {
    const traineeId = requiredId(req.params.id, 'Trainee ID');
    if (!prepare('SELECT 1 FROM trainees WHERE trainee_id = ?').get(traineeId)) {
        return res.status(404).json({ error: 'Trainee not found' });
    }
    if (!traineeAccount(traineeId)) return res.status(404).json({ error: 'This trainee has no sign-in account yet' });
    res.json({ account: resetTraineePassword(traineeId) });
}));

/**
 * PUT /api/trainees/:id
 * Trainers may edit details and consent; only admins may change is_active.
 */
router.put('/:id', trainerOrAdmin, (req, res) => {
    const traineeId = requiredId(req.params.id, 'Trainee ID');
    const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(traineeId);
    if (!trainee) {
        return res.status(404).json({ error: 'Trainee not found' });
    }

    const body = req.body || {};
    const fullName = body.full_name !== undefined
        ? optionalString(body.full_name, 'Full name', { maxLength: 120, required: true })
        : trainee.full_name;
    const organization = body.organization !== undefined
        ? optionalString(body.organization, 'Organization', { maxLength: 120 }) || null
        : trainee.organization;
    const notes = body.notes !== undefined
        ? optionalString(body.notes, 'Notes', { maxLength: 1000 }) || null
        : trainee.notes;
    const consent = optionalBoolean(body.consent_given, 'consent_given');
    const active = optionalBoolean(body.is_active, 'is_active');

    if (active !== undefined && Boolean(trainee.is_active) !== active && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can activate or deactivate trainees' });
    }

    prepare(`
        UPDATE trainees
        SET full_name = ?, organization = ?, notes = ?, consent_given = ?, is_active = ?
        WHERE trainee_id = ?
    `).run(
        fullName,
        organization,
        notes,
        consent === undefined ? trainee.consent_given : (consent ? 1 : 0),
        active === undefined ? trainee.is_active : (active ? 1 : 0),
        traineeId
    );

    if (active !== undefined && Boolean(trainee.is_active) !== active) setTraineeAccountActive(traineeId, active);
    res.json({ trainee: toPublic(findTrainee(traineeId)) });
});

/**
 * DELETE /api/trainees/:id — soft delete (admin only)
 */
router.delete('/:id', adminOnly, (req, res) => {
    const traineeId = requiredId(req.params.id, 'Trainee ID');
    const trainee = prepare('SELECT * FROM trainees WHERE trainee_id = ?').get(traineeId);
    if (!trainee) {
        return res.status(404).json({ error: 'Trainee not found' });
    }

    transaction(() => {
        prepare('UPDATE trainees SET is_active = 0 WHERE trainee_id = ?').run(traineeId);
        setTraineeAccountActive(traineeId, false); // also signs the trainee out
    });
    res.json({ message: 'Trainee deactivated' });
});

router.get('/:id/sessions', trainerOrAdmin, (req, res) => {
    const sessions = prepare('SELECT * FROM sessions WHERE trainee_id = ? ORDER BY date_time DESC')
        .all(requiredId(req.params.id, 'Trainee ID'));
    res.json({ sessions });
});

export default router;
