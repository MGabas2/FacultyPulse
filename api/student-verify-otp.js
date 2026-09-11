// ============================================================
//  FacultyPulse — Verify Student Login Code (OTP)
//  Vercel serverless function (CommonJS)
//
//  Confirms the code the student typed, then hands back a real
//  Supabase Auth session (access + refresh token) for the browser to
//  adopt via supabase.auth.setSession(). Also issues a device-trust
//  token stored in trusted_devices — so this device skips the OTP step
//  on future logins for 30 days, and only password is required. This
//  is what keeps email volume from being "send a code every login."
// ============================================================

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;
const DEVICE_TRUST_DAYS = 30;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment."
    });
  }

  const { studentId, code } = req.body || {};
  if (!studentId || !STUDENT_ID_FORMAT.test(studentId)) {
    return res.status(400).json({ error: "Invalid Student ID format." });
  }
  if (!code || !/^\d{6}$/.test(String(code).trim())) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }

  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: student, error: lookupError } = await adminClient
    .from("users")
    .select("id, email, name, section_id")
    .eq("student_id", studentId)
    .eq("role", "student")
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({ error: "Lookup failed: " + lookupError.message });
  }
  if (!student || !student.email) {
    return res.status(404).json({ error: "Student ID not found or has no email on file." });
  }

  const { data, error: verifyError } = await adminClient.auth.verifyOtp({
    email: student.email,
    token: String(code).trim(),
    type: "email",
  });

  if (verifyError || !data?.session) {
    return res.status(401).json({ error: verifyError?.message || "Incorrect or expired code." });
  }

  // Record the actual login time, same as the old password-based flow did.
  await adminClient.from("users").update({ last_login: new Date().toISOString() }).eq("id", student.id);

  // Issue a device-trust token so this device skips OTP next time.
  const deviceToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error: deviceError } = await adminClient.from("trusted_devices").insert({
    student_id: student.id,
    device_token: deviceToken,
    expires_at: expiresAt,
  });

  if (deviceError) {
    // Non-fatal — student still logs in fine, they'll just get an OTP
    // prompt again next time instead of being remembered. Worth knowing
    // about, but not worth failing the whole login over.
    console.error("Failed to store trusted device:", deviceError.message);
  }

  return res.status(200).json({
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
    student: {
      id: student.id,
      name: student.name,
      section_id: student.section_id,
      student_id: studentId,
    },
    deviceToken: deviceError ? null : deviceToken,
  });
};