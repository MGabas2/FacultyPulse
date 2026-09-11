// ============================================================
//  FacultyPulse — Invite Student to Set Their First Password
//  Vercel serverless function (CommonJS, matches create-teacher-auth.js)
//
//  Creates a real Supabase Auth account for the student (no password
//  set) and sends Supabase's invite email. The link in that email
//  redirects back to index.html, which already has a working
//  PASSWORD_RECOVERY overlay (used for staff password resets) — the
//  student lands there, sets their password, and is redirected to log
//  in normally from then on via Student ID + password + OTP.
//
//  Earlier version of this file pointed at a separate set-password.html
//  page that duplicated this same overlay and was later deleted —
//  this version reuses the existing one instead.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy."
    });
  }

  const { id, email, name } = req.body || {};
  if (!id || !email) {
    return res.status(400).json({ error: "id and email are required" });
  }

  // ── Verify the caller is a logged-in admin ──
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
    return res.status(403).json({ error: "Only admins can send invites" });
  }

  // ── Send the invite ──
  // Points at index.html's existing password-recovery overlay — the
  // same one staff password resets already use — instead of a separate
  // page. Student tab is the default landing tab, so no ?tab= needed.
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const redirectTo = `${origin}/index.html`;

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: name ? { name } : undefined,
  });

  if (error) {
    // Common case: this email already has an Auth account (already
    // invited earlier, or created some other way).
    return res.status(400).json({ error: error.message });
  }

  // Best-effort tracking — if this write fails, the invite still went out.
  await adminClient.from("users").update({ auth_invited_at: new Date().toISOString() }).eq("id", id);

  return res.status(200).json({ id: data.user.id, email: data.user.email });
};