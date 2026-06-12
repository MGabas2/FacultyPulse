// ============================================================
//  FacultyPulse — Login
//  Role selected via tab buttons (Student | Teacher | Admin)
//  Student default password = middle 4 digits of their ID
// ============================================================

import { supabase } from "./supabase.js";

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

// ── Elements ──
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

    // Focus username after switching
    usernameInput.focus();
  });
});

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
        .select("id, student_id, role, section_id")
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
      sessionStorage.setItem("name",      username);

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

// ── Events ──
loginBtn.addEventListener("click", login);
document.addEventListener("keydown", e => { if (e.key === "Enter") login(); });