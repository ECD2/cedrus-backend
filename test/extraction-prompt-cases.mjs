// Live-model eval for the extraction prompt fixes (fact-value quality +
// correction supersession). Needs OPENAI_API_KEY (and optionally OPENAI_MODEL)
// in the environment — run where the backend's env lives:
//
//   node test/extraction-prompt-cases.mjs
//
// Each case sends a realistic context block and checks the parsed JSON against
// the failure modes observed in production.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../prompts/extraction.system.txt'), 'utf8');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const PEOPLE_BASE = [
  { id: 'self-1', name: 'Emil', aliases: [], relationship: null, is_self: true },
  { id: 'ana-1', name: 'Ana', aliases: [], relationship: 'girlfriend', is_self: false },
];

function ctx(people, recent, body) {
  return [
    'CURRENT DATETIME: 2026-07-10T21:00:00-04:00   (timezone: America/New_York)',
    'USER: Emil   (first-person "I/me" refers to this person)',
    '', 'KNOWN PEOPLE:', JSON.stringify(people),
    '', 'OPEN QUESTIONS AWAITING AN ANSWER:', '[]',
    '', 'RECENT MESSAGES (oldest to newest):', recent.join('\n'),
    '', 'INCOMING MESSAGE:', `"${body}"`,
  ].join('\n');
}

// A fact value that just restates its key with a liking-verb ("likes jewelry"
// under key jewelry) carries zero information — the 1a bug.
function isTautological(f) {
  const key = String(f.fact_key || '').toLowerCase().replace(/_/g, ' ');
  const val = String(f.fact_value || '').toLowerCase().trim();
  if (!key) return false;
  return ['likes ' + key, 'loves ' + key, 'enjoys ' + key, 'is into ' + key, 'likes', 'loves'].includes(val);
}

const RELATIONSHIP_KEY_VARIANTS = ['relationship_status', 'relationship_type', 'relationship_to_user', 'status'];

const CASES = [
  {
    name: 'vague input -> category as value, not a restated sentence',
    people: PEOPLE_BASE.concat([{ id: 'mom-1', name: "Ana's mom", aliases: [], relationship: "girlfriend's mom", is_self: false }]),
    recent: [],
    body: "ana's mom likes jewelry",
    checks: (out) => {
      const facts = out.facts || [];
      const errs = [];
      if (facts.length === 0) errs.push('no fact extracted at all');
      for (const f of facts) if (isTautological(f)) errs.push(`tautological fact: key=${f.fact_key} value="${f.fact_value}"`);
      return errs;
    },
  },
  {
    name: 'specific input -> the specifics survive into fact_value',
    people: PEOPLE_BASE.concat([{ id: 'mom-1', name: "Ana's mom", aliases: [], relationship: "girlfriend's mom", is_self: false }]),
    recent: [],
    body: "ana's mom loves gold jewelry, she mentioned wanting a necklace",
    checks: (out) => {
      const errs = [];
      const all = JSON.stringify(out.facts || []) + JSON.stringify(out.saved_items || []);
      if (!/gold/i.test(all)) errs.push('lost the "gold" detail');
      if (!/necklace/i.test(all)) errs.push('lost the "necklace" detail');
      for (const f of out.facts || []) if (isTautological(f)) errs.push(`tautological fact: "${f.fact_value}"`);
      return errs;
    },
  },
  {
    name: 'relationship correction -> canonical key + supersedes_prior',
    people: PEOPLE_BASE,
    recent: ['inbound: my girlfriend ana is so hot', 'outbound: Saved. Ana sounds like a keeper.'],
    body: 'well actually she is my EX girlfriend now',
    checks: (out) => {
      const errs = [];
      const rel = (out.facts || []).filter((f) => f.fact_key === 'relationship');
      const wrongKey = (out.facts || []).filter((f) => RELATIONSHIP_KEY_VARIANTS.includes(String(f.fact_key)));
      if (rel.length !== 1) errs.push(`expected exactly 1 fact_key "relationship", got ${rel.length}`);
      if (wrongKey.length) errs.push(`used non-canonical key(s): ${wrongKey.map((f) => f.fact_key).join(', ')}`);
      if (rel[0] && rel[0].supersedes_prior !== true) errs.push('supersedes_prior not set on the correction');
      if (rel[0] && !/ex/i.test(String(rel[0].fact_value))) errs.push(`value doesn't reflect the correction: "${rel[0].fact_value}"`);
      const p = (out.people || [])[0];
      if (p && p.resolution === 'new') errs.push('created a NEW person for the correction instead of resolving Ana');
      return errs;
    },
  },
  {
    name: 'correction of a previous vague fact -> same key, more specific value',
    people: PEOPLE_BASE.concat([{ id: 'mom-1', name: "Ana's mom", aliases: [], relationship: "girlfriend's mom", is_self: false }]),
    recent: ["inbound: ana's mom likes jewelry", 'outbound: Saved, gift ideas for her just got easier.'],
    body: "actually it's specifically vintage silver rings she collects",
    checks: (out) => {
      const errs = [];
      const all = JSON.stringify(out.facts || []) + JSON.stringify(out.saved_items || []);
      if (!/silver|vintage|ring/i.test(all)) errs.push('lost the specific detail');
      for (const f of out.facts || []) if (isTautological(f)) errs.push(`tautological fact: "${f.fact_value}"`);
      return errs;
    },
  },
];

