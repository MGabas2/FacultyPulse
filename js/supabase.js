// ============================================================
//  FacultyPulse — Supabase Configuration
//  Import this file in every page that needs database access
// ============================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL  = "https://doreiuquslldbsvwrwxs.supabase.co";
const SUPABASE_KEY  = "sb_publishable_dnmdgxxGQNYgleBGSoWa7Q_sMpqr1B1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
