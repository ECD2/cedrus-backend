import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Service-role client: server-side only, bypasses RLS. NEVER expose this key.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
