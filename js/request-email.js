// ============================================================
//  FacultyPulse — Request an Email
//  For students with no email on file at all — a separate, public
//  entry point into the existing email_change_requests approval
//  queue (same table/panel QA already uses for change requests).
//
//  This does NOT touch the database directly from the browser — the
//  actual insert happens server-side (api/request-student-email.js),
//  because this page is unauthenticated by design (a student with no
//  email can't log in yet, that's the whole problem) and the request
//  needs a few checks nothing client-side can safely enforce.
// ============================================================

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

const form         = document.getElementById("request-form");
const idInput      = document.getElementById("student-id");
const emailInput   = document.getElementById("requested-email");
const reasonInput  = document.getElementById("reason");
const statusEl     = document.getElementById("request-status");
const submitBtn    = document.getElementById("submit-btn");

idInput.addEventListener("input", () => {
  const cursor = idInput.selectionStart;
  idInput.value = idInput.value.toUpperCase();
  idInput.setSelectionRange(cursor, cursor);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.style.color = "";

  const isLocalDev = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  if (isLocalDev) {
    statusEl.textContent = "This only works on the deployed site — the request function doesn't run under local Live Server.";
    statusEl.style.color = "#d97706";
    return;
  }

  const studentId = idInput.value.trim();
  const email     = emailInput.value.trim();
  const reason    = reasonInput.value.trim();

  if (!STUDENT_ID_FORMAT.test(studentId)) {
    statusEl.textContent = "Student ID format must be like 2023-1154-AB.";
    statusEl.style.color = "#dc2626";
    return;
  }
  if (!email) {
    statusEl.textContent = "Enter the email you'd like to use.";
    statusEl.style.color = "#dc2626";
    return;
  }
  if (!reason || reason.length < 10) {
    statusEl.textContent = "Please explain why (at least 10 characters) — this helps admin review your request.";
    statusEl.style.color = "#dc2626";
    return;
  }

  submitBtn.textContent = "Submitting…";
  submitBtn.disabled = true;

  try {
    const resp = await fetch("/api/request-student-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, requestedEmail: email, reason }),
    });

    let result = {};
    try {
      result = await resp.json();
    } catch {
      result = { error: `Server returned ${resp.status} with no readable response` };
    }

    if (!resp.ok) {
      statusEl.textContent = result.error || "Something went wrong. Please try again.";
      statusEl.style.color = "#dc2626";
      submitBtn.textContent = "Submit Request";
      submitBtn.disabled = false;
      return;
    }

    form.classList.add("hidden");
    statusEl.style.color = "#166534";
    statusEl.textContent = "Request submitted. An admin will review it — check back with your admin once it's approved.";
  } catch (err) {
    statusEl.textContent = "Couldn't reach the server: " + err.message;
    statusEl.style.color = "#dc2626";
    submitBtn.textContent = "Submit Request";
    submitBtn.disabled = false;
  }
});