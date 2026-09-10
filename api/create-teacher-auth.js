// ============================================================
//  FacultyPulse — Create Teacher/Staff Auth Account
//  Vercel serverless function (CommonJS, matches api/summarize.js)
//
//  Runs ONLY server-side. SUPABASE_SERVICE_ROLE_KEY must be set as a
//  Vercel environment variable and must NEVER appear in any file that
//  ships to the browser (js/supabase.js, admin.js, etc.) — that key
//  bypasses every RLS policy on the database. Treat it like a root
//  password, not an API key.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
// This is the same publishable/anon key already hardcoded in js/supabase.js
// — it's meant to be public, that's fine. Only the service_role key below
// (from process.env) is the secret half of this.
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters (Supabase Auth minimum)" });
  }

  // ── Step 0: fail loudly if the server isn't even configured right ──
  // Without this, a missing env var surfaces as Supabase's own generic
  // "This endpoint requires a valid Bearer token" error, which looks like
  // an auth problem on the CALLER's end and sends you chasing the wrong bug.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy."
    });
  }

  // ── Step 1: verify the caller is actually logged in ──
  const authHeader  = req.headers.authorization || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: callerAuth, error: callerAuthError } = await anonClient.auth.getUser(callerToken);
  if (callerAuthError || !callerAuth?.user) {
    return res.status(401).json({ error: "Invalid or expired session — please log in again" });
  }

  // ── Step 2: verify the caller is actually an admin ──
  // This uses the service_role client for the lookup since RLS on the
  // users table may not permit an arbitrary caller to read arbitrary rows.
  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: callerRow, error: callerRowError } = await adminClient
    .from("users")
    .select("role")
    .eq("email", callerAuth.user.email)
    .maybeSingle();

  if (callerRowError) {
    return res.status(500).json({ error: "Could not verify caller role: " + callerRowError.message });
  }
  if (callerRow?.role !== "admin") {
    return res.status(403).json({ error: "Only admins can create login accounts" });
  }

  // ── Step 3: actually create the Auth account ──
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the confirmation-email step — admin is vouching for this account
    user_metadata: name ? { name } : undefined,
  });

  if (error) {
    // Common case: email already has an Auth account from a previous manual add
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ id: data.user.id, email: data.user.email });
};