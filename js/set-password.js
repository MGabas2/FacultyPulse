// ============================================================
//  FacultyPulse — Set Password
//  Lands here from a Supabase invite email (new students/staff
//  setting a password for the first time) or a password-reset email
//  (forgot password). Same page handles both, since both cases boil
//  down to "a valid recovery session exists, let them pick a password."
//
//  Uses onAuthStateChange rather than parsing the URL hash directly —
//  this project's PKCE flow breaks hash-based token detection, so the
//  event listener is the reliable way to know a session actually exists
//  (same lesson already applied to the staff password-reset flow).
// ============================================================

import { supabase } from "./supabase.js";

const statusEl  = document.getElementById("status");
const formEl    = document.getElementById("set-password-form");
const pwEl      = document.getElementById("new-password");
const pw2El     = document.getElementById("confirm-password");
const errorEl   = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");

let sessionReady = false;

function showForm() {
  if (sessionReady) return; // don't re-trigger if already shown
  sessionReady = true;
  statusEl.classList.add("hidden");
  formEl.classList.remove("hidden");
}

// Primary path: Supabase fires this once it's parsed the link and
// established a session. Invite links typically fire SIGNED_IN;
// password-reset links fire PASSWORD_RECOVERY. Treat both the same.
supabase.auth.onAuthStateChange((event, session) => {
  if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
    showForm();
  }
});

// Fallback: if the event already fired before this page attached its
// listener (a timing edge case), a session may already exist by the
// time this runs — check directly too rather than relying on the event
// alone.
supabase.auth.getSession().then(({ data }) => {
  if (data?.session) showForm();
});

// If neither path produces a session within a few seconds, the link is
// expired, already used, or malformed — say so instead of leaving a
// blank "Verifying…" message forever.
setTimeout(() => {
  if (!sessionReady) {
    statusEl.textContent = "This link is invalid or has expired. Ask your admin to send a new one.";
    statusEl.style.color = "#dc2626";
  }
}, 5000);

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const pw  = pwEl.value;
  const pw2 = pw2El.value;

  if (pw.length < 8) {
    errorEl.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (pw !== pw2) {
    errorEl.textContent = "Passwords don't match.";
    return;
  }

  submitBtn.textContent = "Saving…";
  submitBtn.disabled = true;

  const { error } = await supabase.auth.updateUser({ password: pw });

  if (error) {
    submitBtn.textContent = "Set Password";
    submitBtn.disabled = false;
    errorEl.textContent = "Failed to set password: " + error.message;
    return;
  }

  formEl.classList.add("hidden");
  statusEl.classList.remove("hidden");
  statusEl.style.color = "#16a34a";
  statusEl.textContent = "Password set. Redirecting you to log in…";

  // Sign out of this temporary invite/recovery session so they log in
  // fresh with the password they just chose, rather than silently
  // staying signed in under whatever session the link happened to grant.
  await supabase.auth.signOut();
  setTimeout(() => { window.location.href = "index.html"; }, 2000);
});