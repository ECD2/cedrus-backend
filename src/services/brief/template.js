// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note email template layer (WS-F / N2).
//
// Brand constants + the HTML/plaintext skeletons the renderer fills in.
// Pure: no imports, no env, no I/O — safe to import from tests directly and
// safe to concatenate in the dependency-free bundle runner.
//
// Copy law (product spec + voice spec, see docs/MOUNT_N2.md for cites):
//   • the customer-facing name is "your weekly note" — the word "brief" never
//     appears in rendered copy, subjects, or link labels;
//   • subject is the stable "Your week 🌲" (deliverability + privacy, PL-D5);
//   • no person names or facts in subject/preheader;
//   • at most one 🌲, header only; no em dashes anywhere in rendered output;
//   • banned vocabulary: "inactive", "locked", "slots used", "downgraded";
//   • urgency inflation ("only 2 days left!") is banned copy;
//   • footer always carries the standing privacy line + delivery controls +
//     scoped unsubscribe ("email only, texts keep working").
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  olive: '#737F45',
  brown: '#3D2D1F',
  cream: '#F2EFE6',
  terracotta: '#C98F70',
  // Warm neutrals derived from the palette for text on cream.
  inkSoft: '#5C4A38',
  ruleSoft: '#E3DCCB',
  serif: "Garamond, 'EB Garamond', 'Apple Garamond', Georgia, 'Times New Roman', serif",
  sans: "Avenir, 'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// Canonical strings (exact wording is normative; do not paraphrase).
export const COPY = {
  subject: 'Your week 🌲',
  subjectMuted: 'Your week', // suppression window: no brand playfulness
  header: 'Your week 🌲',
  headerMuted: 'Your week',
  privacyLine: 'Written from what you’ve shared with me. I never sell or share what you tell me about your people.',
  deliveryControls: 'Change when or how this arrives',
  unsubscribeLabel: 'Unsubscribe (email only, texts keep working)',
  privacyLabel: 'Privacy',
  // Free-tier aggregate teaser: exactly this line, once, bottom, never names.
  proAggregate: 'There’s more happening outside your five. Pro watches everyone: $9/month.',
  quietLine: 'A quiet one. Nothing urgent, everyone’s steady.',
  quietClose: 'Rest easy.',
  overflowNote: 'More in your full note.',
  sections: {
    thisWeek: 'THIS WEEK',
    yourPeople: 'YOUR PEOPLE',
    trackedEvents: 'TRACKED EVENTS',
    oneSmallThing: 'ONE SMALL THING',
  },
};

// Section caps from the ranking spec (email): This week ≤6 · Your people ≤4 ·
// Tracked events ≤3 · One small thing exactly 1 · total ≤12 (Free ≤8).
export const CAPS = {
  thisWeek: 6,
  yourPeople: 4,
  trackedEvents: 3,
  totalPro: 12,
  totalFree: 8,
};

// Escape once, at the template boundary. Rendered bodies are stored plain text.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// One content row (card): eyebrow day/date label, serif person anchor, body,
// then up to two quiet inline action links. Table-based, inline styles only,
// images-off safe (there are no images at all), dark-mode tolerant colors.
export function cardHtml({ eyebrow, anchor, body, actions = [] }) {
  const links = actions
    .map((a) => `<a href="${esc(a.href)}" style="color:${BRAND.olive};text-decoration:underline;font-family:${BRAND.sans};font-size:13px;">${esc(a.label)}</a>`)
    .join(`<span style="color:${BRAND.ruleSoft};">&nbsp;&middot;&nbsp;</span>`);
  return `
  <tr><td style="padding:14px 0 0 0;">
    ${eyebrow ? `<div style="font-family:${BRAND.sans};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.terracotta};padding-bottom:2px;">${esc(eyebrow)}</div>` : ''}
    ${anchor ? `<div style="font-family:${BRAND.serif};font-size:19px;line-height:1.3;color:${BRAND.brown};">${esc(anchor)}</div>` : ''}
    <div style="font-family:${BRAND.sans};font-size:14px;line-height:1.55;color:${BRAND.inkSoft};padding-top:2px;">${esc(body)}</div>
    ${links ? `<div style="padding-top:4px;">${links}</div>` : ''}
  </td></tr>`;
}

export function sectionHtml(title, rowsHtml) {
  if (!rowsHtml) return '';
  return `
  <tr><td style="padding:26px 0 0 0;">
    <div style="font-family:${BRAND.sans};font-size:12px;letter-spacing:2px;color:${BRAND.olive};border-bottom:1px solid ${BRAND.ruleSoft};padding-bottom:6px;">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}
    </table>
  </td></tr>`;
}

// The full email shell. `preheader` is hidden preview text (neutral words, no
// names). All visible copy arrives already composed; this only lays it out.
export function shellHtml({ title, preheader, headerLine, weekRange, writtenLine, openingLine, sectionsHtml, teaserHtml, footerHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.cream};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
  <tr><td style="border-top:4px solid ${BRAND.olive};padding-top:22px;">
    <div style="font-family:${BRAND.serif};font-size:28px;color:${BRAND.brown};">${esc(headerLine)}</div>
    <div style="font-family:${BRAND.sans};font-size:13px;color:${BRAND.inkSoft};padding-top:6px;">${esc(weekRange)}${writtenLine ? ` &middot; ${esc(writtenLine)}` : ''}</div>
    ${openingLine ? `<div style="font-family:${BRAND.serif};font-size:16px;line-height:1.5;color:${BRAND.brown};padding-top:14px;">${esc(openingLine)}</div>` : ''}
  </td></tr>
  ${sectionsHtml}
  ${teaserHtml}
  ${footerHtml}
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function teaserHtml(line) {
  if (!line) return '';
  return `
  <tr><td style="padding:26px 0 0 0;">
    <div style="font-family:${BRAND.sans};font-size:13px;line-height:1.5;color:${BRAND.inkSoft};border-top:1px solid ${BRAND.ruleSoft};padding-top:14px;">${esc(line)}</div>
  </td></tr>`;
}

export function footerHtml({ privacyUrl, controlsUrl, unsubscribeUrl }) {
  const sep = `<span style="color:${BRAND.ruleSoft};">&nbsp;&middot;&nbsp;</span>`;
  return `
  <tr><td style="padding:30px 0 8px 0;">
    <div style="font-family:${BRAND.sans};font-size:12px;line-height:1.6;color:${BRAND.inkSoft};border-top:1px solid ${BRAND.ruleSoft};padding-top:14px;">
      ${esc(COPY.privacyLine)}
      <div style="padding-top:8px;">
        <a href="${esc(privacyUrl)}" style="color:${BRAND.olive};">${esc(COPY.privacyLabel)}</a>${sep}<a href="${esc(controlsUrl)}" style="color:${BRAND.olive};">${esc(COPY.deliveryControls)}</a>${sep}<a href="${esc(unsubscribeUrl)}" style="color:${BRAND.olive};">${esc(COPY.unsubscribeLabel)}</a>
      </div>
    </div>
  </td></tr>`;
}
