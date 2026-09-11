// ============================================================
//  FacultyPulse — Login
//  Role selected via tab buttons (Student | Teacher | Admin)
//  Student default password = middle 4 digits of their ID
// ============================================================

import { supabase } from "./supabase.js";

// ── PASSWORD RECOVERY — onAuthStateChange (works with PKCE + implicit flow) ──
// Supabase new projects use PKCE by default — the access_token is NO LONGER
// in the URL hash. onAuthStateChange fires PASSWORD_RECOVERY automatically
// when the user lands after clicking the reset email link.
supabase.auth.onAuthStateChange((event, session) => {
  if (event !== "PASSWORD_RECOVERY") return;

  // Show full-screen reset overlay, hide everything behind it
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

    // Show success — hide form fields, show success card
    document.getElementById("reset-form-fields").style.display = "none";
    successEl.style.display = "block";

    await supabase.auth.signOut();
  });
});

// ── Legacy hash error handler (otp_expired etc. from old implicit flow) ──
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

const tabs             = document.querySelectorAll(".role-tab");
const usernameInput    = document.getElementById("username");
const usernameLabel    = document.getElementById("username-label");
const passwordFieldWrap = document.getElementById("password-field-wrap");
const passwordInput    = document.getElementById("password");
const loginBtn         = document.getElementById("login-btn");
const errorMsg         = document.getElementById("error-msg");
const idHint           = document.getElementById("id-hint");
const formatError      = document.getElementById("format-error");

const otpCodeWrap   = document.getElementById("otp-code-wrap");
const otpMaskedEmail = document.getElementById("otp-masked-email");
const otpCodeInput  = document.getElementById("otp-code");
const otpVerifyBtn  = document.getElementById("otp-verify-btn");
const otpBackLink   = document.getElementById("otp-back-link");
const otpResendLink = document.getElementById("otp-resend-link");

// ── Active role state ──
let activeRole = "student"; // default tab
let pendingStudentId = null; // set once a code has been sent, for verify + resend

const DEVICE_TOKEN_KEY = "fp_device_token";

// ── Reset the OTP flow back to "enter your Student ID + password" ──
function resetOtpStep() {
  pendingStudentId = null;
  otpCodeWrap.classList.add("hidden");
  otpCodeInput.value = "";
  loginBtn.style.display = "block";
  passwordFieldWrap.style.display = "block";
  usernameInput.disabled = false;
  passwordInput.value = "";
}

function getDeviceToken() {
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}
function storeDeviceToken(token) {
  if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
}

// ── Student login: password first, OTP only if this device isn't recognized ──
async function attemptStudentLogin(studentId, password) {
  errorMsg.textContent = "";
  loginBtn.textContent = "Logging in...";
  loginBtn.disabled = true;

  try {
    const resp = await fetch("/api/student-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, password, deviceToken: getDeviceToken() }),
    });

    let result = {};
    try {
      result = await resp.json();
    } catch {
      result = { error: `Server returned ${resp.status} with no readable response` };
    }

    if (!resp.ok) {
      errorMsg.textContent = result.error || "Login failed. Please try again.";
      if (result.needsEmail) {
        errorMsg.innerHTML = `${result.error} <a href="request-email.html" style="color:#1a56db;">Request one here</a>.`;
      }
      return;
    }

    if (!result.needsOtp) {
      // Recognized device — log straight in, no OTP needed at all.
      await finishStudentLogin(result.session, result.student);
      return;
    }

    // Password was correct, but this device isn't recognized yet —
    // second factor required.
    pendingStudentId = studentId;
    otpMaskedEmail.textContent = result.maskedEmail;
    otpCodeWrap.classList.remove("hidden");
    loginBtn.style.display = "none";
    passwordFieldWrap.style.display = "none";
    usernameInput.disabled = true;
    otpCodeInput.focus();
    startResendCooldown();
  } catch (err) {
    errorMsg.textContent = "Couldn't reach the server. Please try again.";
    console.error(err);
  } finally {
    loginBtn.textContent = "Login";
    loginBtn.disabled = false;
  }
}

// ── Adopt a session and redirect, shared by both the trusted-device
//    path (no OTP) and the post-OTP-verification path ──
async function finishStudentLogin(session, student) {
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  sessionStorage.setItem("role",      "student");
  sessionStorage.setItem("studentId", student.student_id);
  sessionStorage.setItem("userId",    student.id);
  sessionStorage.setItem("sectionId", student.section_id);
  sessionStorage.setItem("name",      student.name || student.student_id);

  window.location.href = "pages/student.html";
}

// ── Tab switching ──
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    // Update active tab style
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    activeRole = tab.dataset.role;

    // Reset fields
    usernameInput.value  = "";
    passwordInput.value  = "";
    errorMsg.textContent = "";
    formatError.classList.add("hidden");
    resetOtpStep();

    // Update field based on role
    if (activeRole === "student") {
      usernameLabel.textContent   = "Student ID";
      usernameInput.placeholder   = "e.g. 2023-1154-AB";
      usernameInput.maxLength     = 13;
      usernameInput.type          = "text";
      idHint.classList.remove("hidden");
      passwordFieldWrap.style.display = "block";
      loginBtn.textContent = "Login";
    } else {
      usernameLabel.textContent   = "Email";
      usernameInput.placeholder   = "Enter your email";
      usernameInput.maxLength     = 100;
      usernameInput.type          = "email";
      idHint.classList.add("hidden");
      passwordFieldWrap.style.display = "block";
      loginBtn.textContent = "Login";
    }

    // Show "Forgot password?" only for staff roles
    const forgotWrap = document.getElementById("forgot-wrap");
    if (forgotWrap) {
      forgotWrap.style.display = activeRole === "student" ? "none" : "block";
    }
    document.getElementById("forgot-success")?.style && (document.getElementById("forgot-success").style.display = "none");

    // Focus username after switching
    usernameInput.focus();
  });
});

