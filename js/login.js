// ============================================================
//  FacultyPulse — Student Login (index.html)
//  Student ID + password (RPC-verified, hashed server-side)
//    -> email OTP as second factor (skipped if no email on file)
//  Faculty / Supervisor / Admin / Management sign in on staff.html
//  (see js/staff-login.js) — this file is students only.
// ============================================================

import { supabase } from "./supabase.js";

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const errorMsg      = document.getElementById("error-msg");
const formatError   = document.getElementById("format-error");

// ── Finalize a successful student login (shared by the password+OTP path
//    and the no-email path) ──
function finalizeStudentLogin(userRow, studentId) {
  sessionStorage.setItem("role",      "student");
  sessionStorage.setItem("studentId", studentId);
  sessionStorage.setItem("userId",    userRow.id);
  sessionStorage.setItem("sectionId", userRow.section_id);
  sessionStorage.setItem("name",      userRow.name || studentId);
  sessionStorage.setItem("email",     userRow.email || "");
  // Still on the default password? student.js then makes them choose a new one.
  sessionStorage.setItem("mustChange", userRow.must_change_password ? "1" : "0");

  // Database function instead of a direct table update (users is locked down).
  supabase
    .rpc("record_student_login", { p_user_id: userRow.id })
    .then(() => {});

  window.location.href = "pages/student.html";
}

usernameInput.addEventListener("input", () => {
  const cursor = usernameInput.selectionStart;
  usernameInput.value = usernameInput.value.toUpperCase();
  usernameInput.setSelectionRange(cursor, cursor);
  if (usernameInput.value.length === 13) {
    STUDENT_ID_FORMAT.test(usernameInput.value)
      ? formatError.classList.add("hidden")
      : formatError.classList.remove("hidden");
  } else {
    formatError.classList.add("hidden");
  }
});

// ══════════════════════════════════════════════════════════════
//  OTP SEND COOLDOWN
//  Client-side throttle only — see note in login() / requestOtpThrottled.
//  Persisted in localStorage (per email) so a page reload can't reset it.
// ══════════════════════════════════════════════════════════════
const OTP_COOLDOWN_MS    = 5 * 60 * 1000; // 5 minutes
const OTP_COOLDOWN_PREFIX = "fp_otp_last_sent:";

function otpCooldownKey(email) {
  return OTP_COOLDOWN_PREFIX + String(email).trim().toLowerCase();
}

