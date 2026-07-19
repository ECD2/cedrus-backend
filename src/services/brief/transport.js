// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note email transport (WS-F / N2).
//
// One interface, two implementations:
//
//   • MockEmlTransport (DEFAULT, and the only one that runs tonight): builds
//     the full RFC 822 message and writes it as a .eml file to an output
//     directory so a human can open exactly what would have been sent.
//     No network, ever.
//
//   • SendgridTransport (STUB): the shape of the real sender, hard-gated OFF.
//     Constructing it without BRIEF_EMAIL_LIVE=true throws; send() re-checks
//     the gate and refuses again; a missing API key refuses too. No signup,
//     no keys, no real sending happens in N2.
//
// Identity is fixed by D19: From "Cedrus <brief@cedrus.life>", Reply-To
// help@cedrus.life (human support; never machine-parsed). Every message
// carries List-Unsubscribe (mailto + https) and RFC 8058
// List-Unsubscribe-Post: List-Unsubscribe=One-Click.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const FROM = 'Cedrus <brief@cedrus.life>';
export const REPLY_TO = 'help@cedrus.life';
export const UNSUB_MAILTO = 'unsubscribe@cedrus.life';

const DEFAULT_OUTPUT_DIR = 'var/brief-email-out';

// Factory the job uses. `env` defaults to process.env; tests pass their own.
export function createTransport(env = process.env, opts = {}) {
  const kind = env.BRIEF_EMAIL_TRANSPORT || 'mock';
  if (kind === 'sendgrid') return new SendgridTransport(env);
  return new MockEmlTransport({
    outputDir: env.BRIEF_EMAIL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    ...opts,
  });
}

// ── the message itself ──────────────────────────────────────────────────────

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

// RFC 2047 encoded-word; the subject carries a 🌲.
function encodeHeaderWord(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}

function wrapB64(s) {
  return b64(s).replace(/(.{76})/g, '$1\r\n');
}

// Deterministic given identical inputs (incl. `now`) — the mock output is
// reproducible, which the snapshot/inspection workflow relies on.
export function buildMime({ to, subject, html, text, unsubscribeUrl, now = new Date() }) {
  const date = now.toUTCString().replace('GMT', '+0000');
  const idHash = createHash('sha256').update(`${to}|${subject}|${now.toISOString()}`).digest('hex').slice(0, 24);
  const messageId = `<note-${idHash}@cedrus.life>`;
  const boundary = `cedrus-note-${idHash.slice(0, 12)}`;

  const headers = [
    `From: ${FROM}`,
    `To: ${to}`,
    `Reply-To: ${REPLY_TO}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `List-Unsubscribe: <mailto:${UNSUB_MAILTO}>, <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapB64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapB64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return { mime: `${headers}\r\n\r\n${body}`, messageId };
}

// ── mock: write .eml files ──────────────────────────────────────────────────

export class MockEmlTransport {
  constructor({ outputDir = DEFAULT_OUTPUT_DIR, fsImpl = fs } = {}) {
    this.provider = 'mock-eml';
    this.outputDir = outputDir;
    this.fs = fsImpl;
  }

  // → { provider, providerMessageId, path }
  async send({ to, subject, html, text, unsubscribeUrl, now = new Date() }) {
    const { mime, messageId } = buildMime({ to, subject, html, text, unsubscribeUrl, now });
    this.fs.mkdirSync(this.outputDir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const safeTo = String(to).replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    const file = path.join(this.outputDir, `${stamp}-${safeTo}.eml`);
    this.fs.writeFileSync(file, mime, 'utf8');
    return { provider: this.provider, providerMessageId: messageId, path: file };
  }
}

// ── live stub: exists, refuses ──────────────────────────────────────────────

export class SendgridTransport {
  constructor(env = process.env) {
    if (env.BRIEF_EMAIL_LIVE !== 'true') {
      throw new Error('SendgridTransport is gated OFF: set BRIEF_EMAIL_LIVE=true explicitly to enable live email.');
    }
    if (!env.BRIEF_EMAIL_SENDGRID_KEY) {
      throw new Error('SendgridTransport: BRIEF_EMAIL_SENDGRID_KEY is not set; refusing to construct a live sender without credentials.');
    }
    this.provider = 'sendgrid';
    this.env = env;
  }

  async send({ to, subject, html, text, unsubscribeUrl }) {
    // Double gate: even a constructed instance re-checks before any network.
    if (this.env.BRIEF_EMAIL_LIVE !== 'true') {
      throw new Error('SendgridTransport.send refused: BRIEF_EMAIL_LIVE is not true.');
    }
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.BRIEF_EMAIL_SENDGRID_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'brief@cedrus.life', name: 'Cedrus' },
        reply_to: { email: REPLY_TO },
        subject,
        headers: {
          'List-Unsubscribe': `<mailto:${UNSUB_MAILTO}>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    });
    if (!res.ok) {
      const err = new Error(`sendgrid rejected the send (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { provider: this.provider, providerMessageId: res.headers.get('x-message-id') || null };
  }
}
