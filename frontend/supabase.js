import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hsnaqddekfddbpamajpw.supabase.co';
const supabaseAnonKey = 'sb_publishable_riTQvnl6JLG24ptTMgh8Kg_QlzdJBSK';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