// ── emotional-register cases (Part 3): the reply must match the weight of the
// message — no flat "Noted." on a breakup, no therapy-speak either. ──────────
const THERAPY_SPEAK = /so sorry you'?re going through|must be so hard|sending (you )?hugs|it'?s okay to feel|processing|healing journey/i;
const FLAT_OPENER = /^\s*(saved|noted|got it)\b/i;

CASES.push(
  {
    name: 'routine update -> brief warm confirmation is fine',
    people: PEOPLE_BASE,
    recent: [],
    body: "my sister carla's birthday is june 3",
    checks: (out) => {
      const errs = [];
      if (!out.reply || out.reply.length < 5) errs.push('no reply drafted');
      if (out.reply && out.reply.includes('—')) errs.push('em dash in reply');
      return errs;
    },
  },
  {
    name: 'breakup -> acknowledged, not filed',
    people: PEOPLE_BASE,
    recent: [],
    body: 'me and ana broke up last week',
    checks: (out) => {
      const errs = [];
      const r = String(out.reply || '');
      if (FLAT_OPENER.test(r)) errs.push(`flat opener on a heavy message: "${r}"`);
      if (THERAPY_SPEAK.test(r)) errs.push(`therapy-speak: "${r}"`);
      if (r.includes('—')) errs.push('em dash in reply');
      // and the data side of the same message: relationship must supersede
      const rel = (out.facts || []).filter((f) => memoryKey(f.fact_key) === 'relationship');
      if (rel.length && rel[0].supersedes_prior !== true) errs.push('breakup did not supersede relationship');
      return errs;
    },
  },
  {
    name: 'death in the family -> registers the person, stays understated',
    people: PEOPLE_BASE,
    recent: [],
    body: 'my grandpa passed away on sunday',
    checks: (out) => {
      const errs = [];
      const r = String(out.reply || '');
      if (FLAT_OPENER.test(r)) errs.push(`flat opener: "${r}"`);
      if (THERAPY_SPEAK.test(r)) errs.push(`therapy-speak: "${r}"`);
      if (r.includes('—')) errs.push('em dash in reply');
      return errs;
    },
  },
  {
    name: "friend's bad news -> acknowledgment + gentle nudge toward the friend",
    people: PEOPLE_BASE.concat([{ id: 'mike-1', name: 'Mike', aliases: [], relationship: 'best friend', is_self: false }]),
    recent: [],
    body: "mike's dad just got diagnosed with cancer",
    checks: (out) => {
      const errs = [];
      const r = String(out.reply || '');
      if (FLAT_OPENER.test(r)) errs.push(`flat opener: "${r}"`);
      if (THERAPY_SPEAK.test(r)) errs.push(`therapy-speak: "${r}"`);
      if (!/mike/i.test(r)) errs.push('reply never mentions Mike');
      return errs;
    },
  },
);

// mirror of memory.js canonicalFactKey, enough for assertions here
function memoryKey(k) {
  const key = String(k || '').trim().toLowerCase().replace(/\s+/g, '_');
  return { relationship_status: 'relationship', relationship_type: 'relationship', relationship_to_user: 'relationship' }[key] || key;
}

let failed = 0;
for (const c of CASES) {
  const res = await openai.chat.completions.create({
    model: MODEL, temperature: 0.3, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: ctx(c.people, c.recent, c.body) },
    ],
  });
  let out;
  try { out = JSON.parse(res.choices[0].message.content); }
  catch { console.log(`FAIL  ${c.name}: model returned non-JSON`); failed++; continue; }
  const errs = c.checks(out);
  if (errs.length === 0) {
    console.log(`PASS  ${c.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}`);
    for (const e of errs) console.log(`      - ${e}`);
    console.log('      facts: ' + JSON.stringify(out.facts));
  }
}
console.log(failed === 0 ? '\nALL PROMPT CASES PASSED' : `\n${failed} CASE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
