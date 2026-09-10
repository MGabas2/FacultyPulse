// ============================================================
//  FacultyPulse — Invite Student to Set Their Own Password
//  Vercel serverless function (CommonJS, matches create-teacher-auth.js)
//
//  Fixes a QA-reported issue: student passwords were derived from
//  their own Student ID (a predictable formula), letting any student
//  who worked out or knew the pattern log in as anyone else. This
//  creates a real Supabase Auth account for the student with NO
//  password set, and sends Supabase's own "invite" email containing a
//  link for the student to choose one themselves. Runs server-side
//  only — see create-teacher-auth.js for why the service_role key can
//  never touch the browser.
//
//  This does NOT change how students currently log in. It only creates
//  the Auth account and sends the email. Safe to run alongside the
//  existing derived-password login while the rest of the migration
//  (set-password.html, student.js rewire) is still being built.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
// Public/publishable key — safe to hardcode, matches js/supabase.js.
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
  // Where Supabase's email link sends the student to set their password.
  // Falls back to the request's own host if no explicit origin header —
  // works whether this is called from your production domain or a
  // preview deployment.
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const redirectTo = `${origin}/set-password.html`;

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: name ? { name } : undefined,
  });

  if (error) {
    // Common case: this email already has an Auth account (already
    // invited earlier, or created some other way) — surfaced as a normal
    // error so the caller can decide whether that's actually a problem.
    return res.status(400).json({ error: error.message });
  }

  // Record that this student was invited, so the admin UI can track who's
  // left to invite. Best-effort: if this write fails, the invite still
  // went out — we don't want to report a false failure over it.
  await adminClient.from("users").update({ auth_invited_at: new Date().toISOString() }).eq("id", id);

  return res.status(200).json({ id: data.user.id, email: data.user.email });
};