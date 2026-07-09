// Minimal US area-code → timezone map for the first-contact default.
// Expand with a full dataset later; always treat as a default the user can correct.
const AREA_CODE_TZ = {
  '305': 'America/New_York', '786': 'America/New_York', '954': 'America/New_York',
  '212': 'America/New_York', '917': 'America/New_York', '404': 'America/New_York',
  '312': 'America/Chicago',  '713': 'America/Chicago',  '512': 'America/Chicago',
  '303': 'America/Denver',   '602': 'America/Phoenix',
  '415': 'America/Los_Angeles', '310': 'America/Los_Angeles', '206': 'America/Los_Angeles',
};

export function timezoneFromPhone(phone, fallback) {
  const m = /^\+?1(\d{3})/.exec(phone || ''); // works for "+1786..." AND digits-only "1786..."
  return (m && AREA_CODE_TZ[m[1]]) || fallback;
}

// Current local wall-clock for the user's tz, handed to the model so it can
// resolve "9pm tomorrow". (MVP omits the numeric offset; the tz NAME disambiguates.)
export function localNow(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return new Date().toISOString();
  }
}

export function mondayOf(date) {
  const x = new Date(date);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

// ── Brief scheduling/formatting helpers ──────────────────────────────

// Current weekday (lowercase) + hour (0-23) in a timezone — for "is the brief due now?"
export function localParts(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', hour: 'numeric', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { weekday: (p.weekday || '').toLowerCase(), hour: parseInt(p.hour || '0', 10) % 24 };
}

export function localYMD(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Monday (YYYY-MM-DD) of the user's LOCAL week.
export function localWeekOf(timezone, date = new Date()) {
  const d = new Date(localYMD(timezone, date) + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Days until the next occurrence of a month/day birthday, in the user's tz.
export function daysUntilBirthday(month, day, timezone) {
  if (!month || !day) return null;
  const today = new Date(localYMD(timezone) + 'T00:00:00Z');
  const y = today.getUTCFullYear();
  let next = new Date(Date.UTC(y, month - 1, day));
  if (next < today) next = new Date(Date.UTC(y + 1, month - 1, day));
  return Math.round((next - today) / 86400000);
}
