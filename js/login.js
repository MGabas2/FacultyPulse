// ============================================================
//  FacultyPulse — Login
//  Student: Student ID + password (RPC-verified, hashed server-side)
//    -> email OTP as second factor (skipped if no email on file)
//  Teacher/Admin/Supervisor: unchanged — Supabase Auth
// ============================================================

import { supabase } from "./supabase.js";

// ── PASSWORD RECOVERY — staff (unchanged) ──
supabase.auth.onAuthStateChange((event, session) => {
  if (event !== "PASSWORD_RECOVERY") return;

  const overlay = document.getElementById("reset-overlay");
  if (overlay) {
    overlay.style.display        = "flex";
    document.body.style.overflow = "hidden";
  }

  history.replaceState(null, "", window.location.pathname);

  const saveBtn   = document.getElementById("reset-save-btn");
  const errEl     = document.getElementById("reset-error");
  const successEl = document.getElementById("reset-success");

  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    const newPw  = document.getElementById("reset-new-pw").value;
    const confPw = document.getElementById("reset-confirm-pw").value;

    errEl.style.display = "none";
    errEl.textContent   = "";

    if (!newPw || newPw.length < 8) {
      errEl.textContent   = "Password must be at least 8 characters.";
      errEl.style.display = "block";
      return;
    }
    if (newPw !== confPw) {
      errEl.textContent   = "Passwords do not match.";
      errEl.style.display = "block";
      return;
    }

    saveBtn.textContent = "Updating...";
    saveBtn.disabled    = true;

    const { error } = await supabase.auth.updateUser({ password: newPw });

    saveBtn.textContent = "Update Password";
    saveBtn.disabled    = false;

    if (error) {
      errEl.textContent   = "Failed: " + error.message;
      errEl.style.display = "block";
      return;
    }

    document.getElementById("reset-form-fields").style.display = "none";
    successEl.style.display = "block";

    await supabase.auth.signOut();
  });
});

// ── Legacy hash error handler (unchanged) ──
(function handleHashErrors() {
  const hash = window.location.hash.substring(1);
  if (!hash) return;
  const params = Object.fromEntries(new URLSearchParams(hash));
  if (!params.error) return;
  const banner = document.getElementById("hash-error-banner");
  if (!banner) return;
  const messages = {
    otp_expired:   "This password reset link has expired or was already used. Please request a new one.",
    access_denied: "This link is no longer valid. Please request a new password reset.",
  };
  banner.textContent = messages[params.error_code]
    || decodeURIComponent(params.error_description || "An error occurred. Please request a new reset link.");
  banner.style.display = "block";
  history.replaceState(null, "", window.location.pathname);
})();

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

const tabs          = document.querySelectorAll(".role-tab");
const usernameInput = document.getElementById("username");
const usernameLabel = document.getElementById("username-label");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const errorMsg      = document.getElementById("error-msg");
const idHint        = document.getElementById("id-hint");
const formatError   = document.getElementById("format-error");

let activeRole = "student";

// ── Finalize a successful student login (shared by the password+OTP path
//    and the no-email path) ──
function finalizeStudentLogin(userRow, studentId) {
  sessionStorage.setItem("role",      "student");
  sessionStorage.setItem("studentId", studentId);
  sessionStorage.setItem("userId",    userRow.id);
  sessionStorage.setItem("sectionId", userRow.section_id);
  sessionStorage.setItem("name",      userRow.name || studentId);
  sessionStorage.setItem("email",     userRow.email || "");
  sessionStorage.setItem("needsEmailPrompt", userRow.email ? "false" : "true");

  supabase
    .from("users")
    .update({ last_login: new Date().toISOString() })
    .eq("id", userRow.id)
    .then(() => {});

  window.location.href = "pages/student.html";
}

// ── Tab switching ──
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    activeRole = tab.dataset.role;

    usernameInput.value  = "";
    passwordInput.value  = "";
    errorMsg.textContent = "";
    formatError.classList.add("hidden");

    if (activeRole === "student") {
      usernameLabel.textContent = "Student ID";
      usernameInput.placeholder = "e.g. 2023-1154-AB";
      usernameInput.maxLength   = 13;
      usernameInput.type        = "text";
      idHint.classList.remove("hidden");
    } else {
      usernameLabel.textContent = "Email";
      usernameInput.placeholder = "Enter your email";
      usernameInput.maxLength   = 100;
      usernameInput.type        = "email";
      idHint.classList.add("hidden");
    }

    const forgotWrap = document.getElementById("forgot-wrap");
    if (forgotWrap) forgotWrap.style.display = "block";
    document.getElementById("forgot-success")?.style && (document.getElementById("forgot-success").style.display = "none");

    usernameInput.focus();
  });
});

const urlTab = new URLSearchParams(window.location.search).get("tab");
if (urlTab && ["teacher","admin","supervisor"].includes(urlTab)) {
  const tabBtn = document.querySelector(`.role-tab[data-role="${urlTab}"]`);
  if (tabBtn) {
    tabBtn.click();
    history.replaceState(null, "", window.location.pathname);
  }
}

usernameInput.addEventListener("input", () => {
  if (activeRole !== "student") return;
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
    errorMsg.textContent = activeRole === "student" ? "Please enter your Student ID." : "Please enter your email.";
    return;
  }
  if (!password) { errorMsg.textContent = "Please enter your password."; return; }
  if (activeRole === "student" && !STUDENT_ID_FORMAT.test(username)) {
    errorMsg.textContent = "Student ID format: 2023-1154-AB";
    formatError.classList.remove("hidden");
    return;
  }

  loginBtn.textContent = "Logging in...";
  loginBtn.disabled    = true;

  try {
    if (activeRole === "student") {
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

    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: username, password: password,
      });

      if (authError) { errorMsg.textContent = "Incorrect email or password."; return; }

      const { data: userRow, error: userError } = await supabase
        .from("users").select("role, name, id").eq("email", username).single();

      if (userError || !userRow) {
        errorMsg.textContent = "Account not found in system. Contact admin.";
        await supabase.auth.signOut();
        return;
      }
      if (userRow.role !== activeRole) {
        errorMsg.textContent = `This account is not a ${activeRole}. Switch to the correct tab.`;
        await supabase.auth.signOut();
        return;
      }

      sessionStorage.setItem("role",   userRow.role);
      sessionStorage.setItem("name",   userRow.name);
      sessionStorage.setItem("userId", userRow.id);

      if (userRow.role === "teacher")    window.location.href = "pages/teacher.html";
      if (userRow.role === "admin")      window.location.href = "pages/admin.html";
      if (userRow.role === "supervisor") window.location.href = "pages/supervisor.html";
      if (userRow.role === "depthead")   window.location.href = "pages/depthead.html";
    }
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

    if (activeRole !== "student") {
      const email = usernameInput.value.trim();
      if (!email) {
        errorMsg.textContent = "Enter your email address first, then click Forgot password.";
        return;
      }
      forgotLink.textContent = "Sending...";
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/index.html?tab=${activeRole}`,
      });
      forgotLink.textContent = "Forgot password?";
      if (error) {
        errorMsg.textContent = "Reset failed: " + error.message;
      } else {
        errorMsg.textContent = "";
        forgotSuccess.style.display = "block";
      }
      return;
    }

    const studentId = usernameInput.value.trim();
    if (!STUDENT_ID_FORMAT.test(studentId)) {
      errorMsg.textContent = "Enter your Student ID first, then click Forgot password.";
      return;
    }

    forgotLink.textContent = "Checking...";
    const { data: emailRow } = await supabase
      .from("users").select("email").eq("student_id", studentId).eq("role", "student").maybeSingle();
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