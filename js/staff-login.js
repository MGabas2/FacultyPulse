// ============================================================
//  FacultyPulse — Staff Login (staff.html)
//  Faculty / Supervisor / Admin / Management — Supabase Auth
//  (email + password). Students sign in on index.html (js/login.js).
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

const tabs          = document.querySelectorAll(".role-tab");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn      = document.getElementById("login-btn");
const errorMsg      = document.getElementById("error-msg");

let activeRole = "teacher";

// ── Tab switching (Faculty / Supervisor / Admin / Management) ──
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    activeRole = tab.dataset.role;

    usernameInput.value  = "";
    passwordInput.value  = "";
    errorMsg.textContent = "";

    const forgotSuccess = document.getElementById("forgot-success");
    if (forgotSuccess) forgotSuccess.style.display = "none";

    usernameInput.focus();
  });
});

// Landing here from a password-reset email: preselect the right tab.
const urlTab = new URLSearchParams(window.location.search).get("tab");
if (urlTab && ["teacher", "admin", "supervisor", "executive"].includes(urlTab)) {
  const tabBtn = document.querySelector(`.role-tab[data-role="${urlTab}"]`);
  if (tabBtn) {
    tabBtn.click();
    history.replaceState(null, "", window.location.pathname);
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════
async function login() {
  // Guard against double-submit (Enter on the focused button fires both a
  // keydown and a synthesized click).
  if (loginBtn.disabled) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  errorMsg.textContent = "";

  if (!username) { errorMsg.textContent = "Please enter your email."; return; }
  if (!password) { errorMsg.textContent = "Please enter your password."; return; }

  loginBtn.textContent = "Logging in...";
  loginBtn.disabled    = true;

  try {
    // Emails are stored lowercase (Supabase Auth lowercases them, and the
    // database policies compare lowercase) — so normalise what was typed.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: username.toLowerCase(), password: password,
    });

    if (authError) { errorMsg.textContent = "Incorrect email or password."; return; }

    const { data: userRow, error: userError } = await supabase
      .from("users").select("role, name, id, is_supervisor, is_executive").eq("email", username.toLowerCase()).single();

    if (userError || !userRow) {
      errorMsg.textContent = "Account not found in system. Contact admin.";
      await supabase.auth.signOut();
      return;
    }

    // Multi-role case: a real department chair/dean is a TEACHER account
    // (students evaluate them like any faculty) who ALSO supervises other
    // faculty's SEF and/or sits on the executive/management dashboard —
    // same email/password, same users row, no second account. is_supervisor
    // / is_executive on that teacher row are what let them in via the
    // Supervisor / Management tabs with those same credentials.
    const dualRoleLogin =
      userRow.role === "teacher" &&
      ((activeRole === "supervisor" && userRow.is_supervisor === true) ||
       (activeRole === "executive" && userRow.is_executive === true));

    if (userRow.role !== activeRole && !dualRoleLogin) {
      errorMsg.textContent = `This account is not a ${activeRole}. Switch to the correct tab.`;
      await supabase.auth.signOut();
      return;
    }

    // "role" is which DASHBOARD they're entering (what the rest of the
    // app's guards check), not necessarily their DB role — those only
    // diverge for the multi-role case above. dbRole/isSupervisor/isExecutive
    // are kept separately so teacher.html/supervisor.html/executive.html can
    // show "Switch to ___ View" links without re-querying the DB.
    sessionStorage.setItem("role",         activeRole);
    sessionStorage.setItem("name",         userRow.name);
    sessionStorage.setItem("userId",       userRow.id);
    sessionStorage.setItem("dbRole",       userRow.role);
    sessionStorage.setItem("isSupervisor", String(userRow.is_supervisor === true));
    sessionStorage.setItem("isExecutive",  String(userRow.is_executive === true));

    if (activeRole === "teacher")    window.location.href = "pages/teacher.html";
    if (activeRole === "admin")      window.location.href = "pages/admin.html";
    if (activeRole === "supervisor") window.location.href = "pages/supervisor.html";
    if (activeRole === "executive")  window.location.href = "pages/executive.html";
  } catch (err) {
    errorMsg.textContent = "Something went wrong. Please try again.";
    console.error(err);
  } finally {
    loginBtn.textContent = "Sign in";
    loginBtn.disabled    = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  FORGOT PASSWORD (email reset link)
// ══════════════════════════════════════════════════════════════
const forgotLink    = document.getElementById("forgot-link");
const forgotSuccess = document.getElementById("forgot-success");

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
      redirectTo: `${window.location.origin}/staff.html?tab=${activeRole}`,
    });
    forgotLink.textContent = "Forgot password?";
    if (error) {
      errorMsg.textContent = "Reset failed: " + error.message;
    } else {
      errorMsg.textContent = "";
      forgotSuccess.style.display = "block";
    }
  });
}

// ── Events ──
loginBtn.addEventListener("click", login);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  login();
});
