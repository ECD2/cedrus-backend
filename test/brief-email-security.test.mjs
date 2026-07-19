// N2 weekly-note email — security proofs (action tokens, unsubscribe, transport).
// Runs directly under bun/node against the REAL modules and REAL node:crypto —
// no mocks around the hashing, HMAC, or timing-safe comparisons.
//   bun test/brief-email-security.test.mjs

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACTION_TYPES, TOKEN_TTL_DAYS,
  issueActionToken, redeemActionToken, supersedePriorTokens,
  issueUnsubscribeToken, verifyUnsubscribeToken, redeemUnsubscribe,
} from '../src/services/brief/tokens.js';
import { createTransport, MockEmlTransport, SendgridTransport, FROM, REPLY_TO } from '../src/services/brief/transport.js';

const println = console.log;
let failures = 0;
function check(name, cond, detail) {
  if (cond) println('  PASS  ' + name);
  else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

// In-memory adapter with the live tables' semantics: token_hash UNIQUE,
// single-use claim is atomic-conditional, unsubscribe touches only the
// brief-email columns.
function makeDb() {
  const tokens = [];
  const users = {};
  const consent = [];
  let seq = 0;
  return {
    tokens, users, consent,
    async insertToken(row) {
      if (tokens.some((t) => t.token_hash === row.token_hash)) {
        const e = new Error('duplicate key value violates unique constraint'); e.code = '23505'; throw e;
      }
      const r = { id: 't' + (++seq), used_at: null, superseded_at: null, ...row };
      tokens.push(r);
      return r;
    },
    async findTokenByHash(hash) { return tokens.find((t) => t.token_hash === hash) || null; },
    async claimToken(id, nowIso) {
      const t = tokens.find((x) => x.id === id);
      if (!t || t.used_at) return false;
      t.used_at = nowIso;
      return true;
    },
    async supersedeTokens(userId, briefId, nowIso) {
      for (const t of tokens) {
        if (t.user_id === userId && t.brief_id !== briefId && !t.used_at && !t.superseded_at) t.superseded_at = nowIso;
      }
    },
    async getUserById(id) { return users[id] || null; },
    async setBriefEmailUnsubscribed(id, nowIso) {
      users[id].brief_email_status = 'unsubscribed';
      users[id].brief_email_unsubscribed_at = nowIso;
    },
    async logConsent(ev) { consent.push(ev); },
  };
}

const NOW = new Date('2026-07-19T12:00:00Z');

(async () => {
  // ── action tokens: issuance ──────────────────────────────────────────────
  println('action tokens: issuance stores a sha256 hash, never the raw');
  {
    const db = makeDb();
    const { raw, row } = await issueActionToken({ db }, {
      userId: 'u1', briefId: 'b1', actionType: 'view_full_brief', now: NOW,
    });
    check('raw token has >=256-bit entropy shape (43+ b64url chars)', /^[A-Za-z0-9_-]{43,}$/.test(raw), raw);
    check('stored hash IS sha256(raw) hex', row.token_hash === createHash('sha256').update(raw).digest('hex'));
    check('raw appears nowhere in the stored row', !JSON.stringify(row).includes(raw));
    check('expiry is issue + 7 days (D18)', row.expires_at === new Date(NOW.getTime() + TOKEN_TTL_DAYS * 86400000).toISOString());
    check('action type list mirrors the live CHECK (7 values)', ACTION_TYPES.length === 7 && ACTION_TYPES.includes('remind_tomorrow'));
  }

  println('action tokens: an action type outside the live CHECK is refused at issue time');
  {
    const db = makeDb();
    let threw = false;
    try { await issueActionToken({ db }, { userId: 'u1', briefId: 'b1', actionType: 'unsubscribe', now: NOW }); }
    catch { threw = true; }
    check('issuing action_type "unsubscribe" throws (schema has no such value)', threw);
    check('nothing was inserted', db.tokens.length === 0);
  }

  // ── action tokens: redemption ────────────────────────────────────────────
  println('action tokens: single-use claim, neutral failures, no oracle');
  {
    const db = makeDb();
    const { raw } = await issueActionToken({ db }, {
      userId: 'u1', briefId: 'b1', briefItemId: 'i1', actionType: 'remind_tomorrow', now: NOW,
    });
    const first = await redeemActionToken({ db }, raw, { now: NOW });
    check('first redeem succeeds and consumes', first.ok === true && first.consumed === true);
    check('used_at was set', db.tokens[0].used_at != null);

    const second = await redeemActionToken({ db }, raw, { now: NOW });
    const unknown = await redeemActionToken({ db }, 'A'.repeat(43), { now: NOW });
    const malformed = await redeemActionToken({ db }, 'short', { now: NOW });
    check('second redeem fails', second.ok === false);
    check('all failures are byte-identical (neutral, no oracle)',
      JSON.stringify(second) === JSON.stringify(unknown) && JSON.stringify(unknown) === JSON.stringify(malformed),
      JSON.stringify({ second, unknown, malformed }));
  }

  println('action tokens: expiry and supersession both refuse with the same neutral shape');
  {
    const db = makeDb();
    const { raw: expiredRaw } = await issueActionToken({ db }, { userId: 'u1', briefId: 'b1', actionType: 'mark_handled', now: NOW });
    const after = new Date(NOW.getTime() + (TOKEN_TTL_DAYS * 86400000) + 1000);
    const expired = await redeemActionToken({ db }, expiredRaw, { now: after });
    check('expired token refused', expired.ok === false && expired.reason === 'expired');

    const { raw: oldRaw } = await issueActionToken({ db }, { userId: 'u2', briefId: 'week1', actionType: 'remind_tomorrow', now: NOW });
    await supersedePriorTokens({ db }, { userId: 'u2', briefId: 'week2', now: NOW });
    const superseded = await redeemActionToken({ db }, oldRaw, { now: NOW });
    check('superseded token refused', superseded.ok === false);
    check('supersession stamped the old row', db.tokens.find((t) => t.brief_id === 'week1').superseded_at != null);

    const { raw: freshRaw } = await issueActionToken({ db }, { userId: 'u2', briefId: 'week2', actionType: 'remind_tomorrow', now: NOW });
    await supersedePriorTokens({ db }, { userId: 'u2', briefId: 'week2', now: NOW });
    const fresh = await redeemActionToken({ db }, freshRaw, { now: NOW });
    check('current-note tokens survive their own supersede pass', fresh.ok === true);
  }

  println('action tokens: view_full_brief is render-only and never consumed');
  {
    const db = makeDb();
    const { raw } = await issueActionToken({ db }, { userId: 'u1', briefId: 'b1', actionType: 'view_full_brief', now: NOW });
    const a = await redeemActionToken({ db }, raw, { now: NOW });
    const b = await redeemActionToken({ db }, raw, { now: NOW });
    check('first view ok without consuming', a.ok === true && a.consumed === false);
    check('second view still ok (replayable render)', b.ok === true);
    check('used_at never set by views', db.tokens[0].used_at == null);
  }

  // ── unsubscribe (stateless HMAC, BRIEF-03 scope) ─────────────────────────
  println('unsubscribe: HMAC token verifies, tampering and wrong secrets refuse neutrally');
  {
    const token = issueUnsubscribeToken({ secret: 's3cret-A', userId: 'u9', now: NOW });
    const ok = verifyUnsubscribeToken({ secrets: ['s3cret-A'], token, now: NOW });
    check('valid token verifies to its user', ok.ok === true && ok.userId === 'u9');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    check('tampered mac refused', verifyUnsubscribeToken({ secrets: ['s3cret-A'], token: tampered, now: NOW }).ok === false);
    check('wrong secret refused', verifyUnsubscribeToken({ secrets: ['other'], token, now: NOW }).ok === false);
    check('rotation: previous secret still verifies', verifyUnsubscribeToken({ secrets: ['new', 's3cret-A'], token, now: NOW }).ok === true);
    const old = new Date(NOW.getTime() + 400 * 86400000);
    check('a token past max age refused', verifyUnsubscribeToken({ secrets: ['s3cret-A'], token, now: old }).ok === false);
    check('missing secret refuses (fail closed)', verifyUnsubscribeToken({ secrets: [], token, now: NOW }).ok === false);
    let threw = false;
    try { issueUnsubscribeToken({ secret: '', userId: 'u9', now: NOW }); } catch { threw = true; }
    check('issuing without a secret throws (fail closed)', threw);
  }

  println('unsubscribe: redemption flips ONLY brief-email state and audits once');
  {
    const db = makeDb();
    db.users.u9 = {
      id: 'u9', brief_email: 'e@example.com', brief_email_status: 'subscribed',
      brief_email_verified_at: NOW.toISOString(), opted_out: false,
    };
    const token = issueUnsubscribeToken({ secret: 'k', userId: 'u9', now: NOW });
    const r1 = await redeemUnsubscribe({ db }, { token, secrets: ['k'], now: NOW });
    check('redeem ok', r1.ok === true && r1.alreadyUnsubscribed === false);
    check('status → unsubscribed with timestamp', db.users.u9.brief_email_status === 'unsubscribed' && db.users.u9.brief_email_unsubscribed_at != null);
    check('SMS opted_out untouched (D16 separation)', db.users.u9.opted_out === false);
    check('consent event brief_unsubscribed source email logged',
      db.consent.length === 1 && db.consent[0].eventType === 'brief_unsubscribed' && db.consent[0].source === 'email');

    const r2 = await redeemUnsubscribe({ db }, { token, secrets: ['k'], now: NOW });
    check('second redeem is a friendly idempotent ok', r2.ok === true && r2.alreadyUnsubscribed === true);
    check('no duplicate consent event', db.consent.length === 1);

    const forged = await redeemUnsubscribe({ db }, { token: 'v1.zzz.zzz', secrets: ['k'], now: NOW });
    check('forged token refused', forged.ok === false);
    const ghost = await redeemUnsubscribe({ db }, { token: issueUnsubscribeToken({ secret: 'k', userId: 'nobody', now: NOW }), secrets: ['k'], now: NOW });
    check('unknown user refused with the same neutral shape', ghost.ok === false);
  }

  // ── transport ────────────────────────────────────────────────────────────
  println('transport: mock writes a complete .eml; live stub refuses without the gate');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n2-eml-'));
    const t = new MockEmlTransport({ outputDir: dir });
    const res = await t.send({
      to: 'emil@example.com', subject: 'Your week 🌲',
      html: '<p>hello</p>', text: 'hello',
      unsubscribeUrl: 'https://cedrus.life/email/unsubscribe/v1.x.y', now: NOW,
    });
    check('mock reports provider + message id', res.provider === 'mock-eml' && /^<note-[0-9a-f]{24}@cedrus\.life>$/.test(res.providerMessageId));
    check('.eml file exists', fs.existsSync(res.path));
    const eml = fs.readFileSync(res.path, 'utf8');
    check('From is the fixed brand identity (D19)', eml.includes(`From: ${FROM}`));
    check('Reply-To routes to human support (D19)', eml.includes(`Reply-To: ${REPLY_TO}`));
    check('List-Unsubscribe carries mailto + https', /List-Unsubscribe: <mailto:unsubscribe@cedrus\.life>, <https:\/\/cedrus\.life\/email\/unsubscribe\//.test(eml));
    check('RFC 8058 one-click header present', eml.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'));
    check('subject is RFC2047-encoded (holds the 🌲)', /Subject: =\?UTF-8\?B\?/.test(eml));
    check('multipart/alternative with plain + html parts', eml.includes('multipart/alternative') && eml.includes('text/plain') && eml.includes('text/html'));
    const b64s = [...eml.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
    check('decoded bodies round-trip', b64s[0] === 'hello' && b64s[1] === '<p>hello</p>', JSON.stringify(b64s));
    const again = await t.send({ to: 'emil@example.com', subject: 'Your week 🌲', html: '<p>hello</p>', text: 'hello', unsubscribeUrl: 'https://cedrus.life/email/unsubscribe/v1.x.y', now: NOW });
    check('same inputs → same bytes (deterministic render)', fs.readFileSync(again.path, 'utf8') === eml);
  }
  {
    let networkCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { networkCalls++; return { ok: true, headers: { get: () => 'x' } }; };
    try {
      let threw = null;
      try { new SendgridTransport({}); } catch (e) { threw = e; }
      check('live stub refuses without BRIEF_EMAIL_LIVE=true', threw != null && /BRIEF_EMAIL_LIVE/.test(threw.message));
      threw = null;
      try { new SendgridTransport({ BRIEF_EMAIL_LIVE: 'true' }); } catch (e) { threw = e; }
      check('live stub refuses without an API key even when gated on', threw != null && /KEY/i.test(threw.message));
      const viaFactoryDefault = createTransport({});
      check('factory default is the mock (never live by omission)', viaFactoryDefault instanceof MockEmlTransport);
      let factoryThrew = false;
      try { createTransport({ BRIEF_EMAIL_TRANSPORT: 'sendgrid' }); } catch { factoryThrew = true; }
      check('factory refuses sendgrid without the explicit gate', factoryThrew);
      check('no network call was ever attempted', networkCalls === 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  println('');
  println(failures === 0 ? 'ALL N2 SECURITY TESTS PASSED' : failures + ' TEST(S) FAILED');
  if (failures > 0) process.exit(1);
})();
