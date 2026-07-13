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

const tabs          = document.querySelectorAll(".role-tab");
const usernameInput = document.getElementById("username");
const usernameLabel = document.getElementById("username-label");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const errorMsg      = document.getElementById("error-msg");
const idHint        = document.getElementById("id-hint");
const formatError   = document.getElementById("format-error");

// ── Active role state ──
let activeRole = "student"; // default tab

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

    // Update field based on role
    if (activeRole === "student") {
      usernameLabel.textContent   = "Student ID";
      usernameInput.placeholder   = "e.g. 2023-1154-AB";
      usernameInput.maxLength     = 13;
      usernameInput.type          = "text";
      idHint.classList.remove("hidden");
    } else {
      usernameLabel.textContent   = "Email";
      usernameInput.placeholder   = "Enter your email";
      usernameInput.maxLength     = 100;
      usernameInput.type          = "email";
      idHint.classList.add("hidden");
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

// ── Extract middle 4 digits as default password ──
// "2023-1154-AB" → "1154"
function getStudentDefaultPassword(studentId) {
  return studentId.split("-")[1];
}

// ── Login handler ──
async function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  errorMsg.textContent = "";

  // Validation
  if (!username) {
    errorMsg.textContent = activeRole === "student"
      ? "Please enter your Student ID."
      : "Please enter your email.";
    return;
  }
  if (!password) {
    errorMsg.textContent = "Please enter your password.";
    return;
  }
  if (activeRole === "student" && !STUDENT_ID_FORMAT.test(username)) {
    errorMsg.textContent = "Student ID format: 2023-1154-AB";
    formatError.classList.remove("hidden");
    return;
  }

  loginBtn.textContent = "Logging in...";
  loginBtn.disabled    = true;

  try {

    if (activeRole === "student") {

      // Step 1 — Check student ID exists
      const { data: userRow, error: lookupError } = await supabase
        .from("users")
        .select("id, student_id, role, section_id, name")
        .eq("student_id", username)
        .eq("role", "student")
        .single();

      if (lookupError || !userRow) {
        errorMsg.textContent = "Student ID not found. Contact your admin.";
        return;
      }

      // Step 2 — Validate default password (middle 4 digits)
      const defaultPassword = getStudentDefaultPassword(username);
      if (password !== defaultPassword) {
        errorMsg.textContent = "Incorrect password. Hint: use the middle number of your Student ID.";
        return;
      }

      // Step 3 — Record the actual login time (only here, on real login)
      await supabase
        .from("users")
        .update({ last_login: new Date().toISOString() })
        .eq("id", userRow.id);

      // Step 4 — Save session + redirect
      sessionStorage.setItem("role",      "student");
      sessionStorage.setItem("studentId", username);
      sessionStorage.setItem("userId",    userRow.id);
      sessionStorage.setItem("sectionId", userRow.section_id);
      sessionStorage.setItem("name",      userRow.name || username); // real name if available

      window.location.href = "pages/student.html";

    } else {

      // Teacher / Admin / Supervisor / Dept Head — Supabase Auth
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
    }

  } catch (err) {
    errorMsg.textContent = "Something went wrong. Please try again.";
    console.error(err);
  } finally {
    loginBtn.textContent = "Login";
    loginBtn.disabled    = false;
  }
}

// ── Forgot password ──
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
document.addEventListener("keydown", e => { if (e.key === "Enter") login(); });