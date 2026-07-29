import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import { saveAnswers } from '../../services/onboardingAnswers.js';

// ─────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING ANSWERS (night build 2026-07-28, item 5) — /api/onboarding.
//
//   POST /api/onboarding/answers  { step, answers } → { step, facts_saved,
//   people_touched }. JWT-authed (Supabase → req.appUser); identity is
//   token-derived, never body-derived. Distinct from the PUBLIC
//   /api/onboard/start (account creation + first SMS) — different path
//   segment, different job; the SMS onboarding flow is not touched.
//
// Same shape rules as routes/api/insights.js: thin handler, service owns
// the rules, typed errors keep internals from leaking.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export function createOnboardingAnswersRouter(deps = {}) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  router.post('/answers', async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const result = await saveAnswers({
            userId: req.appUser.id,
            step: req.body && req.body.step,
            answers: req.body && req.body.answers,
          });
          res.json(result);
          logger.event('web.onboarding_answers.handled', {
            status_code: 200, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          res.status(status).json({ error: known ? err.code : 'internal', message: known ? err.publicMessage : MSG_INTERNAL });
          logger.event('web.onboarding_answers.rejected', {
            level: status >= 500 ? 'error' : 'warn',
            error_category: status >= 500 ? 'internal' : 'validation',
            status_code: status, latency_ms: Date.now() - t0,
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  });

  return router;
}

export default createOnboardingAnswersRouter();
