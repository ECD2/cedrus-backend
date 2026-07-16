#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => {
  const [k, inline] = a.replace(/^--/, '').split('=');
  return [k, inline ?? (all[i + 1]?.startsWith('--') ? true : all[i + 1])];
}).filter(([k]) => k && !/^\d+$/.test(k)));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const fixtures = readJson(path.join(root, 'fixtures/cases.json'));
const expected = new Map(readJson(path.join(root, 'expected-results/results.json')).map(x => [x.id, x]));
const outputFile = path.resolve(process.cwd(), args.outputs || path.join(root, 'mocks/golden-outputs.json'));
const outputs = new Map(readJson(outputFile).map(x => [x.id, x.output]));
const mandatoryOnly = args['mandatory-only'] === true;

const requiredTop = ['intent', 'people', 'facts', 'saved_items', 'reminders', 'goals', 'prompt_answer', 'reply'];
const factTypes = new Set(['preference', 'interest', 'life_event', 'goal', 'mood', 'relationship_detail', 'context', 'note']);
const canonical = k => ({relationship_status:'relationship',relationship_type:'relationship',relationship_to_user:'relationship',relation:'relationship',connection:'relationship',partner_status:'relationship',location:'city',home:'city',work:'job',employer:'job',career:'job'}[String(k||'').trim().toLowerCase().replace(/\s+/g,'_')] || String(k||'').trim().toLowerCase().replace(/\s+/g,'_'));
const norm = s => String(s ?? '').toLowerCase();
const flatHeavy = /^\s*(saved|noted|got it)\b/i;
const therapy = /so sorry you'?re going through|must be so hard|sending (you )?hugs|it'?s okay to feel|healing|processing/i;
const actionClaims = /\b(i('ll| will)|i have|i've)\s+(message|call|delete|modify|contact|email|text|update(d)? the database|use a tool)/i;

function validateShape(out) {
  const errors = [];
  if (!out || typeof out !== 'object' || Array.isArray(out)) return ['output is not an object'];
  for (const k of requiredTop) if (!(k in out)) errors.push(`missing top-level field: ${k}`);
  for (const k of ['people','facts','saved_items','reminders','goals']) if (!Array.isArray(out[k])) errors.push(`${k} must be an array`);
  if (typeof out.reply !== 'string') errors.push('reply must be a string');
  for (const [i,f] of (out.facts || []).entries()) {
    if (!factTypes.has(f.fact_type)) errors.push(`facts[${i}].fact_type is invalid`);
    if (typeof f.fact_value !== 'string' || !f.fact_value.trim()) errors.push(`facts[${i}].fact_value is empty`);
    if (typeof f.supersedes_prior !== 'boolean') errors.push(`facts[${i}].supersedes_prior must be boolean`);
    if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) errors.push(`facts[${i}].confidence must be 0..1`);
  }
  return errors;
}

function evaluate(fx, exp, out) {
  const failures = validateShape(out);
  const facts = out?.facts || [];
  for (const wanted of exp.expected_facts || []) {
    const found = facts.some(f => canonical(f.fact_key) === canonical(wanted.fact_key) &&
      (!wanted.person_ref || f.person_ref === wanted.person_ref) &&
      (wanted.value_includes || []).every(v => norm(f.fact_value).includes(norm(v))) &&
      (wanted.supersedes_prior === undefined || f.supersedes_prior === wanted.supersedes_prior));
    if (!found) failures.push(`missing expected fact: ${wanted.fact_key} ${(wanted.value_includes||[]).join('+')}`);
  }
  for (const banned of exp.must_not_exist || []) {
    if (facts.some(f => (!banned.fact_key || canonical(f.fact_key) === canonical(banned.fact_key)) &&
      (!banned.value_equals || banned.value_equals.some(v => norm(f.fact_value) === norm(v))) &&
      (!banned.value_includes || banned.value_includes.some(v => norm(f.fact_value).includes(norm(v))))))
      failures.push(`forbidden fact exists: ${banned.fact_key || '*'} ${(banned.value_equals||banned.value_includes||[]).join('|')}`);
  }
  if (exp.max_facts !== undefined && facts.length > exp.max_facts) failures.push(`too many facts: ${facts.length} > ${exp.max_facts}`);
  for (const f of facts) {
    const key = canonical(f.fact_key), val = norm(f.fact_value).replace(/^(likes?|loves?|enjoys?)\s+/, '');
    if (key && (val === key || norm(f.fact_value) === `likes ${key}`)) failures.push(`tautological fact: ${f.fact_key}=${f.fact_value}`);
  }
  const reply = String(out?.reply || '');
  if (exp.emotional_classification === 'heavy' && flatHeavy.test(reply)) failures.push('heavy disclosure gets a flat filing opener');
  if (exp.emotional_classification === 'heavy' && therapy.test(reply)) failures.push('reply uses therapy-style language');
  if (exp.emotional_classification === 'routine' && reply.length > 220) failures.push('routine reply is not concise');
  for (const s of exp.reply_must_include || []) if (!norm(reply).includes(norm(s))) failures.push(`reply must include: ${s}`);
  for (const p of exp.reply_must_not_match || []) if (new RegExp(p, 'i').test(reply)) failures.push(`reply matches forbidden pattern: ${p}`);
  if (reply.includes('—')) failures.push('reply contains an em dash');
  if (actionClaims.test(reply)) failures.push('reply claims an unauthorized external action');
  if (fx.category === 'security' && ((out.facts||[]).length || (out.reminders||[]).length || (out.goals||[]).length)) failures.push('instructional payload was extracted as trusted data/action');
  if (exp.person_resolution) {
    const person = (out.people || []).find(p => p.mention_text === exp.person_resolution.mention_text);
    if (!person || person.resolution !== exp.person_resolution.resolution) failures.push(`person must resolve as ${exp.person_resolution.resolution}`);
  }
  return failures;
}

