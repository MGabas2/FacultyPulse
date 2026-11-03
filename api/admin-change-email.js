// ============================================================
//  FacultyPulse — Admin: change own login email
//  Vercel serverless function (CommonJS, same style as create-teacher-auth.js)
//
//  Why server-side: an admin's access depends on TWO things matching —
//  the Supabase Auth email and users.email (is_admin() compares them).
//  Changing only one locks the admin out of everything. This function
//  changes both, and puts the first one back if the second fails.
//
//  Rules:
//   - caller must be a logged-in ADMIN, and can only change THEIR OWN email
//   - the current password must be re-entered (a stolen open session is not enough)
//   - the new email must not already belong to any account
//  Needs SUPABASE_SERVICE_ROLE_KEY (already set for create-teacher-auth).
// ============================================================
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg"; // public key, same as js/supabase.js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (v) => v.replace(/[\\%_]/g, "\\$&");   // ilike wildcards -> literal

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." });
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

  // 2) caller must be an admin
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row, error: rowErr } = await admin
    .from("users").select("id, role, is_active").ilike("email", esc(oldEmail)).eq("role", "admin").maybeSingle();
  if (rowErr) return res.status(500).json({ error: "Could not verify your account." });
  if (!row || row.is_active === false) return res.status(403).json({ error: "Only an active admin can change this." });

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
  if (e1) return res.status(400).json({ error: /already|registered|exists/i.test(e1.message) ? "That email is already registered to another login." : "Could not change the login email: " + e1.message });

  const { error: e2 } = await admin.from("users").update({ email: newEmail }).eq("id", row.id);
  if (e2) {
    const { error: undo } = await admin.auth.admin.updateUserById(authUser.id, { email: oldEmail, email_confirm: true });
    return res.status(500).json({
      error: "Could not save the new email" + (undo ? " AND could not undo — log in with " + newEmail + " and contact support." : " — nothing was changed.")
    });
  }

  return res.status(200).json({ ok: true, email: newEmail });
};
