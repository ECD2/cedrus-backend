import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from '../../lib/openai.js';
import { config } from '../../config.js';
import { localNow } from '../../utils/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIEF_PROMPT = fs.readFileSync(path.join(__dirname, '../../../prompts/brief.system.txt'), 'utf8');

// Turn the structured plan into warm SMS prose. Higher temperature than extraction
// because this is voice, not parsing. Returns text + usage for cost logging.
export async function composeBrief(plan, user) {
  const res = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.6,
    messages: [
      { role: 'system', content: BRIEF_PROMPT },
      { role: 'user', content: JSON.stringify({ ...plan, today: localNow(user.timezone) }) },
    ],
  });
  return {
    text: (res.choices[0].message.content || '').trim(),
    model: res.model,
    usage: res.usage,
  };
}