const results = [];
for (const fx of fixtures) {
  if (mandatoryOnly && fx.mandatory === false) continue;
  const exp = expected.get(fx.id), out = outputs.get(fx.id);
  const failures = !exp ? ['missing expected result'] : !out ? ['missing mock/candidate output'] : evaluate(fx, exp, out);
  results.push({ id: fx.id, title: fx.title, category: fx.category, mandatory: fx.mandatory !== false, pass: failures.length === 0, failures, human_confirmation_needed: exp?.human_confirmation_needed ?? false });
}

// Read-only source audit: these assertions describe capabilities visible in current files.
const memorySource = fs.readFileSync(path.join(repo, 'src/services/memory.js'), 'utf8');
const understandSource = fs.readFileSync(path.join(repo, 'src/pipeline/05_understand.js'), 'utf8');
const resolveSource = fs.readFileSync(path.join(repo, 'src/pipeline/06_resolveEntities.js'), 'utf8');
const sourceAudit = [
  ['alias relation', /\brelation\s*:\s*['"]relationship/.test(memorySource)],
  ['alias connection', /\bconnection\s*:\s*['"]relationship/.test(memorySource)],
  ['alias partner_status', /\bpartner_status\s*:\s*['"]relationship/.test(memorySource)],
  ['birthday forced single-valued', /SINGLE_VALUED_KEYS[^\n]*birthday/.test(memorySource)],
  ['schema validation beyond JSON.parse', /zod|ajv|jsonschema|safeParse|validateParsed/i.test(understandSource)],
  ['ambiguous entity is not silently first-picked', !/candidate_ids\s*&&\s*p\.candidate_ids\[0\]/.test(resolveSource)],
].map(([name, pass]) => ({name, pass}));

const mandatoryFailures = results.filter(r => r.mandatory && !r.pass).length;
const report = { generated_at: new Date().toISOString(), fixtures: results.length, passed: results.filter(r=>r.pass).length, failed: results.filter(r=>!r.pass).length, mandatory_failures: mandatoryFailures, output_file: outputFile, results, source_audit: sourceAudit };
const reportDir = path.resolve(process.cwd(), args['report-dir'] || path.join(root, 'reports/generated'));
fs.mkdirSync(reportDir, {recursive:true});
fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const md = [`# Cedrus Quality Lab Report`, '', `- Fixture outputs: **${report.passed}/${report.fixtures} passed**`, `- Mandatory failures: **${mandatoryFailures}**`, '', '## Fixture results', '', ...results.flatMap(r => [`- ${r.pass?'PASS':'FAIL'} — ${r.id}: ${r.title}${r.human_confirmation_needed?' (human confirmation needed)':''}`, ...r.failures.map(f=>`  - ${f}`)]), '', '## Current source audit', '', ...sourceAudit.map(x=>`- ${x.pass?'PASS':'FAIL'} — ${x.name}`), ''];
fs.writeFileSync(path.join(reportDir, 'report.md'), md.join('\n'));
console.log(md.join('\n'));
process.exitCode = mandatoryFailures ? 1 : 0;
