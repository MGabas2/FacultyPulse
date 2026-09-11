// ============================================================
//  FacultyPulse — Student Password Login (with 2FA device check)
//  Vercel serverless function (CommonJS)
//
//  Students log in with Student ID + a real password now (not the old
//  guessable middle-4-digits formula). If the device presents a valid,
//  unexpired token from trusted_devices, login completes immediately.
//  Otherwise, the password is still verified here, but the real session
//  is deliberately withheld — an email code (student-verify-otp.js)
//  becomes the second factor required before login actually completes.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";
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

  const { studentId, password, deviceToken } = req.body || {};
  if (!studentId || !STUDENT_ID_FORMAT.test(studentId)) {
    return res.status(400).json({ error: "Invalid Student ID format." });
  }
  if (!password) {
    return res.status(400).json({ error: "Enter your password." });
  }

  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── Look up the student ──
  const { data: student, error: lookupError } = await adminClient
    .from("users")
    .select("id, email, name, section_id, is_active")
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

  // ── Verify the password ──
  // A plain anon-key client is correct here — signInWithPassword
  // authenticates AS the student, it isn't an admin-privileged action.
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: student.email,
    password,
  });

  if (authError || !authData?.session) {
    return res.status(401).json({ error: "Incorrect Student ID or password." });
  }

  // ── Check device trust ──
  let trusted = false;
  if (deviceToken) {
    const { data: deviceRow } = await adminClient
      .from("trusted_devices")
      .select("id, expires_at")
      .eq("device_token", deviceToken)
      .eq("student_id", student.id)
      .maybeSingle();

    trusted = !!deviceRow && new Date(deviceRow.expires_at) > new Date();
  }

  if (trusted) {
    // Password correct + recognized device — log in immediately, no OTP.
    await adminClient.from("users").update({ last_login: new Date().toISOString() }).eq("id", student.id);

    return res.status(200).json({
      ok: true,
      needsOtp: false,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
      student: {
        id: student.id,
        name: student.name,
        section_id: student.section_id,
        student_id: studentId,
      },
    });
  }

  // Password correct, but this device isn't recognized — require the
  // second factor. The session we already have from signInWithPassword
  // above is intentionally discarded here; a fresh one is issued only
  // after the OTP is verified (student-verify-otp.js).
  const { error: otpError } = await adminClient.auth.signInWithOtp({
    email: student.email,
    options: { shouldCreateUser: false }, // account must already exist by this point
  });

  if (otpError) {
    return res.status(500).json({ error: "Password correct, but failed to send verification code: " + otpError.message });
  }

  return res.status(200).json({ ok: true, needsOtp: true, maskedEmail: maskEmail(student.email) });
};