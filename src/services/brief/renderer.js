// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note email renderer (WS-F / N2).
//
// renderEmail(record, opts) → { subject, preheader, html, text, meta }
//
// Pure and deterministic: same record + same opts (including `now`) → the
// exact same bytes, which is what makes the renderer snapshot test and the
// "re-rendering is deterministic from the canonical record" delivery design
// hold. No I/O, no env, no randomness, no model calls.
//
// Law enforced here (cites in docs/MOUNT_N2.md):
//   • negative-band and crisis-band items never render (composer excludes;
//     the renderer re-checks defensively);
//   • sensitive-neutral copy is passed through applyVoiceGuard (no "!", no
//     cheer words) and suppresses the Pro teaser for the whole note;
//   • customer copy never says "brief"; subject/preheader carry no names;
//   • one 🌲 max, header only; no em or en dashes in rendered output;
//   • Free ≤8 content rows, Pro/Trial ≤12; section caps 6/4/3/1;
//   • footer always: privacy line, delivery controls, scoped unsubscribe.
// ─────────────────────────────────────────────────────────────────────────────

import { applyVoiceGuard } from '../voiceGuard.js';
import { renderableItems } from './composer.js';
import { COPY, CAPS, cardHtml, sectionHtml, shellHtml, teaserHtml, footerHtml } from './template.js';

const SECTION_OF = {
  birthday: 'thisWeek',
  saved_item: 'trackedEvents',
  drift: 'yourPeople',
  life_event: 'yourPeople',
  goal_followup: 'yourPeople',
};

export function renderEmail(record, { now, links, muted = false }) {
  const view = renderableItems(record);
  const tz = record.user.timezone || 'America/New_York';

  // Suppression window (muted): the playful/promotional layer is off — no 🌲,
  // no opening line, no one-small-thing, no teaser; date-critical factual
  // items (birthdays, tracked events) continue normally. Safety spec §6.
  const kept = (muted ? view.items.filter((i) => SECTION_OF[i.type] !== 'yourPeople') : view.items)
    .filter((i) => i.band !== 'negative' && i.band !== 'crisis');

  const totalCap = record.tier === 'free' ? CAPS.totalFree : CAPS.totalPro;
  const sections = { thisWeek: [], yourPeople: [], trackedEvents: [] };
  let total = 0;
  let overflow = false;
  for (const it of kept) {
    const sec = SECTION_OF[it.type] || 'yourPeople';
    if (total >= totalCap || sections[sec].length >= CAPS[sec]) { overflow = true; continue; }
    sections[sec].push(it);
    total++;
  }

  const smallThing = muted ? null : oneSmallThing(sections, kept);
  const showTeaser = view.showTeaser && !muted;

  const subject = muted ? COPY.subjectMuted : COPY.subject;
  const preheader = buildPreheader(sections, smallThing);
  const headerLine = muted ? COPY.headerMuted : COPY.header;
  const weekRange = formatWeekRange(now, tz);
  const writtenLine = `written ${formatWritten(now, tz)}`;
  const openingLine = muted ? null : buildOpeningLine(kept);
  const quiet = total === 0;

  const html = buildHtml({
    record, sections, smallThing, showTeaser, subject, preheader, headerLine,
    weekRange, writtenLine, openingLine, quiet, overflow, links,
  });
  const text = buildText({
    sections, smallThing, showTeaser, headerLine, weekRange, writtenLine,
    openingLine, quiet, overflow, links,
  });

  return {
    subject, preheader, html, text,
    meta: {
      renderedItemIds: [...sections.thisWeek, ...sections.yourPeople, ...sections.trackedEvents].map((i) => i.id),
      excludedCount: view.excludedCount,
      hasSensitive: view.hasSensitive,
      teaserShown: showTeaser,
      quiet,
      muted,
    },
  };
}

// ── copy builders (every string deterministic, no names in preheader) ───────

function buildOpeningLine(items) {
  const first = items[0];
  if (!first) return null;
  switch (first.type) {
    case 'birthday': return 'A birthday in the middle of this one.';
    case 'drift': return 'A couple of people worth circling back to.';
    case 'saved_item': return 'Something on the calendar this week.';
    case 'life_event': return 'A few things moving in your circle.';
    default: return 'A steady one, with a little to hold onto.';
  }
}

