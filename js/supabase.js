// ============================================================
//  FacultyPulse — Supabase Configuration
//  Import this file in every page that needs database access
// ============================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL  = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_KEY  = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
