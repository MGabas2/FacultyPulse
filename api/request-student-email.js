// ============================================================
//  FacultyPulse — Request Student Email (public endpoint)
//  Vercel serverless function (CommonJS)
//
//  Deliberately unauthenticated — a student with no email on file
//  can't log in yet, so there's no session to require. That's exactly
//  why this needs real server-side checks instead of a client-side
//  insert: without them, anyone who knows (or guesses) a valid
//  Student ID could submit their OWN email as that student's email,
//  which — once approved — would let them log in AS that student via
//  the OTP flow. The approval step in admin's Email Requests panel is
//  the actual safeguard; this function's job is just to make sure
//  only sane, non-spammy requests reach that queue.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment."
    });
  }

  const { studentId, requestedEmail, reason } = req.body || {};

  if (!studentId || !STUDENT_ID_FORMAT.test(studentId)) {
    return res.status(400).json({ error: "Invalid Student ID format." });
  }
  if (!requestedEmail || !EMAIL_FORMAT.test(requestedEmail)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({ error: "Please explain why (at least 10 characters) — this helps admin review your request." });
  }

  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ── Look up the student ──
  const { data: student, error: studentError } = await adminClient
    .from("users")
    .select("id, email")
    .eq("student_id", studentId)
    .eq("role", "student")
    .maybeSingle();

  if (studentError) {
    return res.status(500).json({ error: "Lookup failed: " + studentError.message });
  }
  if (!student) {
    // Generic message on purpose — doesn't confirm/deny whether an ID
    // exists beyond what's already implied by it being a valid format.
    return res.status(404).json({ error: "Student ID not found. Check with your admin." });
  }

  // ── This student already has an email — this is now an OVERRIDE ──
  // request (e.g. "I can't access it anymore"), not a first-time setup.
  // We don't block this outright: someone locked out of a dead email has
  // no other self-service path, and blocking them here just pushes them
  // to walk into an office instead. Instead, this gets flagged distinctly
  // in the admin queue so whoever approves it knows to actually verify
  // identity (in person, with the student's adviser, etc.) rather than
  // treating it like an ordinary first-time request.
  const isOverride = !!student.email;

  // ── Refuse if there's already a pending request for this student ──
  const { data: existingRequest, error: existingError } = await adminClient
    .from("email_change_requests")
    .select("id")
    .eq("student_id", student.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existingError) {
    return res.status(500).json({ error: "Could not check existing requests: " + existingError.message });
  }
  if (existingRequest) {
    return res.status(400).json({
      error: "A request is already pending for this Student ID. Please wait for admin review."
    });
  }

  // ── Queue it for admin approval ──
  const finalReason = isOverride
    ? `[EMAIL OVERRIDE — student claims existing email is inaccessible] ${reason.trim()}`
    : reason.trim();

  const { error: insertError } = await adminClient.from("email_change_requests").insert({
    student_id: student.id,
    current_email: student.email || null,
    requested_email: requestedEmail,
    reason: finalReason,
    status: "pending",
  });

  if (insertError) {
    return res.status(500).json({ error: "Failed to submit request: " + insertError.message });
  }

  return res.status(200).json({ ok: true, isOverride });
};