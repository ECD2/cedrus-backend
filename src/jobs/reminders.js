import { supabase } from '../lib/supabase.js';
import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as messages from '../services/messages.js';

// MISSING PIECE (found in testing): reminders were being saved to the
// `reminders` table by 07_persist.js, but nothing ever checked the table and
// actually sent them at trigger_at. This job is that missing piece.
// Cron entry (every 5 min, see scheduler.js): send any reminder whose time
// has arrived, then mark it sent so it's never sent twice.
export async function runReminderDispatch(now = new Date()) {
  const { data: due, error } = await supabase.from('reminders')
    .select('id, user_id, person_id, title, note, reminder_type')
    .eq('status', 'pending')
    .lte('trigger_at', now.toISOString())
    .limit(50);
  if (error) { logger.error('reminderDispatch: query failed', error); return; }
  if (!due || !due.length) { logger.info('reminderDispatch: none due this tick'); return; }

  logger.info(`reminderDispatch: ${due.length} due`);
  for (const r of due) {
    try { await sendOne(r); }
    catch (err) { logger.error(`reminderDispatch failed for reminder ${r.id}`, err); }
  }
}

async function sendOne(reminder) {
  const { data: user } = await supabase.from('app_users')
    .select('id, phone, opted_out').eq('id', reminder.user_id).maybeSingle();

  // A reminder for an opted-out (or deleted) user just gets marked canceled,
  // never sent — respecting an opt-out always wins over a pending reminder.
  if (!user || user.opted_out) {
    await supabase.from('reminders').update({ status: 'canceled' }).eq('id', reminder.id);
    return;
  }

  const text = `Reminder: ${reminder.title}${reminder.note ? ' - ' + reminder.note : ''}`;

  let providerId = null;
  if (config.briefDryRun) {
    logger.info(`reminderDispatch DRY RUN → ${user.phone}: ${text}`);
  } else {
    const sent = await sendSms(user.phone, text);
    providerId = sent?.sid || null;
  }

  const msg = await messages.logOutbound({
    userId: user.id, body: text, messageType: 'reminder', providerMessageId: providerId,
  });

  await supabase.from('reminders')
    .update({ status: 'sent', sent_message_id: msg.id })
    .eq('id', reminder.id);
}
