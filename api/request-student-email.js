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

  // ── Refuse if they already have an email ──
  // This endpoint ONLY handles "no email at all." An existing email —
  // changing it, or recovering access to a dead one — must go through
  // an authenticated path (the in-dashboard change-email request, or
  // direct admin contact if they can't log in at all). This is a public,
  // unauthenticated page: anyone who knows a Student ID could otherwise
  // submit a request to hijack that student's email. Human review on a
  // pending queue is a decent safeguard when reviewed carefully, but
  // it's not a safeguard against a busy admin approving a backlog
  // without double-checking each one — so this boundary stays hard.
  if (student.email) {
    return res.status(400).json({
      error: "This student already has an email on file. If you can't log in to change it yourself, contact your admin directly."
    });
  }

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
  const { error: insertError } = await adminClient.from("email_change_requests").insert({
    student_id: student.id,
    current_email: null,
    requested_email: requestedEmail,
    reason: reason.trim(),
    status: "pending",
  });

  if (insertError) {
    return res.status(500).json({ error: "Failed to submit request: " + insertError.message });
  }

  return res.status(200).json({ ok: true });
};