function buildPreheader(sections, smallThing) {
  const parts = [];
  const nBday = sections.thisWeek.length;
  const nPeople = sections.yourPeople.length;
  const nEvents = sections.trackedEvents.length;
  if (nBday) parts.push(nBday === 1 ? 'a birthday' : `${countWord(nBday)} birthdays`);
  if (nPeople) parts.push(nPeople === 1 ? 'one person to circle back to' : `${countWord(nPeople)} people to circle back to`);
  if (nEvents) parts.push(nEvents === 1 ? 'something coming up' : 'a few things coming up');
  if (!parts.length) return smallThing ? 'A quiet one, in a good way' : 'A quiet one';
  return capFirst(parts.slice(0, 2).join(' and ')) + ' this week';
}

function countWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

// One card's copy: eyebrow, serif anchor (person name), one warm body
// sentence. Sensitive-neutral bodies pass through applyVoiceGuard so cheer
// words and exclamation points are structurally impossible next to them.
function cardCopy(it) {
  let eyebrow = null;
  let body;
  const name = it.personName;
  switch (it.type) {
    case 'birthday':
      // The serif anchor already carries the name; don't repeat it in the body.
      eyebrow = 'Birthday';
      body = capFirst(`${it.body}.`);
      break;
    case 'drift':
      eyebrow = 'Worth a hello';
      body = capFirst(`${it.body}.`);
      break;
    case 'life_event':
      eyebrow = 'On their plate';
      body = capFirst(`${it.body}.`);
      break;
    case 'saved_item':
      eyebrow = 'Coming up';
      body = capFirst(`${it.body}.`);
      break;
    case 'goal_followup':
      eyebrow = 'From last week';
      body = `Still on your mind from last week: ${it.body}.`;
      break;
    default:
      body = capFirst(`${it.body}.`);
  }
  body = sanitizeProse(body);
  if (it.band === 'sensitive_neutral') {
    body = applyVoiceGuard({ reply: body, band: it.band }).reply;
  }
  return { eyebrow, anchor: name, body };
}

function oneSmallThing(sections, kept) {
  const drift = sections.yourPeople.find((i) => i.type === 'drift' && i.personName);
  if (drift) return `Text ${drift.personName}. A small hello goes a long way.`;
  const bday = sections.thisWeek.find((i) => i.personName);
  if (bday) return `A quick note to ${bday.personName} before the day would land well.`;
  if (!kept.length) return 'Who do you want to make time for this week? One name is enough.';
  return 'Who do you want to make time for this week? One name is enough.';
}