// ── Restore tab from ?tab= query param — MUST run after listener setup ──
const urlTab = new URLSearchParams(window.location.search).get("tab");
if (urlTab && ["teacher","admin","supervisor"].includes(urlTab)) {
  const tabBtn = document.querySelector(`.role-tab[data-role="${urlTab}"]`);
  if (tabBtn) {
    tabBtn.click();
    history.replaceState(null, "", window.location.pathname);
  }
}

// ── Auto-uppercase + live format check for students ──
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

// ── Verify the code the student typed in (second factor) ──
async function verifyStudentCode() {
  const code = otpCodeInput.value.trim();
  errorMsg.textContent = "";

  if (!/^\d{6}$/.test(code)) {
    errorMsg.textContent = "Enter the 6-digit code from your email.";
    return;
  }
  if (!pendingStudentId) {
    errorMsg.textContent = "Something went wrong — please log in again.";
    resetOtpStep();
    return;
  }

  otpVerifyBtn.textContent = "Verifying...";
  otpVerifyBtn.disabled = true;

  try {
    const resp = await fetch("/api/student-verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: pendingStudentId, code }),
    });

    let result = {};
    try {
      result = await resp.json();
    } catch {
      result = { error: `Server returned ${resp.status} with no readable response` };
    }

    if (!resp.ok) {
      errorMsg.textContent = result.error || "Incorrect or expired code.";
      return;
    }

    // This device just earned trust — remember it so future logins on
    // this same browser skip the OTP step entirely.
    storeDeviceToken(result.deviceToken);

    await finishStudentLogin(result.session, result.student);
  } catch (err) {
    errorMsg.textContent = "Couldn't reach the server. Please try again.";
    console.error(err);
  } finally {
    otpVerifyBtn.textContent = "Verify";
    otpVerifyBtn.disabled = false;
  }
}

// ── Resend cooldown — prevents spamming Supabase's own per-address OTP limit ──
function startResendCooldown() {
  let seconds = 30;
  otpResendLink.style.pointerEvents = "none";
  otpResendLink.style.color = "#94a3b8";
  otpResendLink.textContent = `Resend code (${seconds}s)`;

  const interval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(interval);
      otpResendLink.style.pointerEvents = "auto";
      otpResendLink.style.color = "#1a56db";
      otpResendLink.textContent = "Resend code";
    } else {
      otpResendLink.textContent = `Resend code (${seconds}s)`;
    }
  }, 1000);
}

otpBackLink?.addEventListener("click", (e) => {
  e.preventDefault();
  errorMsg.textContent = "";
  resetOtpStep();
  usernameInput.focus();
});

otpResendLink?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!pendingStudentId || otpResendLink.style.pointerEvents === "none") return;

  try {
    await fetch("/api/student-send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: pendingStudentId }),
    });
    startResendCooldown();
  } catch (err) {
    errorMsg.textContent = "Couldn't resend the code. Please try again.";
  }
});

otpVerifyBtn?.addEventListener("click", verifyStudentCode);

// ── Main login handler (step 1 — password. Code verification, when
//    required, is handled by otpVerifyBtn above) ──
async function login() {
  const username = usernameInput.value.trim();
  errorMsg.textContent = "";

  if (!username) {
    errorMsg.textContent = activeRole === "student"
      ? "Please enter your Student ID."
      : "Please enter your email.";
    return;
  }

  if (activeRole === "student") {
    if (!STUDENT_ID_FORMAT.test(username)) {
      errorMsg.textContent = "Student ID format: 2023-1154-AB";
      formatError.classList.remove("hidden");
      return;
    }
    const studentPassword = passwordInput.value.trim();
    if (!studentPassword) {
      errorMsg.textContent = "Please enter your password.";
      return;
    }
    await attemptStudentLogin(username, studentPassword);
    return;
  }

  // Teacher / Admin / Supervisor / Dept Head — Supabase Auth, unchanged
  const password = passwordInput.value.trim();
  if (!password) {
    errorMsg.textContent = "Please enter your password.";
    return;
  }

  loginBtn.textContent = "Logging in...";
  loginBtn.disabled    = true;

  try {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email:    username,
      password: password,
    });

    if (authError) {
      errorMsg.textContent = "Incorrect email or password.";
      return;
    }

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("role, name, id")
      .eq("email", username)
      .single();

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

  } catch (err) {
    errorMsg.textContent = "Something went wrong. Please try again.";
    console.error(err);
  } finally {
    loginBtn.textContent = "Login";
    loginBtn.disabled    = false;
  }
}

// ── Forgot password — staff only, unchanged ──
const forgotLink    = document.getElementById("forgot-link");
const forgotSuccess = document.getElementById("forgot-success");
const forgotWrap    = document.getElementById("forgot-wrap");

if (forgotLink) {
  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
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
      errorMsg.textContent  = "";
      forgotSuccess.style.display = "block";
    }
  });
}

// ── Events ──
loginBtn.addEventListener("click", login);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  // Route Enter to whichever action is actually in front of the user.
  if (!otpCodeWrap.classList.contains("hidden")) {
    verifyStudentCode();
  } else {
    login();
  }
});