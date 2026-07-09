import { supabase } from '../lib/supabase.js';

export async function log({ userId, eventType, source = 'sms', messageId = null, rawText = null }) {
  await supabase.from('consent_events').insert({
    user_id: userId, event_type: eventType, source, message_id: messageId, raw_text: rawText,
  });
}
