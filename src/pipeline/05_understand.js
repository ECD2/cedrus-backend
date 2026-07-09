import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from '../lib/openai.js';
import { config } from '../config.js';
import { localNow } from '../utils/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Loaded once at boot. Kept byte-stable so OpenAI prompt caching applies.
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../../prompts/extraction.system.txt'), 'utf8');

export async function understand({ user, body, context }) {
  const res = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },              // stable prefix → cached
      { role: 'user', content: buildContextBlock({ user, body, context }) }, // variable, message LAST
    ],
  });
  const parsed = JSON.parse(res.choices[0].message.content);
  // Fix H2: cap the outbound reply so a hostile or rambling generation can't
  // cost 7 SMS segments. 300 chars = 2 GSM segments max. '...' stays GSM-safe.
  if (typeof parsed.reply === 'string' && parsed.reply.length > 300) {
    parsed.reply = parsed.reply.slice(0, 297).trimEnd() + '...';
  }
  parsed._usage = res.usage;
  parsed._model = res.model;
  return parsed;
}

function buildContextBlock({ user, body, context }) {
  return [
    `CURRENT DATETIME: ${localNow(user.timezone)}   (timezone: ${user.timezone})`,
    `USER: ${user.name || 'there'}   (first-person "I/me" refers to this person)`,
    '',
    'KNOWN PEOPLE:',
    JSON.stringify(context.people || []),
    '',
    'OPEN QUESTIONS AWAITING AN ANSWER:',
    JSON.stringify(context.openPrompts || []),
    '',
    'RECENT MESSAGES (oldest to newest):',
    (context.recentMessages || []).map(m => `${m.direction}: ${m.body}`).join('\n'),
    '',
    'INCOMING MESSAGE:',
    `"${body}"`,
  ].join('\n');
}
