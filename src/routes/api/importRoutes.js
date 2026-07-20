import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { createRequireUser } from './auth.js';
import * as chatImport from '../../services/chatImport.js';
import { limits } from '../../services/chatImport.js';

// ─────────────────────────────────────────────────────────────────────────
// CHAT-IMPORT ROUTER (NF2-IMPORT) — the /api/import surface.
//
// Contract: docs/IMPORT_CONTRACT.md (the review UI builds against that).
// Mounting into src/index.js: docs/MOUNT_IMPORT.md (index.js is not edited
// by this stream). Mount BEFORE the N3 `/api` router, like /api/onboard,
// so the upload is authenticated exactly once.
//
// Same shape rules as routes/api/index.js: every route behind requireUser
// (Supabase JWT → req.appUser; identity is token-derived, never
// body-derived); thin handlers; services throw typed
// {status, code, publicMessage} errors; one correlation id per request.
//
// The upload is a RAW BODY (Content-Type: application/octet-stream), not
// multipart and not JSON. Deliberate: the app-level express.json parser in
// index.js caps JSON bodies at 100kb (an export is far bigger), it skips
// octet-stream entirely, and reading the raw stream needs no new
// dependency (fleet rules: new files only, so no package.json changes).
// The stream is counted as it arrives and aborted at the cap, so an
// oversized upload dies at the socket, not in memory.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

// Collect the raw request body with a hard byte cap. 413s past the cap.
function rawBody(maxBytes) {
  return (req, res, next) => {
    const declared = parseInt(req.get('content-length') || '', 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return res.status(413).json({ error: 'file_too_large', message: chatImport.MSG_TOO_LARGE });
    }
    const chunks = [];
    let received = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      received += chunk.length;
      if (received > maxBytes) {
        done = true;
        res.status(413).json({ error: 'file_too_large', message: chatImport.MSG_TOO_LARGE });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      req.rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      res.status(400).json({ error: 'invalid_request', message: MSG_INTERNAL });
    });
  };
}

export function createImportRouter(deps = {}) {
  const router = Router();

  router.use(createRequireUser(deps.auth || deps.db ? { auth: deps.auth, db: deps.db } : {}));

  // Wrap a handler with correlation context + the contract's error shape
  // (same pattern as routes/api/index.js).
  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: crypto.randomUUID() },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const { status = 200, ...result } = await fn(req);
          res.status(status).json(result);
          logger.event(`web.${name}.handled`, {
            status_code: status, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          res.status(status).json({
            error: known ? err.code : 'internal',
            message: known ? err.publicMessage : MSG_INTERNAL,
          });
          logger.event(`web.${name}.rejected`, {
            level: status >= 500 ? 'error' : 'warn',
            error_category: status >= 500 ? 'internal' : 'validation',
            status_code: status, latency_ms: Date.now() - t0,
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  };

  // 1. Upload (raw bytes; .zip or bare conversations.json). 202: the job is
  //    parsed synchronously but extraction runs on, poll GET /:id.
  router.post('/chat-export',
    (req, res, next) => rawBody(limits.maxUploadBytes)(req, res, next),
    handle('import.start', async (req) => {
      const { job, reused } = await chatImport.startImport(
        { user: req.appUser, buffer: req.rawBody }, deps.importDeps);
      return { status: reused ? 200 : 202, import: chatImport.publicJob(job) };
    }));

  // 2. Status / proposals poll.
  router.get('/:id', handle('import.status', async (req) =>
    chatImport.getImport({ user: req.appUser, importId: req.params.id }, deps.importDeps)));

  // 3. Confirm — the ONLY way anything durable is written (JSON body).
  router.post('/:id/confirm', express.json({ limit: '100kb' }), handle('import.confirm', async (req) =>
    chatImport.confirmImport({
      user: req.appUser, importId: req.params.id, accept: req.body && req.body.accept,
    }, deps.importDeps)));

  // 4. Discard — proposals dropped, nothing written, ever.
  router.post('/:id/discard', handle('import.discard', async (req) =>
    chatImport.discardImport({ user: req.appUser, importId: req.params.id }, deps.importDeps)));

  return router;
}

// Production router, mounted per docs/MOUNT_IMPORT.md.
export default createImportRouter();
