// ============================================================
//  FacultyPulse — Send Student Login Code (OTP)
//  Vercel serverless function (CommonJS)
//
//  Students log in with just their Student ID now — no password at
//  all. This looks up their email server-side (the client never learns
//  the real address, only a masked version for display) and triggers
//  Supabase's own one-time-code email.
//
//  IMPORTANT SETUP STEP: Supabase's default OTP email contains a
//  clickable magic link, not a typed code. Since the login UI asks for
//  a 6-digit code, the "Magic Link" email template (Supabase Dashboard
//  → Authentication → Email Templates) must be edited to show
//  {{ .Token }} instead of {{ .ConfirmationURL }}. Without this change,
//  students will receive a link and have nothing to type in.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment."
    });
  }

  const { studentId } = req.body || {};
  if (!studentId || !STUDENT_ID_FORMAT.test(studentId)) {
    return res.status(400).json({ error: "Invalid Student ID format." });
  }

  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: student, error: lookupError } = await adminClient
    .from("users")
    .select("id, email, is_active")
    .eq("student_id", studentId)
    .eq("role", "student")
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({ error: "Lookup failed: " + lookupError.message });
  }
  if (!student) {
    return res.status(404).json({ error: "Student ID not found. Contact your admin." });
  }
  if (student.is_active === false) {
    return res.status(403).json({ error: "This account has been archived. Contact your admin." });
  }
  if (!student.email) {
    return res.status(400).json({
      error: "No email on file for this Student ID yet. Use the 'Request an Email' link below.",
      needsEmail: true,
    });
  }

  const { error: otpError } = await adminClient.auth.signInWithOtp({
    email: student.email,
    options: { shouldCreateUser: true },
  });

  if (otpError) {
    return res.status(500).json({ error: "Failed to send code: " + otpError.message });
  }

  return res.status(200).json({ ok: true, maskedEmail: maskEmail(student.email) });
};