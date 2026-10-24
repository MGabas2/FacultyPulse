// ============================================================
//  FacultyPulse — Supabase Configuration
//  Import this file in every page that needs database access.
//  The client is bundled from npm by Vite (no runtime CDN request).
//  The URL and publishable (anon) key are safe to ship to the browser —
//  access is enforced by Row Level Security, not by hiding this key.
//  Optionally override per environment with VITE_SUPABASE_URL /
//  VITE_SUPABASE_KEY (e.g. a separate test project for Preview deploys).
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
