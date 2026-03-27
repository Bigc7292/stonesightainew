import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ujnxancjpobenyryxtlz.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_r6V0uAYvgE_1mpud4XTAag_WEFVouiZ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
