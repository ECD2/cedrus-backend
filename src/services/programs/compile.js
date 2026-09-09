// ─────────────────────────────────────────────────────────────────────────────
// Program source compiler — text in, dated items out. PURE. No database, no
// clock unless a dateless routine has no start and one is not supplied.
//
// WHAT A SOURCE LOOKS LIKE (the format the load script accepts today; the
// real Miami Man 2026 plan and the care routine do not exist yet as files,
// and when they do, THEIR dates win — see "where the dates come from")
//
//   # comment lines start with #; blank lines are ignored
//   title: Miami Man 2026 (synthetic)
//   kind: training                     training | routine
//   time_zone: America/New_York        IANA; defaults to America/New_York
//   start: 2026-09-08                  optional for training (else earliest item)
//   end: 2026-11-15                    optional for training (else latest item)
//   description: one line
//
//   # training items — one per line:
//   # date       | category | title            | start | minutes | instructions
//   2026-09-08   | swim     | Endurance swim   | 06:30 | 45      | 1500m steady
//
//   # routine items (dateless) — weekday(s) or daily instead of a date:
//   daily        | face     | Morning face     | 07:00 | 5       | cleanse, SPF
//   mon,thu      | shampoo  | Wash             | -     | 10      | ...
//
// A routine is materialised onto calendar dates from a start date over a
// horizon of days (header `horizon_days:`, else the --horizon-days argument,
// else 28). The program row keeps end_date NULL — it is open-ended — while
// its items carry real dates, because program_items.scheduled_date is a DATE.
//
// THE DAY COUNT IS DERIVED, NEVER HARDCODED. For a training plan
//   days = end_date - start_date + 1
// computed from the source's own dates, and the compiler refuses a plan that
// leaves a day in that range without an item or puts an item outside it. The
// report prints rows, days and distinct dates side by side, and says where
// start and end came from. For a routine, days is the horizon.
//
// THE CATEGORY LIST BELOW IS A MIRROR of program_items_category_check in the
// migration, kept ONLY so a dry run can refuse a bad category without a
// database. The constraint is the authority; Bundle 43 asserts the two lists
// are identical, so they cannot drift apart silently (Lesson 20).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

export const CATEGORIES = ['swim', 'bike', 'run', 'lift', 'brick', 'open_water', 'rest',
  'shampoo', 'condition', 'body', 'oil', 'face'];
export const KINDS = ['training', 'routine'];
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // index = Date#getUTCDay()
export const DEFAULT_TIME_ZONE = 'America/New_York';
export const DEFAULT_HORIZON_DAYS = 28;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const HEADER_RE = /^([a-z_]+):\s*(.*)$/;

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ── date arithmetic on YYYY-MM-DD strings, in UTC so no local zone leaks in ──
export function parseDate(s) {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Reject 2026-02-30: Date.UTC rolls it over silently.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t;
}
export function fmtDate(t) { return new Date(t).toISOString().slice(0, 10); }
export function addDays(t, n) { return t + n * 86_400_000; }
/** Inclusive day count between two YYYY-MM-DD strings. */
export function daysInclusive(startIso, endIso) {
  return Math.round((parseDate(endIso) - parseDate(startIso)) / 86_400_000) + 1;
}
export function weekdayOf(isoDate) { return WEEKDAYS[new Date(parseDate(isoDate)).getUTCDay()]; }

/** Today's calendar date in an IANA zone, as YYYY-MM-DD. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

function fail(line, msg) {
  const err = new Error(line ? `line ${line}: ${msg}` : msg);
  err.line = line;
  throw err;
}

function cell(v) {
  const s = (v === undefined ? '' : String(v)).trim();
  return s === '' || s === '-' ? null : s;
}

/**
 * Parse a source into a header and raw item lines. Pure.
 */
export function parseSource(text) {
  const header = {};
  const lines = [];
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  raw.forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    if (!t.includes('|')) {
      const m = HEADER_RE.exec(t);
      if (!m) fail(n, `not a header (key: value) and not an item (cells separated by |): "${t}"`);
      header[m[1]] = m[2].trim();
      return;
    }
    const cells = t.split('|').map(cell);
    if (cells.length < 3) fail(n, 'an item needs at least when | category | title');
    const [when, category, title, start, minutes, ...rest] = cells;
    if (!when) fail(n, 'missing the date / weekday cell');
    if (!category) fail(n, 'missing the category');
    if (!title) fail(n, 'missing the title');
    if (!CATEGORIES.includes(category)) fail(n, `category "${category}" is not in the closed union {${CATEGORIES.join(',')}}`);
    if (start !== null && !TIME_RE.test(start)) fail(n, `start "${start}" is not HH:MM (24h) or -`);
    let dur = null;
    if (minutes !== null) {
      dur = Number(minutes);
      if (!Number.isInteger(dur) || dur <= 0) fail(n, `minutes "${minutes}" is not a positive integer or -`);
    }
    const instructions = rest.filter((x) => x !== null).join(' | ') || null;
    lines.push({ line: n, when, category, title, planned_start_local: start, planned_duration_minutes: dur, instructions });
  });
  return { header, lines };
}

