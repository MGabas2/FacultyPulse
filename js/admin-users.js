// ============================================================
//  FacultyPulse — Admin User Management
//  Add users, sort by name/role/section, filter, search
// ============================================================

import { supabase } from "./supabase.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../index.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + sessionStorage.getItem("name");

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

// ── State ──
let allUsers    = [];
let sections    = [];
let sortKey     = "name";
let sortAsc     = true;
let deleteTargetId = null;

// ── Load sections for dropdowns ──
async function loadSections() {
  const { data } = await supabase.from("sections").select("id, name").order("name");
  sections = data || [];

  // Populate filter dropdown
  const filterSection = document.getElementById("filter-section");
  sections.forEach(s => {
    filterSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  // Populate add-user section dropdowns
  const newSection = document.getElementById("new-section-id");
  const supSection = document.getElementById("new-supervisor-section");
  sections.forEach(s => {
    newSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    supSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });
}

// ── Load all users from Supabase ──
async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("users")
    .select("id, student_id, role, name, email, section_id, sections(name)");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error loading users.</td></tr>`;
    console.error(error);
    return;
  }

  allUsers = data || [];
  renderTable();
}

// ── Render table with current sort + filters ──
function renderTable() {
  const search        = document.getElementById("search-input").value.toLowerCase();
  const filterRole    = document.getElementById("filter-role").value;
  const filterSection = document.getElementById("filter-section").value;

  // Filter
  let filtered = allUsers.filter(u => {
    const nameOrId = (u.name || u.student_id || "").toLowerCase();
    const matchSearch  = !search      || nameOrId.includes(search);
    const matchRole    = !filterRole  || u.role === filterRole;
    const matchSection = !filterSection || u.section_id === filterSection;
    return matchSearch && matchRole && matchSection;
  });

  // Sort
  filtered.sort((a, b) => {
    let valA, valB;
    if (sortKey === "name") {
      valA = (a.name || a.student_id || "").toLowerCase();
      valB = (b.name || b.student_id || "").toLowerCase();
    } else if (sortKey === "role") {
      valA = a.role;
      valB = b.role;
    } else if (sortKey === "section") {
      valA = (a.sections?.name || "").toLowerCase();
      valB = (b.sections?.name || "").toLowerCase();
    }
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  // Update count
  document.getElementById("user-count").textContent =
    `Showing ${filtered.length} of ${allUsers.length} users`;

  // Render rows
  const tbody = document.getElementById("users-tbody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  filtered.forEach(u => {
    const displayName = u.name || u.student_id || "—";
    const roleLabel   = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const section     = u.sections?.name || "—";

    tbody.innerHTML += `
      <tr>
        <td>${displayName}</td>
        <td>
          <span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>
        </td>
        <td>${u.email || "—"}</td>
        <td>${section}</td>
        <td><span class="badge done">Active</span></td>
        <td>
          <button class="btn-secondary" style="font-size:12px; padding:5px 10px;"
            onclick="confirmDelete('${u.id}', '${displayName.replace(/'/g, "\\'")}')">
            Remove
          </button>
        </td>
      </tr>
    `;
  });
}

function getRoleBadgeClass(role) {
  return role === "admin" ? "badge-admin"
       : role === "teacher" ? "badge-teacher"
       : role === "supervisor" ? "badge-supervisor"
       : "pending";
}

// ── Sort ──
function setSort(key) {
  if (sortKey === key) {
    sortAsc = !sortAsc; // toggle direction
  } else {
    sortKey = key;
    sortAsc = true;
  }

  // Update button styles
  ["name", "role", "section"].forEach(k => {
    const btn   = document.getElementById(`sort-${k}`);
    const arrow = document.getElementById(`arrow-${k}`);
    if (k === sortKey) {
      btn.classList.add("active");
      arrow.textContent = sortAsc ? "↑" : "↓";
    } else {
      btn.classList.remove("active");
      arrow.textContent = "";
    }
  });

  renderTable();
}

// ── Show/hide role-specific fields in Add User modal ──
function onNewRoleChange() {
  const role         = document.getElementById("new-role").value;
  const studentFields = document.getElementById("student-fields");
  const staffFields   = document.getElementById("staff-fields");
  const supSection    = document.getElementById("supervisor-section-group");

  studentFields.classList.add("hidden");
  staffFields.classList.add("hidden");
  supSection.style.display = "none";

  if (role === "student") {
    studentFields.classList.remove("hidden");
  } else if (["teacher", "supervisor", "admin"].includes(role)) {
    staffFields.classList.remove("hidden");
    if (role === "supervisor") supSection.style.display = "block";
  }
}

function autoUppercase(input) {
  const cursor = input.selectionStart;
  input.value  = input.value.toUpperCase();
  input.setSelectionRange(cursor, cursor);
}

// ── Save new user ──
async function saveUser() {
  const role     = document.getElementById("new-role").value;
  const errorEl  = document.getElementById("add-error");
  const saveBtn  = document.getElementById("save-user-btn");
  errorEl.textContent = "";

  if (!role) { errorEl.textContent = "Please select a role."; return; }

  saveBtn.textContent = "Saving...";
  saveBtn.disabled    = true;

  try {
    if (role === "student") {
      const studentId = document.getElementById("new-student-id").value.trim();
      const sectionId = document.getElementById("new-section-id").value;

      if (!studentId) { errorEl.textContent = "Student ID is required."; return; }
      if (!STUDENT_ID_FORMAT.test(studentId)) {
        errorEl.textContent = "Invalid Student ID format. Use: 2023-1154-AB";
        return;
      }
      if (!sectionId) { errorEl.textContent = "Please select a section."; return; }

      const { error } = await supabase.from("users").insert({
        student_id: studentId,
        role:       "student",
        section_id: sectionId,
      });

      if (error) {
        errorEl.textContent = error.code === "23505"
          ? "That Student ID already exists."
          : "Failed to save: " + error.message;
        return;
      }

    } else {
      const name     = document.getElementById("new-name").value.trim();
      const email    = document.getElementById("new-email").value.trim();
      const password = document.getElementById("new-password").value.trim();
      const supSec   = document.getElementById("new-supervisor-section").value;

      if (!name)     { errorEl.textContent = "Full name is required."; return; }
      if (!email)    { errorEl.textContent = "Email is required."; return; }
      if (!password) { errorEl.textContent = "Password is required."; return; }

      // Create auth account for staff
      const { data: authData, error: authError } = await supabase.auth.admin
        ? await createAuthUser(email, password)
        : { data: null, error: { message: "Admin auth not available from browser." } };

      // Insert into users table regardless
      // (Auth creation requires service role key — admin can do this in Supabase dashboard)
      const insertData = {
        role,
        name,
        email,
        section_id: role === "supervisor" ? supSec || null : null,
      };

      const { error: insertError } = await supabase.from("users").insert(insertData);
      if (insertError) {
        errorEl.textContent = insertError.code === "23505"
          ? "That email already exists."
          : "Failed to save: " + insertError.message;
        return;
      }

      // Remind admin to create auth account if needed
      if (role !== "student") {
        alert(
          `✅ User "${name}" added to the system.\n\n` +
          `⚠️ Remember to also create their login account in:\n` +
          `Supabase → Authentication → Users → Add User\n\n` +
          `Email: ${email}\nPassword: ${password}`
        );
      }
    }

    closeAddModal();
    loadUsers();

  } catch (err) {
    errorEl.textContent = "Unexpected error: " + err.message;
    console.error(err);
  } finally {
    saveBtn.textContent = "Save User";
    saveBtn.disabled    = false;
  }
}

// ── Delete user ──
function confirmDelete(userId, userName) {
  deleteTargetId = userId;
  document.getElementById("delete-name").textContent = userName;
  document.getElementById("delete-modal").classList.remove("hidden");
}

async function deleteUser() {
  if (!deleteTargetId) return;

  const { error } = await supabase.from("users").delete().eq("id", deleteTargetId);
  if (error) {
    alert("Failed to remove user: " + error.message);
    return;
  }

  document.getElementById("delete-modal").classList.add("hidden");
  deleteTargetId = null;
  loadUsers();
}

// ── Modal helpers ──
function openAddModal() {
  document.getElementById("new-role").value     = "";
  document.getElementById("new-student-id").value = "";
  document.getElementById("new-name").value     = "";
  document.getElementById("new-email").value    = "";
  document.getElementById("new-password").value = "";
  document.getElementById("add-error").textContent = "";
  document.getElementById("student-fields").classList.add("hidden");
  document.getElementById("staff-fields").classList.add("hidden");
  document.getElementById("add-modal").classList.remove("hidden");
}

function closeAddModal() {
  document.getElementById("add-modal").classList.add("hidden");
}

// ── Expose to HTML (sort buttons use onclick) ──
window.setSort       = setSort;
window.onNewRoleChange = onNewRoleChange;
window.autoUppercase = autoUppercase;
window.confirmDelete = confirmDelete;

// ── Attach all events ──
document.getElementById("add-user-btn").addEventListener("click", openAddModal);
document.getElementById("save-user-btn").addEventListener("click", saveUser);
document.getElementById("cancel-add-btn").addEventListener("click", closeAddModal);
document.getElementById("confirm-delete-btn").addEventListener("click", deleteUser);
document.getElementById("cancel-delete-btn").addEventListener("click", () => {
  document.getElementById("delete-modal").classList.add("hidden");
});
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// Search and filter — live update
document.getElementById("search-input").addEventListener("input", renderTable);
document.getElementById("filter-role").addEventListener("change", renderTable);
document.getElementById("filter-section").addEventListener("change", renderTable);

// ── Init ──
loadSections();
loadUsers();