// Stored bodies are extraction-derived and may carry characters our copy law
// bans; normalize them at the boundary. Em and en dashes become commas.
function sanitizeProse(s) {
  return String(s)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function capFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── date formatting (tz-aware, deterministic from `now`) ────────────────────

function fmt(now, tz, opts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(now);
}

function formatWeekRange(now, tz) {
  const end = new Date(now.getTime() + 6 * 86400000);
  const startMonth = fmt(now, tz, { month: 'long' });
  const endMonth = fmt(end, tz, { month: 'long' });
  const startDay = fmt(now, tz, { day: 'numeric' });
  const endDay = fmt(end, tz, { day: 'numeric' });
  return startMonth === endMonth
    ? `${startMonth} ${startDay} to ${endDay}`
    : `${startMonth} ${startDay} to ${endMonth} ${endDay}`;
}

function formatWritten(now, tz) {
  const weekday = fmt(now, tz, { weekday: 'long' });
  const hour = fmt(now, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(/\s/g, '');
  return `${weekday} at ${hour}`;
}

// ── HTML assembly ───────────────────────────────────────────────────────────

function buildHtml({ record, sections, smallThing, showTeaser, subject, preheader, headerLine, weekRange, writtenLine, openingLine, quiet, overflow, links }) {
  const secHtml = [];

  secHtml.push(sectionRows(COPY.sections.thisWeek, sections.thisWeek, links));
  secHtml.push(sectionRows(COPY.sections.yourPeople, sections.yourPeople, links));
  secHtml.push(sectionRows(COPY.sections.trackedEvents, sections.trackedEvents, links));

  if (quiet) {
    secHtml.push(sectionHtml(COPY.sections.oneSmallThing, cardHtml({ eyebrow: null, anchor: null, body: `${COPY.quietLine} ${smallThing || COPY.quietClose}` })));
  } else if (smallThing) {
    secHtml.push(sectionHtml(COPY.sections.oneSmallThing, cardHtml({ eyebrow: null, anchor: null, body: smallThing })));
  }

  if (overflow && links.viewUrl) {
    secHtml.push(teaserHtml(`${COPY.overflowNote}`));
  }

  return shellHtml({
    title: subject.replace(' 🌲', ''),
    preheader,
    headerLine,
    weekRange,
    writtenLine,
    openingLine,
    sectionsHtml: secHtml.join(''),
    teaserHtml: showTeaser ? teaserHtml(COPY.proAggregate) : '',
    footerHtml: footerHtml({
      privacyUrl: links.privacyUrl,
      controlsUrl: links.controlsUrl,
      unsubscribeUrl: links.unsubscribeUrl,
    }),
  });
}

function sectionRows(title, items, links) {
  if (!items.length) return '';
  const rows = items.map((it) => {
    const { eyebrow, anchor, body } = cardCopy(it);
    return cardHtml({ eyebrow, anchor, body, actions: actionLinks(it, links) });
  }).join('');
  return sectionHtml(title, rows);
}

// Quiet inline links per card; the caller decides which items got tokens
// (≤3 actionable per note). Sensitive cards never carry playful actions.
function actionLinks(it, links) {
  const a = links.itemActions?.[it.id];
  if (!a) return [];
  const out = [];
  if (a.remindUrl) out.push({ href: a.remindUrl, label: 'Remind me tomorrow' });
  if (a.handledUrl) out.push({ href: a.handledUrl, label: 'Mark as handled' });
  return out;
}

// ── plaintext assembly (always included; mirrors the HTML) ──────────────────

function buildText({ sections, smallThing, showTeaser, headerLine, weekRange, writtenLine, openingLine, quiet, overflow, links }) {
  const L = [];
  L.push(headerLine);
  L.push(`${weekRange} · ${writtenLine}`);
  if (openingLine) { L.push(''); L.push(openingLine); }

  const pushSection = (title, items) => {
    if (!items.length) return;
    L.push('');
    L.push(title);
    for (const it of items) {
      const { anchor, body } = cardCopy(it);
      const a = links.itemActions?.[it.id];
      L.push(`- ${anchor ? anchor + ': ' : ''}${body}`);
      if (a?.remindUrl) L.push(`  Remind me tomorrow: ${a.remindUrl}`);
      if (a?.handledUrl) L.push(`  Mark as handled: ${a.handledUrl}`);
    }
  };

  pushSection(COPY.sections.thisWeek, sections.thisWeek);
  pushSection(COPY.sections.yourPeople, sections.yourPeople);
  pushSection(COPY.sections.trackedEvents, sections.trackedEvents);

  if (quiet) {
    L.push('');
    L.push(COPY.sections.oneSmallThing);
    L.push(`${COPY.quietLine} ${smallThing || COPY.quietClose}`);
  } else if (smallThing) {
    L.push('');
    L.push(COPY.sections.oneSmallThing);
    L.push(smallThing);
  }

  if (overflow && links.viewUrl) { L.push(''); L.push(`${COPY.overflowNote} ${links.viewUrl}`); }
  if (showTeaser) { L.push(''); L.push(COPY.proAggregate); }

  L.push('');
  L.push(COPY.privacyLine);
  L.push(`${COPY.privacyLabel}: ${links.privacyUrl}`);
  L.push(`${COPY.deliveryControls}: ${links.controlsUrl}`);
  L.push(`${COPY.unsubscribeLabel}: ${links.unsubscribeUrl}`);
  return L.join('\n');
}
