// ─────────────────────────────────────────────────────────────────────────────
// Render a validated today_brief_v1 into an email. Pure — no imports, no I/O.
//
// Everything rendered here has already survived validateBrief(), so every
// citation is real and every priority carries evidence. The renderer's own job
// is narrow: escape, structure, and never add a claim the brief did not make.
//
// The model disclaimer and the confidence caveat are rendered UNCONDITIONALLY.
// They are the two pieces of context that stop a fluent paragraph from reading
// as established fact, and a renderer that drops them when space is tight is
// the mechanism by which that protection quietly disappears.
// ─────────────────────────────────────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * HTML-escape. Applied to EVERY interpolated value without exception —
 * including model output, which is untrusted text that reached us from an
 * inbox by way of a language model.
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Human-readable label for a citation type, mirroring CoS's own fallback. */
export function refLabel(type) {
  return String(type ?? '').replaceAll('_', ' ');
}

function citationLine(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return '';
  const counts = new Map();
  for (const r of refs) {
    const label = refLabel(r.type);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, n]) => (n > 1 ? `${n} × ${label}` : label))
    .join(' · ');
}

export function briefSubject(brief, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const top = (brief.top_priorities || [])[0];
  // The first priority's title in the subject means the inbox preview carries
  // the actual point, not the word "brief".
  return top && top.title ? `Cedrus daily brief — ${day} — ${top.title}` : `Cedrus daily brief — ${day}`;
}

export function renderText(brief, now = new Date()) {
  const L = [];
  L.push(`CEDRUS DAILY BRIEF — ${now.toISOString().slice(0, 10)}`);
  L.push('');
  L.push(brief.summary || '(no summary)');
  L.push('');

  const priorities = brief.top_priorities || [];
  if (priorities.length > 0) {
    L.push('TOP PRIORITIES');
    for (const p of priorities) {
      L.push('');
      L.push(`${p.rank}. [${String(p.urgency).toUpperCase()}] ${p.title}`);
      L.push(`   Why: ${p.reason}`);
      L.push(`   Do:  ${p.recommended_action}`);
      L.push(`   Confidence ${Math.round((p.confidence || 0) * 100)}% — how well your records support this, not how sure the model sounds.`);
      const cites = citationLine(p.source_refs);
      if (cites) L.push(`   Based on: ${cites}`);
    }
    L.push('');
  }

  const sections = [
    ['DECISIONS TO MAKE', brief.decisions_to_make, (d) => d.question],
    ['WAITING ON', brief.people_or_dependencies_waiting, (w) => `${w.who} — ${w.what}`],
    ['RISKS', brief.risks, (r) => r.risk],
  ];
  for (const [heading, list, fmt] of sections) {
    if (Array.isArray(list) && list.length > 0) {
      L.push(heading);
      for (const item of list) {
        const cites = citationLine(item.source_refs);
        L.push(`- ${fmt(item)}${cites ? ` (based on: ${cites})` : ''}`);
      }
      L.push('');
    }
  }

  const gaps = brief.not_enough_evidence || [];
  if (gaps.length > 0) {
    L.push('NOT ENOUGH EVIDENCE');
    for (const g of gaps) L.push(`- ${g}`);
    L.push('');
  }

  L.push('—');
  L.push(brief.model_disclaimer || '');
  L.push('Composed by Cedrus from Chief of Staff records and ingested email.');
  L.push('To stop these: unset COS_BRIEF_LIVE on the Cedrus backend.');
  return L.join('\n');
}

export function renderHtml(brief, now = new Date()) {
  const P = [];
  P.push('<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2a24;line-height:1.5">');
  P.push(`<p style="font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#8a8570;margin:0 0 4px">Cedrus daily brief</p>`);
  P.push(`<p style="font-size:.8rem;color:#8a8570;margin:0 0 18px">${esc(now.toISOString().slice(0, 10))}</p>`);
  P.push(`<p style="font-size:.95rem;margin:0 0 8px">${esc(brief.summary || '(no summary)')}</p>`);
  P.push(`<p style="font-size:.72rem;color:#8a8570;font-style:italic;margin:0 0 22px">${esc(brief.model_disclaimer || '')}</p>`);

  const priorities = brief.top_priorities || [];
  if (priorities.length > 0) {
    P.push('<h2 style="font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#737f45;margin:0 0 10px">Top priorities</h2>');
    for (const p of priorities) {
      P.push('<div style="border-left:3px solid #737f45;padding:2px 0 2px 12px;margin:0 0 16px">');
      P.push(`<p style="margin:0 0 4px;font-weight:600">${esc(p.rank)}. ${esc(p.title)} <span style="font-weight:400;font-size:.72rem;color:#8a8570">(${esc(p.urgency)})</span></p>`);
      P.push(`<p style="margin:0 0 4px;font-size:.86rem">${esc(p.reason)}</p>`);
      P.push(`<p style="margin:0 0 4px;font-size:.86rem"><strong>Do:</strong> ${esc(p.recommended_action)}</p>`);
      P.push(`<p style="margin:0;font-size:.72rem;color:#8a8570">Confidence ${esc(Math.round((p.confidence || 0) * 100))}% — how well your records support this, not how sure the model sounds.</p>`);
      const cites = citationLine(p.source_refs);
      if (cites) P.push(`<p style="margin:2px 0 0;font-size:.72rem;color:#8a8570">Based on: ${esc(cites)}</p>`);
      P.push('</div>');
    }
  }

  const sections = [
    ['Decisions to make', brief.decisions_to_make, (d) => d.question],
    ['Waiting on', brief.people_or_dependencies_waiting, (w) => `${w.who} — ${w.what}`],
    ['Risks', brief.risks, (r) => r.risk],
  ];
  for (const [heading, list, fmt] of sections) {
    if (Array.isArray(list) && list.length > 0) {
      P.push(`<h2 style="font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#737f45;margin:18px 0 8px">${esc(heading)}</h2><ul style="margin:0;padding-left:18px">`);
      for (const item of list) {
        const cites = citationLine(item.source_refs);
        P.push(`<li style="font-size:.86rem;margin:0 0 5px">${esc(fmt(item))}${cites ? ` <span style="font-size:.72rem;color:#8a8570">(${esc(cites)})</span>` : ''}</li>`);
      }
      P.push('</ul>');
    }
  }

  const gaps = brief.not_enough_evidence || [];
  if (gaps.length > 0) {
    P.push('<h2 style="font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#737f45;margin:18px 0 8px">Not enough evidence</h2><ul style="margin:0;padding-left:18px">');
    for (const g of gaps) P.push(`<li style="font-size:.86rem;margin:0 0 5px;color:#8a8570">${esc(g)}</li>`);
    P.push('</ul>');
  }

  P.push('<hr style="border:0;border-top:1px solid #e6e2d5;margin:24px 0 10px">');
  P.push('<p style="font-size:.7rem;color:#8a8570;margin:0">Composed by Cedrus from Chief of Staff records and ingested email.</p>');
  P.push('<p style="font-size:.7rem;color:#8a8570;margin:4px 0 0">To stop these: unset <code>COS_BRIEF_LIVE</code> on the Cedrus backend.</p>');
  P.push('</div>');
  return P.join('');
}

export function renderBriefEmail(brief, now = new Date()) {
  return {
    subject: briefSubject(brief, now),
    text: renderText(brief, now),
    html: renderHtml(brief, now),
  };
}
