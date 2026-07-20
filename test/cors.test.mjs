// CORS proof — browser access to the backend from cedrus.life.
// Run: bun test/cors.test.mjs   (wired into test/run-all.sh)
//
// Drives the REAL createCors middleware (src/lib/cors.js) mounted on a real
// Express app exactly as src/index.js mounts it — FIRST, before the body
// parsers and routers — with stub routes standing in for the panel and the
// consumer API so the assertions are about CORS, not route auth.
//
// Requests are made with node:http (not fetch): Origin and the
// Access-Control-Request-* headers are "forbidden request headers" that a
// browser fetch would strip, so we speak raw HTTP to send them verbatim —
// the same shape a browser preflight actually puts on the wire.
//
// Proves, per the fix brief:
//   • preflight OPTIONS /admin/users from the allowed origin → 200 with the
//     Access-Control-Allow-{Origin,Methods,Headers} + Vary: Origin headers;
//   • a real GET from the allowed origin reaches the handler AND carries ACAO;
//   • https://www.cedrus.life is allowed too;
//   • a foreign origin gets NO ACAO (the browser would block it);
//   • the wildcard "*" is never emitted, and parseOrigins strips a stray "*".

import http from 'node:http';
import express from 'express';
import { createCors, parseOrigins } from '../src/lib/cors.js';

const ORIGIN = 'https://cedrus.life';
const WWW = 'https://www.cedrus.life';
const FOREIGN = 'https://evil.example';

// ── tiny harness (matches test/adminAuth.test.mjs; non-zero exit = fail) ────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + detail : '')); }
}

function buildApp() {
  const app = express();
  app.use(createCors({ allowedOrigins: [ORIGIN, WWW] })); // mounted FIRST, like src/index.js
  app.use(express.json());
  // Stubs standing in for the real cross-origin surfaces.
  app.get('/admin/users', (_req, res) => res.status(200).json({ ok: true, users: [] }));
  app.post('/api/capture', (_req, res) => res.status(200).json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

// Raw HTTP request so Origin / Access-Control-Request-* are sent verbatim.
// Node lowercases response header names, so callers index them lowercase.
function raw(base, path, { method = 'GET', headers = {} } = {}) {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    r.on('error', reject);
    r.end();
  });
}

async function run() {
  const a = buildApp();

  // T1 — preflight from the allowed origin returns the CORS headers.
  p('\n── preflight OPTIONS /admin/users (allowed origin) ──');
  {
    const res = await raw(a.base, '/admin/users?limit=100', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-admin-key',
      },
    });
    const acao = res.headers['access-control-allow-origin'];
    const methods = (res.headers['access-control-allow-methods'] || '').toUpperCase();
    const hdrs = (res.headers['access-control-allow-headers'] || '').toLowerCase();
    check('preflight → 200', res.status === 200, res.status);
    check('ACAO echoes the origin (not *)', acao === ORIGIN, acao);
    check('allow-methods has GET, POST, OPTIONS',
      /GET/.test(methods) && /POST/.test(methods) && /OPTIONS/.test(methods), methods);
    check('allow-headers has x-admin-key + authorization + content-type',
      hdrs.includes('x-admin-key') && hdrs.includes('authorization') && hdrs.includes('content-type'), hdrs);
    check('Vary: Origin present', /origin/i.test(res.headers['vary'] || ''), res.headers['vary']);
    check('preflight body is empty (not routed)', res.body === '', JSON.stringify(res.body));
  }

  // T2 — a real GET from the allowed origin passes AND carries ACAO.
  p('\n── GET /admin/users (allowed origin) ──');
  {
    const res = await raw(a.base, '/admin/users?limit=100', { method: 'GET', headers: { origin: ORIGIN } });
    let body = null; try { body = JSON.parse(res.body); } catch { /* leave null */ }
    check('GET → 200', res.status === 200, res.status);
    check('handler reached (body ok)', body && body.ok === true, res.body);
    check('ACAO echoes the origin', res.headers['access-control-allow-origin'] === ORIGIN, res.headers['access-control-allow-origin']);
  }

  // T3 — a POST from the allowed origin also carries ACAO (consumer /api/*).
  p('\n── POST /api/capture (allowed origin) ──');
  {
    const res = await raw(a.base, '/api/capture', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer x' },
    });
    check('POST → 200', res.status === 200, res.status);
    check('ACAO echoes the origin', res.headers['access-control-allow-origin'] === ORIGIN, res.headers['access-control-allow-origin']);
  }

  // T4 — www.cedrus.life is allowed too.
  p('\n── www.cedrus.life allowed ──');
  {
    const res = await raw(a.base, '/admin/users', {
      method: 'OPTIONS',
      headers: { origin: WWW, 'access-control-request-method': 'GET' },
    });
    check('www preflight → 200', res.status === 200, res.status);
    check('ACAO echoes www origin', res.headers['access-control-allow-origin'] === WWW, res.headers['access-control-allow-origin']);
  }

  // T5 — a foreign origin gets NO ACAO (browser would block).
  p('\n── foreign origin blocked (no ACAO) ──');
  {
    const pre = await raw(a.base, '/admin/users', {
      method: 'OPTIONS',
      headers: { origin: FOREIGN, 'access-control-request-method': 'GET' },
    });
    check('foreign preflight still → 200', pre.status === 200, pre.status);
    check('foreign preflight has NO ACAO', !pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-origin']);
    const get = await raw(a.base, '/admin/users', { method: 'GET', headers: { origin: FOREIGN } });
    check('foreign GET has NO ACAO', !get.headers['access-control-allow-origin'], get.headers['access-control-allow-origin']);
    check('foreign GET never sees a wildcard', get.headers['access-control-allow-origin'] !== '*');
  }

  // T6 — parseOrigins hygiene: trims, drops blanks, refuses "*".
  p('\n── parseOrigins hygiene ──');
  {
    const got = parseOrigins(' https://cedrus.life , * , , https://www.cedrus.life ');
    check('trims + drops blanks (2 origins)', got.length === 2, JSON.stringify(got));
    check('drops the wildcard', !got.includes('*'), JSON.stringify(got));
  }

  await a.close();

  p('');
  if (failures) { p(`❌ cors: ${failures} check(s) failed.`); process.exit(1); }
  p('✅ cors: all checks passed.');
}

run().catch((e) => { console.error('cors suite crashed:', e); process.exit(1); });
