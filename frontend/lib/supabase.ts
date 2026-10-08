import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rglnzkvkubmdkzydosdb.supabase.co';
const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    'sb_publishable_GbcxEI4te1bUNquuzvCVLg_mBvqSHr7';

// Initialize the Supabase client
export const supabase = createClient(supabaseUrl, supabaseKey);
