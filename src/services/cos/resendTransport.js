// ─────────────────────────────────────────────────────────────────────────────
// Resend transport for the CoS daily brief.
//
// ── PREMISE CORRECTION, RECORDED HERE ON PURPOSE ────────────────────────────
// The build prompt said "deliver via Resend, which this repo already uses."
// It does not. `grep -rni resend` across cedrus-backend returns only prose in
// CEDRUS.md and cedrus-miami docs — zero code, and no `resend` dependency in
// package.json. Resend IS the company-level LOCKED choice (CEDRUS.md:502,
// "Resend. Not SendGrid") and IS used in cedrus-miami (`sendResendEmail`), but
// this backend's only email transports are MockEmlTransport (default) and a
// hard-gated SendgridTransport stub. So this file is new, and it is built to
// the exact shape of that existing stub rather than inventing a second style.
//
// ── NO NEW DEPENDENCY ───────────────────────────────────────────────────────
// Raw `fetch`, exactly as SendgridTransport does. Adding the `resend` npm
// package would mean an install and a lockfile change (bun.lock is gitignored
// here), for an HTTP POST with three fields.
//
// ── THREE GATES, ALL OF WHICH MUST BE OPEN ──────────────────────────────────
//   1. COS_BRIEF_LIVE=true      — the explicit arming switch
//   2. RESEND_API_KEY           — credentials
//   3. COS_BRIEF_TO             — a recipient. There is NO default, ever.
//
// Gate 3 is the one worth arguing for. A misconfigured mailer with a default
// recipient sends real mail to whatever address the developer happened to type
// while testing. Refusing to construct without an explicit recipient means the
// failure is "nothing was sent, here is the variable to set" rather than "a
// brief containing your inbox went somewhere you did not choose."
//
// ── SENDING IDENTITY ────────────────────────────────────────────────────────
// From `updates.cedrus.life`, NOT the root domain. Resend's SPF/DKIM are
// verified for the subdomain only (CEDRUS.md:512, :516, III.4); the root
// carries Purelymail's records and its DMARC policy is p=reject. Sending
// Resend mail from `brief@cedrus.life` would fail alignment and land in spam
// while looking like it worked — the exact silent failure CEDRUS.md:516 warns
// about. The existing SendgridTransport's `brief@cedrus.life` identity is
// therefore deliberately NOT reused here.
//
// ── NO List-Unsubscribe ─────────────────────────────────────────────────────
// This is 1:1 operational mail from the owner's own system to the owner, not
// bulk or commercial mail. A one-click unsubscribe header would point at
// infrastructure that does not exist and could not honour it. The plain-text
// footer says how to actually stop it — unset one variable — which is a
// promise this system can keep.
// ─────────────────────────────────────────────────────────────────────────────

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Verified Resend sending domain. Do not move this to the root domain. */
export const DEFAULT_FROM = 'Cedrus <brief@updates.cedrus.life>';
export const DEFAULT_REPLY_TO = 'emil@cedrus.life';

/**
 * Read the delivery configuration. Mirrors cosEnv(): three-state, and
 * `partial` is a distinct, reportable condition rather than a silent disarm.
 */
export function deliveryEnv(env = process.env) {
  const live = env.COS_BRIEF_LIVE === 'true';
  const apiKey = (env.RESEND_API_KEY || '').trim();
  const to = (env.COS_BRIEF_TO || '').trim();
  const from = (env.COS_BRIEF_FROM || '').trim() || DEFAULT_FROM;
  const replyTo = (env.COS_BRIEF_REPLY_TO || '').trim() || DEFAULT_REPLY_TO;
  const missing = [];
  if (!live) missing.push('COS_BRIEF_LIVE=true');
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!to) missing.push('COS_BRIEF_TO');
  return { live, apiKey, to, from, replyTo, ready: missing.length === 0, missing };
}

/**
 * Factory. Returns a transport, or null when delivery is not fully configured.
 *
 * Returning null rather than throwing is deliberate: not-configured is the
 * DEFAULT and expected state of this feature, and the job reports it as a mode
 * (`cos.delivery.mode`), not as a failure. Only a *partially* configured
 * live send is an error, and that is the job's call to make, not the factory's.
 */
export function createResendTransport(env = process.env, { fetchImpl } = {}) {
  const cfg = deliveryEnv(env);
  if (!cfg.ready) return null;
  return new ResendTransport(env, { fetchImpl });
}

export class ResendTransport {
  constructor(env = process.env, { fetchImpl } = {}) {
    const cfg = deliveryEnv(env);
    // Named-variable errors, every time (Lesson 17): the message says exactly
    // what a human would go and set.
    if (!cfg.live) {
      throw new Error(
        'ResendTransport is gated OFF: set COS_BRIEF_LIVE=true explicitly to enable live email.');
    }
    if (!cfg.apiKey) {
      throw new Error(
        'ResendTransport: RESEND_API_KEY is not set; refusing to construct a live sender without credentials.');
    }
    if (!cfg.to) {
      throw new Error(
        'ResendTransport: COS_BRIEF_TO is not set; refusing to construct a sender with no explicit recipient. ' +
        'There is deliberately no default address.');
    }
    this.provider = 'resend';
    this.env = env;
    this.cfg = cfg;
    this.fetchImpl = fetchImpl || globalThis.fetch;
  }

  /** → { provider, providerMessageId } */
  async send({ subject, html, text, to = null }) {
    // Double gate: even a constructed instance re-checks before any network,
    // matching SendgridTransport. An env flipped after construction still
    // stops the send.
    if (this.env.COS_BRIEF_LIVE !== 'true') {
      throw new Error('ResendTransport.send refused: COS_BRIEF_LIVE is not true.');
    }
    const recipient = to || this.cfg.to;
    if (!recipient) {
      throw new Error('ResendTransport.send refused: no recipient (COS_BRIEF_TO).');
    }

    const res = await this.fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: [recipient],
        reply_to: this.cfg.replyTo,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch { detail = '(body unreadable)'; }
      const err = new Error(`resend rejected the send (${res.status}): ${detail}`);
      err.status = res.status;
      throw err;
    }

    let id = null;
    try {
      const body = await res.json();
      id = (body && body.id) || null;
    } catch {
      // A 2xx with an unparseable body still means Resend accepted it. Losing
      // the id costs traceability, not correctness — never treat it as a
      // failure, or the ledger would mark a delivered brief unsent.
      id = null;
    }
    return { provider: this.provider, providerMessageId: id };
  }
}
