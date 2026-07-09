import { supabase } from '../lib/supabase.js';

// Used by the weekly-brief job. is_pro_locked lets a free user SEE locked items.
export async function createBrief({ userId, weekOf, summary = null }) {
  const { data, error } = await supabase.from('briefs')
    .upsert({ user_id: userId, week_of: weekOf, summary }, { onConflict: 'user_id,week_of,brief_type' })
    .select('id').single();
  if (error) throw error;
  return data;
}

// On a retry after a failed send (H3), wipe the previous attempt's items first.
export async function clearBriefItems(briefId) {
  await supabase.from('brief_items').delete().eq('brief_id', briefId);
}

export async function addBriefItem({ briefId, userId, personId = null, itemType, body, isProLocked = false, priority = 50 }) {
  await supabase.from('brief_items').insert({
    brief_id: briefId, user_id: userId, person_id: personId,
    item_type: itemType, body, is_pro_locked: isProLocked, priority,
  });
}

export async function hasBriefForWeek(userId, weekOf, briefType = 'weekly') {
  // Fix H3: only a brief that actually WENT OUT counts. If compose/send failed
  // last hour, the row sits at 'generated' and the next hourly tick retries.
  const { data } = await supabase.from('briefs')
    .select('id, status').eq('user_id', userId).eq('week_of', weekOf).eq('brief_type', briefType).maybeSingle();
  return !!data && ['sent', 'responded'].includes(data.status);
}

export async function markSent({ briefId, summary }) {
  await supabase.from('briefs')
    .update({ status: 'sent', summary, sent_at: new Date().toISOString() })
    .eq('id', briefId);
}
