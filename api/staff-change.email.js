// ============================================================
//  FacultyPulse — Faculty / Supervisor / Management: change own login email
//  Vercel serverless function (CommonJS, same style as admin-change-email.js)
//
//  A staff account's access depends on TWO things matching: the Supabase Auth
//  email and users.email (RLS compares them). Changing only one locks the
//  person out. This function changes both, and puts the first one back if
//  the second fails.
//
//  Rules:
//   - caller must be logged in as an ACTIVE teacher / supervisor / executive,
//     and can only change THEIR OWN email (taken from their session, never
//     from the request body)
//   - the current password must be re-entered (a stolen open session is not enough)
//   - the new email must not already belong to any account
//  (Admins use /api/admin-change-email.)  Needs SUPABASE_SERVICE_ROLE_KEY.
// ============================================================
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ["teacher", "supervisor", "executive"];
const esc = (v) => v.replace(/[\\%_]/g, "\\$&");   // ilike wildcards -> literal

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "The server is not configured for this action." });
  }

  const newEmail = String((req.body || {}).newEmail || "").trim().toLowerCase();
  const password = String((req.body || {}).currentPassword || "");
  if (!newEmail || newEmail.length > 254 || !EMAIL_RE.test(newEmail)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!password) return res.status(400).json({ error: "Enter your current password." });

  // 1) caller must be logged in
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await anon.auth.getUser(token);
  if (whoErr || !who?.user) return res.status(401).json({ error: "Session expired — please log in again." });
  const authUser = who.user;
  const oldEmail = String(authUser.email || "").toLowerCase();
  if (!oldEmail) return res.status(401).json({ error: "Session expired — please log in again." });

  // 2) caller must be an active faculty / supervisor / management account
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row, error: rowErr } = await admin
    .from("users").select("id, role, is_active").ilike("email", esc(oldEmail)).maybeSingle();
  if (rowErr) return res.status(500).json({ error: "Could not verify your account." });
  if (!row || row.is_active === false || !ALLOWED_ROLES.includes(row.role)) {
    return res.status(403).json({ error: "This account cannot change its email here." });
  }

  if (newEmail === oldEmail) return res.status(400).json({ error: "That is already your email." });

  // 3) re-check the current password (separate throwaway client — does not touch the caller's session)
  const pwClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pwErr } = await pwClient.auth.signInWithPassword({ email: oldEmail, password });
  if (pwErr) return res.status(403).json({ error: "Current password is incorrect." });

  // 4) the new address must be free in the users table (Auth enforces its own uniqueness below)
  const { data: taken } = await admin.from("users").select("id").ilike("email", esc(newEmail)).limit(1);
  if (taken && taken.length) return res.status(409).json({ error: "That email already belongs to another account." });

  // 5) change Auth first, then users.email; undo Auth if the second step fails
  const { error: e1 } = await admin.auth.admin.updateUserById(authUser.id, { email: newEmail, email_confirm: true });
  if (e1) return res.status(400).json({ error: /already|registered|exists/i.test(e1.message) ? "That email is already registered to another login." : "Could not change the login email." });

  const { error: e2 } = await admin.from("users").update({ email: newEmail }).eq("id", row.id);
  if (e2) {
    const { error: undo } = await admin.auth.admin.updateUserById(authUser.id, { email: oldEmail, email_confirm: true });
    return res.status(500).json({
      error: undo
        ? "Could not save the new email AND could not undo. Contact the QA office; do not retry."
        : "Could not save the new email — nothing was changed."
    });
  }

  return res.status(200).json({ ok: true, email: newEmail });
};