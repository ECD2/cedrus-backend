import * as users from '../services/users.js';
import * as consent from '../services/consent.js';

// Twilio also handles these at the carrier level; we mirror the state so our
// own scheduled jobs never message an opted-out user. (Note: 'YES' is NOT a
// start word — it would hijack answers to Cedrus's questions.)
const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const START_WORDS = ['START', 'UNSTOP'];
const HELP_WORDS = ['HELP', 'INFO'];

export async function handleCompliance({ user, body }) {
  const word = (body || '').trim().toUpperCase();

  if (STOP_WORDS.includes(word)) {
    await users.setOptedOut(user.id, true);
    await consent.log({ userId: user.id, eventType: 'opt_out', rawText: body });
    return { handled: true, reply: null };
  }
  if (START_WORDS.includes(word)) {
    await users.setOptedOut(user.id, false);
    await consent.log({ userId: user.id, eventType: 'opt_in', rawText: body });
    return { handled: true, reply: "Welcome back - I'll keep helping you stay close to your people." };
  }
  if (HELP_WORDS.includes(word)) {
    await consent.log({ userId: user.id, eventType: 'help', rawText: body });
    return { handled: true, reply: 'Cedrus helps you remember and show up for the people you care about. Text me about someone or save a reminder. To opt out, reply STOP. For support and more info, visit cedrus.life/support. Msg and data rates may apply.' };
  }
  return { handled: false };
}
