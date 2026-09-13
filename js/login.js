// ============================================================
//  FacultyPulse — Login
//  Student: Student ID + password (RPC-verified, hashed server-side)
//    -> email OTP as second factor (skipped if no email on file)
//    -> optional "remember me" (auto-login on return visits)
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
const REMEMBER_TOKEN_KEY = "fp_remember_token";

const tabs          = document.querySelectorAll(".role-tab");
const usernameInput = document.getElementById("username");
const usernameLabel = document.getElementById("username-label");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const errorMsg      = document.getElementById("error-msg");
const idHint        = document.getElementById("id-hint");
const formatError   = document.getElementById("format-error");

let activeRole = "student";

// ── Finalize a successful student login (shared by password+OTP path,
//    no-email path, and remember-token auto-login) ──
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

// (No page-load auto-login. "Remember me" only lets a trusted device skip
// the OTP step after password verification — see login() below — it never
// bypasses entering a Student ID and password.)

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

async function verifyOtpAndLogin(code, rememberMe) {
  const email = pendingStudentRow?.email;
  if (!email || !pendingStudentRow) return "Session expired — please log in again.";

  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) return "Incorrect or expired code.";

  if (rememberMe) {
    const { data: token } = await supabase.rpc("issue_remember_token", {
      p_student_id: pendingStudentRow.student_id,
    });
    if (token) localStorage.setItem(REMEMBER_TOKEN_KEY, token);
  }

  finalizeStudentLogin(pendingStudentRow, pendingStudentRow.student_id);
  return null;
}

document.getElementById("otp-verify-btn")?.addEventListener("click", async () => {
  const btn  = document.getElementById("otp-verify-btn");
  const code = document.getElementById("otp-code-input")?.value.trim();
  const rememberMe = document.getElementById("remember-me-checkbox")?.checked;
  const otpError = document.getElementById("otp-error");

  if (!code) { if (otpError) otpError.textContent = "Enter the code from your email."; return; }

  btn.textContent = "Verifying..."; btn.disabled = true;
  const err = await verifyOtpAndLogin(code, rememberMe);
  btn.textContent = "Verify"; btn.disabled = false;

  if (err && otpError) otpError.textContent = err;
});

document.getElementById("otp-resend-btn")?.addEventListener("click", async () => {
  if (!pendingStudentRow?.email) return;
  const btn = document.getElementById("otp-resend-btn");
  btn.textContent = "Sending..."; btn.disabled = true;
  await requestOtp(pendingStudentRow.email);
  btn.textContent = "Resend code"; btn.disabled = false;
});

document.getElementById("otp-back-link")?.addEventListener("click", () => {
  document.getElementById("otp-step")?.classList.add("hidden");
  document.getElementById("normal-login-ui")?.classList.remove("hidden");
  document.getElementById("otp-error").textContent = "";
  pendingStudentRow = null;
});

document.getElementById("forgot-back-link")?.addEventListener("click", () => {
  document.getElementById("forgot-reset-step")?.classList.add("hidden");
  document.getElementById("normal-login-ui")?.classList.remove("hidden");
  document.getElementById("forgot-reset-error").textContent = "";
  pendingStudentRow = null;
});

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════
async function login() {
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

      // Password just succeeded. Now check whether THIS device already
      // passed OTP recently for THIS student — if so, skip the code step.
      // Password is still required every time regardless; this only ever
      // shortcuts the second factor, never the first.
      const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY);
      if (rememberToken) {
        const { data: trusted } = await supabase.rpc("check_remember_token", {
          p_student_id: username,
          p_token: rememberToken,
        });
        if (trusted) {
          finalizeStudentLogin(userRow, username);
          return;
        }
        // Token expired/invalid for this student — clean it up and fall
        // through to a normal OTP challenge below.
        localStorage.removeItem(REMEMBER_TOKEN_KEY);
      }

      const otpError = await requestOtp(userRow.email);
      if (otpError) {
        errorMsg.textContent = "Couldn't send verification code: " + otpError.message;
        return;
      }
      showOtpStep(userRow.email);

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

    const otpError = await requestOtp(emailRow.email);
    if (otpError) {
      errorMsg.textContent = "Couldn't send reset code: " + otpError.message;
      return;
    }

    pendingStudentRow = { student_id: studentId, email: emailRow.email };
    document.getElementById("normal-login-ui")?.classList.add("hidden");
    document.getElementById("forgot-reset-step")?.classList.remove("hidden");
    const target = document.getElementById("forgot-target-email");
    if (target) target.textContent = maskEmail(emailRow.email);
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