/**
 * Compile a source into a program row, its items and the derived statistics.
 *
 * @param {string} text          the source, verbatim (this exact string is stored)
 * @param {object} opts
 * @param {string} opts.sourceName
 * @param {string|null} [opts.start]         YYYY-MM-DD; routines only, when the source has none
 * @param {number|null} [opts.horizonDays]   routines only
 * @param {Date}   [opts.now]                for "today", routines with no start anywhere
 */
export function compileSource(text, { sourceName, start = null, horizonDays = null, now = new Date() } = {}) {
  if (typeof text !== 'string' || text.trim() === '') fail(0, 'the source is empty');
  if (!sourceName) fail(0, 'sourceName is required');
  const { header, lines } = parseSource(text);

  const kind = header.kind;
  if (!KINDS.includes(kind)) fail(0, `header kind: must be one of ${KINDS.join(' | ')} (got "${kind || ''}")`);
  const title = header.title;
  if (!title) fail(0, 'header title: is required');
  const time_zone = header.time_zone || DEFAULT_TIME_ZONE;
  try { todayIn(time_zone, now); } catch { fail(0, `header time_zone: "${time_zone}" is not a known IANA zone`); }
  if (lines.length === 0) fail(0, 'the source has no items');

  const items = [];
  let start_date; let end_date; let days; let datesFrom;

  if (kind === 'training') {
    for (const l of lines) {
      if (parseDate(l.when) === null) fail(l.line, `a training item needs a real date YYYY-MM-DD (got "${l.when}")`);
    }
    if (start !== null) fail(0, '--start is only for a dateless routine; a training plan carries its own dates');
    const dates = lines.map((l) => parseDate(l.when));
    const earliest = fmtDate(Math.min(...dates));
    const latest = fmtDate(Math.max(...dates));
    const fromHeader = [];
    if (header.start) {
      if (parseDate(header.start) === null) fail(0, `header start: "${header.start}" is not YYYY-MM-DD`);
      start_date = header.start; fromHeader.push('start');
    } else start_date = earliest;
    if (header.end) {
      if (parseDate(header.end) === null) fail(0, `header end: "${header.end}" is not YYYY-MM-DD`);
      end_date = header.end; fromHeader.push('end');
    } else end_date = latest;
    if (parseDate(end_date) < parseDate(start_date)) fail(0, `end ${end_date} is before start ${start_date}`);
    datesFrom = fromHeader.length === 2
      ? 'the source header (start:/end:)'
      : fromHeader.length === 0
        ? 'the source item lines (earliest and latest date)'
        : `the source header (${fromHeader[0]}:) and the item lines for the other end`;
    days = daysInclusive(start_date, end_date);
    for (const l of lines) {
      if (l.when < start_date || l.when > end_date) fail(l.line, `${l.when} is outside the plan's dates ${start_date}..${end_date}`);
      items.push(toItem(l, l.when, `line ${l.line}`));
    }
    // Every day in the range must carry at least one item (rest days are items).
    const have = new Set(items.map((i) => i.scheduled_date));
    const missing = [];
    for (let t = parseDate(start_date); t <= parseDate(end_date); t = addDays(t, 1)) {
      if (!have.has(fmtDate(t))) missing.push(fmtDate(t));
    }
    if (missing.length) fail(0, `${missing.length} day(s) in ${start_date}..${end_date} have no item (first: ${missing[0]}); a rest day is an item too`);
  } else {
    // routine — dateless, materialised from a start over a horizon
    for (const l of lines) {
      const days_ = l.when.split(',').map((x) => x.trim().toLowerCase());
      for (const d of days_) {
        if (d !== 'daily' && !WEEKDAYS.includes(d)) fail(l.line, `a routine item needs weekday(s) mon..sun or daily (got "${l.when}")`);
      }
      l.days = days_;
    }
    if (header.end) fail(0, 'a routine has no end: — it is open-ended; end_date stays NULL');
    if (header.start) {
      if (parseDate(header.start) === null) fail(0, `header start: "${header.start}" is not YYYY-MM-DD`);
      start_date = header.start; datesFrom = 'the source header (start:)';
    } else if (start) {
      if (parseDate(start) === null) fail(0, `--start "${start}" is not YYYY-MM-DD`);
      start_date = start; datesFrom = 'the --start argument (the source is dateless)';
    } else {
      start_date = todayIn(time_zone, now); datesFrom = `today in ${time_zone} (the source is dateless and no --start was given)`;
    }
    const h = header.horizon_days ? Number(header.horizon_days) : (horizonDays ?? DEFAULT_HORIZON_DAYS);
    if (!Number.isInteger(h) || h <= 0 || h > 366) fail(0, `horizon_days must be an integer 1..366 (got ${h})`);
    days = h;
    end_date = null;
    for (let k = 0; k < h; k++) {
      const date = fmtDate(addDays(parseDate(start_date), k));
      const wd = weekdayOf(date);
      for (const l of lines) {
        if (l.days.includes('daily') || l.days.includes(wd)) items.push(toItem(l, date, `line ${l.line} → ${date}`));
      }
    }
    if (items.length === 0) fail(0, 'the routine produced no items over the horizon');
  }

  // item_key uniqueness within the revision — the DB enforces it too; naming
  // the lines here is friendlier than a 23505 later.
  const seen = new Map();
  for (const it of items) {
    if (seen.has(it.item_key)) fail(0, `duplicate item ${it.item_key} (${seen.get(it.item_key)} and ${it.source_locator}); give the two items different titles`);
    seen.set(it.item_key, it.source_locator);
  }
  items.sort((a, b) => (a.scheduled_date < b.scheduled_date ? -1 : a.scheduled_date > b.scheduled_date ? 1
    : (a.planned_start_local || '99') < (b.planned_start_local || '99') ? -1 : (a.planned_start_local || '99') > (b.planned_start_local || '99') ? 1
      : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  const per_category = {};
  for (const it of items) per_category[it.category] = (per_category[it.category] || 0) + 1;
  const distinct_dates = new Set(items.map((i) => i.scheduled_date)).size;

  return {
    program: { kind, title, description: header.description || null, start_date, end_date, time_zone },
    items,
    source: { name: sourceName, text, sha256: sha256Hex(text) },
    stats: { rows: items.length, days, distinct_dates, per_category, dates_from: datesFrom, start_date, end_date, horizon_days: kind === 'routine' ? days : null },
  };
}

function toItem(l, date, locator) {
  return {
    item_key: `${date}:${l.category}:${slug(l.title)}`,
    scheduled_date: date,
    category: l.category,
    title: l.title,
    instructions: l.instructions,
    planned_start_local: l.planned_start_local,
    planned_duration_minutes: l.planned_duration_minutes,
    source_locator: locator,
  };
}

/**
 * The dry-run report: the full dated table, per-category counts, and the
 * derived day count next to the row count. Returns lines; the script prints.
 */
export function renderReport(compiled) {
  const { program, items, stats, source } = compiled;
  const L = [];
  L.push(`program   ${program.title}  [${program.kind}]  tz ${program.time_zone}`);
  L.push(`source    ${source.name}  sha256 ${source.sha256}`);
  L.push(`dates     ${stats.start_date} .. ${stats.end_date || 'open-ended'}  (from ${stats.dates_from})`);
  if (program.kind === 'training') {
    L.push(`days      ${stats.days}  = end_date - start_date + 1, derived from those dates`);
    L.push(`rows      ${stats.rows}  (distinct dates ${stats.distinct_dates})`);
    L.push(`check     rows == days: ${stats.rows === stats.days ? 'YES' : `NO — ${stats.rows - stats.days} day(s) carry more than one item`}; every day covered: YES (the compiler refuses gaps)`);
  } else {
    L.push(`horizon   ${stats.days} day(s) materialised from ${stats.start_date}; end_date NULL (open-ended)`);
    L.push(`rows      ${stats.rows}  over ${stats.distinct_dates} distinct date(s)`);
  }
  L.push('');
  L.push('date        wd   category    start  min   title                              instructions');
  for (const it of items) {
    L.push(
      `${it.scheduled_date}  ${weekdayOf(it.scheduled_date)}  ${it.category.padEnd(10)}  ${(it.planned_start_local || '-').padEnd(5)}  ` +
      `${String(it.planned_duration_minutes ?? '-').padEnd(4)}  ${it.title.slice(0, 33).padEnd(33)}  ${(it.instructions || '').slice(0, 60)}`);
  }
  L.push('');
  L.push('per category');
  for (const [c, n] of Object.entries(stats.per_category).sort()) L.push(`  ${c.padEnd(10)} ${n}`);
  L.push(`  ${'total'.padEnd(10)} ${stats.rows}`);
  return L;
}
