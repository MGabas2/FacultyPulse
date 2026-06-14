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
    .select("id, student_id, role, name, email, section_id, sections(name), academic_rank, employment_type, is_active")
    .neq("role", "admin");

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
    const displayName    = u.name || u.student_id || "—";
    const roleLabel      = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const section        = u.sections?.name || "—";
    const employmentType = u.role === "teacher" ? (u.employment_type || "—") : "—";
    const isActive       = u.is_active !== false; // treat null/undefined as active
    const statusBadge    = isActive
      ? `<span class="badge done">Active</span>`
      : `<span class="badge pending">Inactive</span>`;

    tbody.innerHTML += `
      <tr style="${!isActive ? 'opacity:0.6;' : ''}">
        <td>${displayName}</td>
        <td>
          <span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>
        </td>
        <td>${u.email || "—"}</td>
        <td>${section}</td>
        <td>${employmentType}</td>
        <td>${statusBadge}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-secondary" style="font-size:12px; padding:5px 10px;"
            onclick="openEditModal('${u.id}')">
            Edit
          </button>
          <button class="btn-secondary" style="font-size:12px; padding:5px 10px; color:#dc2626; border-color:#dc2626;"
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
  const role           = document.getElementById("new-role").value;
  const studentFields  = document.getElementById("student-fields");
  const staffFields    = document.getElementById("staff-fields");
  const supSection     = document.getElementById("supervisor-section-group");
  const teacherExtras  = document.getElementById("teacher-extra-fields");

  studentFields.classList.add("hidden");
  staffFields.classList.add("hidden");
  supSection.style.display    = "none";
  teacherExtras.style.display = "none";

  if (role === "student") {
    studentFields.classList.remove("hidden");
  } else if (["teacher", "supervisor"].includes(role)) {
    staffFields.classList.remove("hidden");
    if (role === "supervisor") supSection.style.display = "block";
    if (role === "teacher")   teacherExtras.style.display = "block";
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

      // Teacher-specific fields
      if (role === "teacher") {
        const academicRank     = document.getElementById("new-academic-rank").value;
        const employmentType   = document.getElementById("new-employment-type").value;
        if (academicRank)    insertData.academic_rank    = academicRank;
        if (employmentType)  insertData.employment_type  = employmentType;
        insertData.is_active = true;
      }

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
  document.getElementById("new-role").value          = "";
  document.getElementById("new-student-id").value    = "";
  document.getElementById("new-name").value          = "";
  document.getElementById("new-email").value         = "";
  document.getElementById("new-password").value      = "";
  document.getElementById("new-academic-rank").value = "";
  document.getElementById("new-employment-type").value = "";
  document.getElementById("add-error").textContent   = "";
  document.getElementById("student-fields").classList.add("hidden");
  document.getElementById("staff-fields").classList.add("hidden");
  document.getElementById("teacher-extra-fields").style.display = "none";
  document.getElementById("add-modal").classList.remove("hidden");
}

function closeAddModal() {
  document.getElementById("add-modal").classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════
//  EDIT USER
// ══════════════════════════════════════════════════════════════
let editTargetId   = null;
let editTargetRole = null;

function openEditModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  editTargetId   = userId;
  editTargetRole = user.role;

  // Read-only fields
  document.getElementById("edit-role-display").value  =
    user.role.charAt(0).toUpperCase() + user.role.slice(1);
  document.getElementById("edit-email-display").value = user.email || "—";
  document.getElementById("edit-error").textContent   = "";

  // Show/hide editable fields based on role
  const nameGroup       = document.getElementById("edit-name-group");
  const sectionGroup    = document.getElementById("edit-section-group");
  const rankGroup       = document.getElementById("edit-rank-group");
  const employmentGroup = document.getElementById("edit-employment-group");
  const statusGroup     = document.getElementById("edit-status-group");

  // Reset all
  nameGroup.style.display       = "none";
  sectionGroup.style.display    = "none";
  rankGroup.style.display       = "none";
  employmentGroup.style.display = "none";
  statusGroup.style.display     = "none";

  if (user.role === "student") {
    sectionGroup.style.display = "block";
    // Pre-fill section dropdown
    const sel = document.getElementById("edit-section-id");
    sel.innerHTML = `<option value="">-- Select Section --</option>`;
    sections.forEach(s => {
      sel.innerHTML += `<option value="${s.id}" ${s.id === user.section_id ? "selected" : ""}>${s.name}</option>`;
    });

  } else if (user.role === "teacher") {
    nameGroup.style.display       = "block";
    rankGroup.style.display       = "block";
    employmentGroup.style.display = "block";
    statusGroup.style.display     = "block";

    document.getElementById("edit-name").value = user.name || "";

    // Pre-select academic rank
    const rankSel = document.getElementById("edit-academic-rank");
    rankSel.value = user.academic_rank || "";

    // Pre-select employment type
    const empSel = document.getElementById("edit-employment-type");
    empSel.value = user.employment_type || "";

    // Pre-select status
    document.getElementById("edit-status").value =
      user.is_active === false ? "false" : "true";

  } else {
    // Supervisor, Dept Head — name only
    nameGroup.style.display = "block";
    document.getElementById("edit-name").value = user.name || "";
  }

  document.getElementById("edit-modal").classList.remove("hidden");
}

async function saveEdit() {
  const errorEl  = document.getElementById("edit-error");
  const saveBtn  = document.getElementById("save-edit-btn");
  errorEl.textContent = "";

  if (!editTargetId) return;

  saveBtn.textContent = "Saving...";
  saveBtn.disabled    = true;

  try {
    const updates = {};

    if (editTargetRole === "student") {
      const sectionId = document.getElementById("edit-section-id").value;
      if (!sectionId) {
        errorEl.textContent = "Please select a section.";
        return;
      }
      updates.section_id = sectionId;

    } else if (editTargetRole === "teacher") {
      const name           = document.getElementById("edit-name").value.trim();
      const academicRank   = document.getElementById("edit-academic-rank").value;
      const employmentType = document.getElementById("edit-employment-type").value;
      const isActive       = document.getElementById("edit-status").value === "true";

      if (!name) { errorEl.textContent = "Full name is required."; return; }

      updates.name            = name;
      updates.academic_rank   = academicRank   || null;
      updates.employment_type = employmentType || null;
      updates.is_active       = isActive;

    } else {
      // Supervisor, Dept Head
      const name = document.getElementById("edit-name").value.trim();
      if (!name) { errorEl.textContent = "Full name is required."; return; }
      updates.name = name;
    }

    const { error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", editTargetId);

    if (error) {
      errorEl.textContent = "Failed to save: " + error.message;
      return;
    }

    closeEditModal();
    loadUsers();

  } catch (err) {
    errorEl.textContent = "Unexpected error: " + err.message;
    console.error(err);
  } finally {
    saveBtn.textContent = "Save Changes";
    saveBtn.disabled    = false;
  }
}

function closeEditModal() {
  document.getElementById("edit-modal").classList.add("hidden");
  editTargetId   = null;
  editTargetRole = null;
}

// ── Expose to HTML (sort buttons + table onclicks) ──
window.setSort         = setSort;
window.onNewRoleChange = onNewRoleChange;
window.autoUppercase   = autoUppercase;
window.confirmDelete   = confirmDelete;
window.openEditModal   = openEditModal;

// ── Attach all events ──
document.getElementById("add-user-btn").addEventListener("click", openAddModal);
document.getElementById("save-user-btn").addEventListener("click", saveUser);
document.getElementById("cancel-add-btn").addEventListener("click", closeAddModal);
document.getElementById("confirm-delete-btn").addEventListener("click", deleteUser);
document.getElementById("cancel-delete-btn").addEventListener("click", () => {
  document.getElementById("delete-modal").classList.add("hidden");
});
document.getElementById("save-edit-btn").addEventListener("click", saveEdit);
document.getElementById("cancel-edit-btn").addEventListener("click", closeEditModal);
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