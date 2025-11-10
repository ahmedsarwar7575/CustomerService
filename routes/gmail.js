// routes/gmailRoutes.js  (ESM)
import { Router } from 'express';
import { auth, oauth2callback, setupWatch, pushWebhook } from '../Email/Email.js';

const router = Router();

router.get('/auth', auth);
router.get('/oauth2callback', oauth2callback);
router.post('/setup-watch', setupWatch);
router.post('/gmail/push', pushWebhook);

export default router;