function otpCooldownRemainingMs(email) {
  if (!email) return 0;
  const last = Number(localStorage.getItem(otpCooldownKey(email)) || 0);
  const remaining = OTP_COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

function markOtpSent(email) {
  if (!email) return;
  localStorage.setItem(otpCooldownKey(email), String(Date.now()));
}

function formatMMSS(ms) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

let otpCooldownInterval = null;

// Disables + labels whichever "resend" button is passed (OTP step or
// forgot-password step share this same cooldown state per email).
function startOtpCooldownCountdown(email, btn) {
  clearInterval(otpCooldownInterval);
  if (!btn) return;

  function tick() {
    const remaining = otpCooldownRemainingMs(email);
    if (remaining <= 0) {
      btn.disabled    = false;
      btn.textContent = btn.dataset.idleLabel || "Resend code";
      clearInterval(otpCooldownInterval);
      return;
    }
    btn.disabled    = true;
    btn.textContent = `Resend in ${formatMMSS(remaining)}`;
  }

  if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
  tick();
  otpCooldownInterval = setInterval(tick, 1000);
}

// Wraps the raw requestOtp() call with the cooldown check. Returns
// { throttled: true, remainingMs } if a send is blocked client-side,
// or { throttled: false, error } after actually attempting the send.
//
// IMPORTANT: this only stops someone using THIS form. It does nothing
// against a script calling supabase.auth.signInWithOtp directly against
// the Supabase REST endpoint — that requires Supabase's own project-level
// Auth rate limits (Dashboard → Authentication → Rate Limits), which is
// the real backstop for the email quota.
async function requestOtpThrottled(email) {
  const remaining = otpCooldownRemainingMs(email);
  if (remaining > 0) {
    return { throttled: true, remainingMs: remaining };
  }
  const error = await requestOtp(email);
  if (!error) markOtpSent(email);
  return { throttled: false, error };
}

// ══════════════════════════════════════════════════════════════
//  OTP STEP
// ══════════════════════════════════════════════════════════════
let pendingStudentRow = null;

function showOtpStep(email) {
  document.getElementById("normal-login-ui")?.classList.add("hidden");
  document.getElementById("otp-step")?.classList.remove("hidden");
  const target = document.getElementById("otp-target-email");
  if (target) target.textContent = maskEmail(email);
}

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 3))}@${domain}`;
}

async function requestOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return error;
}

async function verifyOtpAndLogin(code) {
  const email = pendingStudentRow?.email;
  if (!email || !pendingStudentRow) return "Session expired — please log in again.";

  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) return "Incorrect or expired code.";

  finalizeStudentLogin(pendingStudentRow, pendingStudentRow.student_id);
  return null;
}

document.getElementById("otp-verify-btn")?.addEventListener("click", async () => {
  const btn  = document.getElementById("otp-verify-btn");
  const code = document.getElementById("otp-code-input")?.value.trim();
  const otpError = document.getElementById("otp-error");

  if (!code) { if (otpError) otpError.textContent = "Enter the code from your email."; return; }

  btn.textContent = "Verifying..."; btn.disabled = true;
  const err = await verifyOtpAndLogin(code);
  btn.textContent = "Verify"; btn.disabled = false;

  if (err && otpError) otpError.textContent = err;
});

document.getElementById("otp-resend-btn")?.addEventListener("click", async () => {
  if (!pendingStudentRow?.email) return;
  const btn = document.getElementById("otp-resend-btn");
  const otpError = document.getElementById("otp-error");

  // Guard in case the button wasn't disabled in time (e.g. stale UI state).
  if (otpCooldownRemainingMs(pendingStudentRow.email) > 0) {
    startOtpCooldownCountdown(pendingStudentRow.email, btn);
    return;
  }

  btn.textContent = "Sending..."; btn.disabled = true;
  const result = await requestOtpThrottled(pendingStudentRow.email);
  if (result.error && otpError) {
    otpError.textContent = "Couldn't resend code: " + result.error.message;
  }
  startOtpCooldownCountdown(pendingStudentRow.email, btn);
});

document.getElementById("otp-back-link")?.addEventListener("click", () => {
  clearInterval(otpCooldownInterval);
  document.getElementById("otp-step")?.classList.add("hidden");
  document.getElementById("normal-login-ui")?.classList.remove("hidden");
  document.getElementById("otp-error").textContent = "";
  pendingStudentRow = null;
});

document.getElementById("forgot-back-link")?.addEventListener("click", () => {
  clearInterval(otpCooldownInterval);
  document.getElementById("forgot-reset-step")?.classList.add("hidden");
  document.getElementById("normal-login-ui")?.classList.remove("hidden");
  document.getElementById("forgot-reset-error").textContent = "";
  pendingStudentRow = null;
});

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════
async function login() {
  // Guard against double-submit: pressing Enter while the Login button
  // itself has focus fires our keydown handler AND a browser-synthesized
  // click on that button almost simultaneously, calling login() twice —
  // which was silently sending two separate OTP emails (each invalidating
  // the one before it). loginBtn.disabled only got set partway through the
  // function before, with nothing checking it at the very start.
  if (loginBtn.disabled) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  errorMsg.textContent = "";

  if (!username) {
    errorMsg.textContent = "Please enter your Student ID.";
    return;
  }
  if (!password) { errorMsg.textContent = "Please enter your password."; return; }
  if (!STUDENT_ID_FORMAT.test(username)) {
    errorMsg.textContent = "Student ID format: 2023-1154-AB";
    formatError.classList.remove("hidden");
    return;
  }

  loginBtn.textContent = "Logging in...";
  loginBtn.disabled    = true;

  try {
    const { data, error } = await supabase.rpc("verify_student_login", {
      p_student_id: username,
      p_password:   password,
    });
    const userRow = Array.isArray(data) ? data[0] : data;

    if (error || !userRow) {
      errorMsg.textContent = "Incorrect Student ID or password.";
      return;
    }

    pendingStudentRow = { ...userRow, student_id: username };

    if (!userRow.email) {
      // No email on file — OTP was never possible for this student anyway
      finalizeStudentLogin(userRow, username);
      return;
    }

    // Every login always challenges with a fresh OTP — no "remember this
    // device" shortcut. Students only use this system for a short window
    // each semester, so a trusted-device skip isn't worth the extra state
    // (and it was calling a check_remember_token RPC that never actually
    // existed in the database, so it always silently failed anyway).
    //
    // Cooldown check happens BEFORE we call Supabase at all — this is the
    // path a bot would hit by repeatedly resubmitting a valid password,
    // so it has to be throttled here too, not just on the resend button.
    const otpResult = await requestOtpThrottled(userRow.email);

    if (otpResult.throttled) {
      // A code was already sent recently for this email — don't send
      // another, just drop the student back into the "enter code" step
      // (the earlier code, if still unexpired, still works) and show
      // them the countdown instead of a raw error.
      showOtpStep(userRow.email);
      const otpError = document.getElementById("otp-error");
      if (otpError) {
        otpError.textContent = `A code was already sent to this address. You can request a new one in ${formatMMSS(otpResult.remainingMs)}.`;
      }
      startOtpCooldownCountdown(userRow.email, document.getElementById("otp-resend-btn"));
      return;
    }

    if (otpResult.error) {
      errorMsg.textContent = "Couldn't send verification code: " + otpResult.error.message;
      return;
    }

    showOtpStep(userRow.email);
    startOtpCooldownCountdown(userRow.email, document.getElementById("otp-resend-btn"));

  } catch (err) {
    errorMsg.textContent = "Something went wrong. Please try again.";
    console.error(err);
  } finally {
    loginBtn.textContent = "Login";
    loginBtn.disabled    = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  FORGOT PASSWORD
// ══════════════════════════════════════════════════════════════
const forgotLink    = document.getElementById("forgot-link");
const forgotSuccess = document.getElementById("forgot-success");

if (forgotLink) {
  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();

    const studentId = usernameInput.value.trim();
    if (!STUDENT_ID_FORMAT.test(studentId)) {
      errorMsg.textContent = "Enter your Student ID first, then click Forgot password.";
      return;
    }

    forgotLink.textContent = "Checking...";
    // Database function: returns just this one student's email (or null), so
    // the browser can't read the users table to look people up.
    const { data: foundEmail } = await supabase
      .rpc("get_student_reset_email", { p_student_id: studentId });
    const emailRow = foundEmail ? { email: foundEmail } : null;
    forgotLink.textContent = "Forgot password?";

    if (!emailRow?.email) {
      errorMsg.textContent = "No email on file for this Student ID. Ask your admin to add one, or your password is still the middle 4 digits of your ID.";
      return;
    }

    // Same per-email cooldown as the login-OTP path — the forgot-password
    // flow is just as easy for a bot to hammer (it doesn't even need a
    // valid password), so it needs the same throttle.
    const otpResult = await requestOtpThrottled(emailRow.email);

    pendingStudentRow = { student_id: studentId, email: emailRow.email };
    document.getElementById("normal-login-ui")?.classList.add("hidden");
    document.getElementById("forgot-reset-step")?.classList.remove("hidden");
    const target = document.getElementById("forgot-target-email");
    if (target) target.textContent = maskEmail(emailRow.email);

    const forgotErrEl = document.getElementById("forgot-reset-error");

    if (otpResult.throttled) {
      if (forgotErrEl) {
        forgotErrEl.textContent = `A code was already sent to this address. You can request a new one in ${formatMMSS(otpResult.remainingMs)}.`;
      }
    } else if (otpResult.error) {
      if (forgotErrEl) forgotErrEl.textContent = "Couldn't send reset code: " + otpResult.error.message;
    }

    // If your forgot-password markup has its own resend button, give it
    // the same id pattern ("otp-resend-btn") or wire it here explicitly —
    // startOtpCooldownCountdown works with any button element.
    startOtpCooldownCountdown(emailRow.email, document.getElementById("forgot-resend-btn"));
  });
}

document.getElementById("forgot-reset-btn")?.addEventListener("click", async () => {
  const code    = document.getElementById("forgot-code-input")?.value.trim();
  const newPw   = document.getElementById("forgot-new-pw")?.value;
  const confPw  = document.getElementById("forgot-confirm-pw")?.value;
  const errEl   = document.getElementById("forgot-reset-error");
  const btn     = document.getElementById("forgot-reset-btn");

  if (errEl) errEl.textContent = "";

  if (!code)                     { if (errEl) errEl.textContent = "Enter the code from your email."; return; }
  if (!newPw || newPw.length < 4){ if (errEl) errEl.textContent = "Choose a password (at least 4 characters)."; return; }
  if (newPw !== confPw)          { if (errEl) errEl.textContent = "Passwords do not match."; return; }

  btn.textContent = "Verifying..."; btn.disabled = true;

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: pendingStudentRow.email, token: code, type: "email",
  });

  if (verifyError) {
    btn.textContent = "Reset Password"; btn.disabled = false;
    if (errEl) errEl.textContent = "Incorrect or expired code.";
    return;
  }

  const { data: success, error: resetError } = await supabase.rpc("reset_student_password", {
    p_student_id: pendingStudentRow.student_id,
    p_new_password: newPw,
  });

  btn.textContent = "Reset Password"; btn.disabled = false;

  if (resetError || !success) {
    if (errEl) errEl.textContent = "Reset failed: " + (resetError?.message || "please try again.");
    return;
  }

  await supabase.auth.signOut();
  document.getElementById("forgot-reset-step")?.classList.add("hidden");
  document.getElementById("normal-login-ui")?.classList.remove("hidden");
  errorMsg.textContent = "";
  if (forgotSuccess) {
    forgotSuccess.textContent = "Password reset! Log in with your new password.";
    forgotSuccess.style.display = "block";
  }
});

// ── Events ──
loginBtn.addEventListener("click", login);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (document.getElementById("otp-step") && !document.getElementById("otp-step").classList.contains("hidden")) return;
  if (document.getElementById("forgot-reset-step") && !document.getElementById("forgot-reset-step").classList.contains("hidden")) return;
  login();
});