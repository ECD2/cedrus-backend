import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from '../../lib/openai.js';
import { config } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NUDGE_PROMPT = fs.readFileSync(path.join(__dirname, '../../../prompts/nudge.system.txt'), 'utf8');

export async function composeNudge(nudge, user) {
  const res = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.6,
    messages: [
      { role: 'system', content: NUDGE_PROMPT },
      { role: 'user', content: JSON.stringify({ userName: user.name || null, ...nudge }) },
    ],
  });
  return { text: (res.choices[0].message.content || '').trim(), model: res.model, usage: res.usage };
}
