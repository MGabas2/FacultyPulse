// ============================================================
//  FacultyPulse — Admin User Management
//  Add, Edit, Archive users (no hard deletes per QA policy)
// ============================================================

function escHtml(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
import { supabase } from "./supabase.js";
import { fpAlert, fpConfirm } from "./modal.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../index.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + sessionStorage.getItem("name");

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;

const ACADEMIC_RANKS = [
  "Instructor I", "Instructor II", "Instructor III",
  "Assistant Professor I", "Assistant Professor II",
  "Assistant Professor III", "Assistant Professor IV",
  "Associate Professor I", "Associate Professor II",
  "Associate Professor III", "Associate Professor IV",
  "Associate Professor V",
  "Professor I", "Professor II", "Professor III",
  "Professor IV", "Professor V", "Professor VI",
];

// ── State ──
let allUsers        = [];
let sections        = [];
let editTargetId    = null;
let archiveTargetId = null;
let currentPage     = 1;
const PAGE_SIZE     = 10;

// ══════════════════════════════════════════════════════════════
//  LOAD SECTIONS
// ══════════════════════════════════════════════════════════════
async function loadSections() {
  const { data } = await supabase.from("sections").select("id, name").order("name");
  sections = data || [];

  const filterSection = document.getElementById("filter-section");
  sections.forEach(s => {
    filterSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  const newSection = document.getElementById("new-section-id");
  const supSection = document.getElementById("new-supervisor-section");
  sections.forEach(s => {
    newSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    supSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  // Populate edit-modal section dropdown
  const editSection = document.getElementById("edit-section-id");
  if (editSection) {
    sections.forEach(s => {
      editSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
  }

  // Populate academic rank dropdowns
  ["new-academic-rank", "edit-academic-rank"].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) {
      ACADEMIC_RANKS.forEach(rank => {
        sel.innerHTML += `<option value="${rank}">${rank}</option>`;
      });
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  LOAD USERS
// ══════════════════════════════════════════════════════════════
async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("users")
    .select("id, student_id, role, name, email, section_id, is_active, academic_rank, employment_type, sections(name)");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error loading users.</td></tr>`;
    console.error(error);
    return;
  }

  allUsers = data || [];
  renderTable();
}

// ── Update table headers based on active role filter ──
function updateTableHeaders(role) {
  const thead = document.getElementById("users-thead");
  if (!thead) return;

  const headers = {
    teacher:    ["Name", "ID", "Rank", "Email", "Status", "Action"],
    student:    ["Name", "Student ID", "Section", "Email", "Status", "Action"],
    supervisor: ["Name", "Email", "Role", "—", "Status", "Action"],
    admin:      ["Name", "Email", "Role", "—", "Status", "Action"],
    "":         ["Name", "ID / Student ID", "Role", "Email", "Status", "Action"],
  };

  const cols = headers[role] || headers[""];
  thead.innerHTML = `<tr>${cols.map(h => `<th>${h}</th>`).join("")}</tr>`;
}

// ══════════════════════════════════════════════════════════════
//  RENDER TABLE
// ══════════════════════════════════════════════════════════════
function renderTable() {
  const search        = document.getElementById("search-input").value.toLowerCase();
  const filterRole    = document.getElementById("filter-role").value;
  const filterSection = document.getElementById("filter-section").value;
  const filterStatus  = document.getElementById("filter-status-users")?.value || "";

  // Update headers to match current role filter
  updateTableHeaders(filterRole);

  let filtered = allUsers.filter(u => {
    if (u.role === "admin") return false;   // admins not shown in user management
    const nameOrId     = `${u.name || ""} ${u.student_id || ""} ${u.email || ""}`.toLowerCase();
    const matchSearch  = !search        || nameOrId.includes(search);
    const matchRole    = !filterRole    || u.role === filterRole;
    const matchSection = !filterSection || u.section_id === filterSection;
    const isActive     = u.is_active !== false;
    const matchStatus  = !filterStatus
      || (filterStatus === "active"   &&  isActive)
      || (filterStatus === "inactive" && !isActive);
    return matchSearch && matchRole && matchSection && matchStatus;
  });

  // Sort
  const { field, asc } = getSort();
  filtered.sort((a, b) => {
    let valA, valB;
    if (field === "name") {
      valA = (a.name || a.student_id || "").toLowerCase();
      valB = (b.name || b.student_id || "").toLowerCase();
    } else if (field === "role") {
      valA = a.role; valB = b.role;
    } else if (field === "section") {
      valA = (a.sections?.name || "").toLowerCase();
      valB = (b.sections?.name || "").toLowerCase();
    }
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  if (window._lastFilteredCount !== filtered.length) currentPage = 1;
  window._lastFilteredCount = filtered.length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx   = (currentPage - 1) * PAGE_SIZE;
  const pageItems  = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  document.getElementById("user-count").textContent =
    filtered.length === 0
      ? "No users found."
      : `Showing ${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, filtered.length)} of ${filtered.length} users`;

  const tbody = document.getElementById("users-tbody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No users found.</td></tr>`;
    renderPagination(0);
    return;
  }

  tbody.innerHTML = "";
  pageItems.forEach(u => {
    const displayName = u.name || u.student_id || "—";
    const roleLabel   = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const section     = u.sections?.name || "—";
    const isActive    = u.is_active !== false;

    // col1 = Name, col2 = ID/StudentID, col3 = rank/role/section, col4 = email/type
    let col1, col2, col3, col4;
    const teacherIdPlaceholder = `<span style="color:#94a3b8; font-size:11px;" title="Faculty ID format TBD">— (TBD)</span>`;

    if (!filterRole) {
      // All roles — show ID only where relevant
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      if (u.role === "student") {
        col2 = u.student_id
          ? `<code style="font-size:11px;">${escHtml(u.student_id)}</code>`
          : "—";
      } else if (u.role === "teacher") {
        col2 = teacherIdPlaceholder;
      } else {
        col2 = `<span style="color:#cbd5e1; font-size:11px;">—</span>`;
      }
      col3 = `<span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>`;
      col4 = u.email || "—";

    } else if (filterRole === "teacher") {
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = teacherIdPlaceholder;
      col3 = u.academic_rank
        ? `<span class="badge ${getRoleBadgeClass(u.role)}" style="font-size:11px;">${escHtml(u.academic_rank)}</span>`
        : "—";
      col4 = u.email || "—";

    } else if (filterRole === "student") {
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = u.student_id
        ? `<code style="font-size:11px;">${escHtml(u.student_id)}</code>`
        : "—";
      col3 = section;
      col4 = u.email || "—";

    } else {
      // supervisor / admin — no ID column, use col2 for email, col3 for role badge
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = u.email || "—";
      col3 = `<span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>`;
      col4 = "—";
    }

    tbody.innerHTML += `
      <tr style="opacity:${isActive ? 1 : 0.55};">
        <td>${col1}</td>
        <td>${col2}</td>
        <td>${col3}</td>
        <td>${col4}</td>
        <td>
          <span class="badge ${isActive ? "done" : "not-submitted"}">
            ${isActive ? "Active" : "Archived"}
          </span>
        </td>
        <td style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
          <button style="font-size:11px; padding:4px 9px; background:#1a56db; color:white; border:none; border-radius:4px; cursor:pointer;"
            onclick="openEditModal('${u.id}')">
            ✏️ Edit
          </button>
          <button class="btn-secondary" style="font-size:11px; padding:4px 9px; ${!isActive ? "display:none;" : ""}"
            onclick="confirmArchive('${u.id}', \'${displayName.replace(/\'/g, "\\'")}\')">
            📦 Archive
          </button>
          <button class="btn-secondary" style="font-size:11px; padding:4px 9px; ${isActive ? "display:none;" : ""}"
            onclick="restoreUser('${u.id}')">
            ♻️ Restore
          </button>
        </td>
      </tr>
    `;
  });

  renderPagination(totalPages);
}

// ══════════════════════════════════════════════════════════════
//  PAGINATION
// ══════════════════════════════════════════════════════════════
function renderPagination(totalPages) {
  const container = document.getElementById("users-page-buttons");
  if (!container) return;
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const makeBtn = (label, page, opts = {}) => {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (opts.active ? " active" : "");
    btn.textContent = label;
    btn.disabled = !!opts.disabled;
    btn.onclick = () => { currentPage = page; renderTable(); };
    return btn;
  };

  container.appendChild(makeBtn("← Prev", currentPage - 1, { disabled: currentPage === 1 }));
  let start = Math.max(1, currentPage - 2);
  let end   = Math.min(totalPages, start + 4);
  start     = Math.max(1, end - 4);
  if (start > 1) {
    container.appendChild(makeBtn("1", 1));
    if (start > 2) container.appendChild(makeBtn("…", currentPage, { disabled: true }));
  }
  for (let p = start; p <= end; p++) {
    container.appendChild(makeBtn(String(p), p, { active: p === currentPage }));
  }
  if (end < totalPages) {
    if (end < totalPages - 1) container.appendChild(makeBtn("…", currentPage, { disabled: true }));
    container.appendChild(makeBtn(String(totalPages), totalPages));
  }
  container.appendChild(makeBtn("Next →", currentPage + 1, { disabled: currentPage === totalPages }));
}

function getRoleBadgeClass(role) {
  return role === "admin" ? "badge-admin"
       : role === "teacher" ? "badge-teacher"
       : role === "supervisor" ? "badge-supervisor"
       : "pending";
}

// ── Sort — A-Z / Z-A toggle (name only) ──
let sortAsc = true;

function getSort() {
  return { field: "name", asc: sortAsc };
}

function toggleSortDir() {
  sortAsc = !sortAsc;
  const btn = document.getElementById("sort-az-btn");
  if (btn) btn.textContent = sortAsc ? "A–Z ↑" : "Z–A ↓";
  renderTable();
}

// ══════════════════════════════════════════════════════════════
//  ADD USER MODAL
// ══════════════════════════════════════════════════════════════
function onNewRoleChange() {
  const role          = document.getElementById("new-role").value;
  const studentFields = document.getElementById("student-fields");
  const staffFields   = document.getElementById("staff-fields");
  const supSection    = document.getElementById("supervisor-section-group");
  const rankGroup     = document.getElementById("new-rank-group");

  studentFields.classList.add("hidden");
  staffFields.classList.add("hidden");
  supSection.style.display = "none";
  if (rankGroup) rankGroup.style.display = "none";

  if (role === "student") {
    studentFields.classList.remove("hidden");
  } else if (["teacher","supervisor","admin"].includes(role)) {
    staffFields.classList.remove("hidden");
    if (role === "supervisor") supSection.style.display = "block";
    if (role === "teacher" && rankGroup) rankGroup.style.display = "block";
    const empGroup = document.getElementById("new-employment-group");
    if (role === "teacher" && empGroup) empGroup.style.display = "block";
    else if (empGroup) empGroup.style.display = "none";
  }
}

function autoUppercase(input) {
  const cursor = input.selectionStart;
  input.value  = input.value.toUpperCase();
  input.setSelectionRange(cursor, cursor);
}

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
        errorEl.textContent = "Invalid format. Use: 2023-1154-AB"; return;
      }
      if (!sectionId) { errorEl.textContent = "Please select a section."; return; }

      const { error } = await supabase.from("users").insert({
        student_id: studentId, role: "student", section_id: sectionId,
      });
      if (error) {
        errorEl.textContent = error.code === "23505"
          ? "That Student ID already exists." : "Failed to save: " + error.message;
        return;
      }

    } else {
      const name          = document.getElementById("new-name").value.trim();
      const email         = document.getElementById("new-email").value.trim();
      const password      = document.getElementById("new-password").value.trim();
      const supSec        = document.getElementById("new-supervisor-section").value;
      const academicRank  = document.getElementById("new-academic-rank")?.value || null;
      const employmentType = document.getElementById("new-employment-type")?.value || null;

      if (!name)     { errorEl.textContent = "Full name is required."; return; }
      if (!email)    { errorEl.textContent = "Email is required."; return; }
      if (!password) { errorEl.textContent = "Password is required."; return; }

      const insertData = {
        role, name, email,
        section_id:      role === "supervisor" ? supSec || null : null,
        academic_rank:   academicRank || null,
        employment_type: employmentType || null,
      };

      const { error: insertError } = await supabase.from("users").insert(insertData);
      if (insertError) {
        errorEl.textContent = insertError.code === "23505"
          ? "That email already exists." : "Failed to save: " + insertError.message;
        return;
      }

      await fpAlert(
        `User "${name}" added to the system.\n\nRemember to also create their login account in:\nSupabase → Authentication → Users → Add User\n\nEmail: ${email}\nPassword: ${password}`,
        "success"
      );
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

function openAddModal() {
  document.getElementById("new-role").value      = "";
  document.getElementById("new-student-id").value = "";
  document.getElementById("new-name").value      = "";
  document.getElementById("new-email").value     = "";
  document.getElementById("new-password").value  = "";
  document.getElementById("add-error").textContent = "";
  document.getElementById("student-fields").classList.add("hidden");
  document.getElementById("staff-fields").classList.add("hidden");
  if (document.getElementById("new-rank-group"))
    document.getElementById("new-rank-group").style.display = "none";
  document.getElementById("add-modal").classList.remove("hidden");
}

function closeAddModal() {
  document.getElementById("add-modal").classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════
//  EDIT USER MODAL
// ══════════════════════════════════════════════════════════════
function openEditModal(userId) {
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;

  editTargetId = userId;

  document.getElementById("edit-name").value          = u.name || "";
  document.getElementById("edit-email").value         = u.email || "";
  document.getElementById("edit-role-display").textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
  document.getElementById("edit-section-id").value    = u.section_id || "";
  document.getElementById("edit-academic-rank").value = u.academic_rank || "";
  document.getElementById("edit-employment-type").value = u.employment_type || "";
  document.getElementById("edit-is-active").value     = u.is_active !== false ? "active" : "inactive";
  document.getElementById("edit-error").textContent   = "";

  // Show/hide rank + section fields based on role
  const isTeacher    = u.role === "teacher";
  const isStudent    = u.role === "student";
  document.getElementById("edit-rank-row").style.display       = isTeacher ? "block" : "none";
  document.getElementById("edit-employment-row").style.display  = isTeacher ? "block" : "none";
  document.getElementById("edit-section-row").style.display     = isStudent ? "block" : "none";
  document.getElementById("edit-name-row").style.display        = isStudent ? "none"  : "block";
  document.getElementById("edit-email-row").style.display       = isStudent ? "none"  : "block";

  document.getElementById("edit-modal").classList.remove("hidden");


}

async function saveEdit() {
  if (!editTargetId) return;
  const errorEl = document.getElementById("edit-error");
  const saveBtn = document.getElementById("save-edit-btn");
  errorEl.textContent = "";

  const u = allUsers.find(x => x.id === editTargetId);
  if (!u) return;

  const updates = {
    is_active: document.getElementById("edit-is-active").value === "active",
  };

  if (u.role !== "student") {
    const name  = document.getElementById("edit-name").value.trim();
    const email = document.getElementById("edit-email").value.trim();
    if (!name)  { errorEl.textContent = "Name is required."; return; }
    if (!email) { errorEl.textContent = "Email is required."; return; }
    updates.name  = name;
    updates.email = email;
  }

  if (u.role === "teacher") {
    updates.academic_rank   = document.getElementById("edit-academic-rank").value || null;
    updates.employment_type = document.getElementById("edit-employment-type").value || null;
  }

  if (u.role === "student") {
    const secId = document.getElementById("edit-section-id").value;
    if (secId) updates.section_id = secId;
  }

  saveBtn.textContent = "Saving...";
  saveBtn.disabled    = true;

  try {
    const { error } = await supabase.from("users").update(updates).eq("id", editTargetId);
    if (error) {
      errorEl.textContent = error.code === "23505"
        ? "That email is already in use." : "Failed to save: " + error.message;
      return;
    }

    // Update local cache
    const idx = allUsers.findIndex(x => x.id === editTargetId);
    if (idx !== -1) Object.assign(allUsers[idx], updates);

    closeEditModal();
    renderTable();
    await fpAlert("User updated successfully.", "success");
  } catch (err) {
    errorEl.textContent = "Unexpected error: " + err.message;
  } finally {
    saveBtn.textContent = "Save Changes";
    saveBtn.disabled    = false;
  }
}

function closeEditModal() {
  document.getElementById("edit-modal").classList.add("hidden");
  editTargetId = null;
}

// ══════════════════════════════════════════════════════════════
//  ARCHIVE (replaces Delete) — soft-delete, data preserved
// ══════════════════════════════════════════════════════════════
function confirmArchive(userId, userName) {
  archiveTargetId = userId;
  document.getElementById("archive-name").textContent = userName;
  document.getElementById("archive-modal").classList.remove("hidden");
}

async function archiveUser() {
  if (!archiveTargetId) return;

  const { error } = await supabase
    .from("users")
    .update({ is_active: false })
    .eq("id", archiveTargetId);

  if (error) {
    await fpAlert("Failed to archive user: " + error.message, "error");
    return;
  }

  document.getElementById("archive-modal").classList.add("hidden");

  // Update local cache
  const idx = allUsers.findIndex(u => u.id === archiveTargetId);
  if (idx !== -1) allUsers[idx].is_active = false;
  archiveTargetId = null;
  renderTable();
}

async function restoreUser(userId) {
  const confirmed = await fpConfirm("Restore this user to Active status?", {
    confirmLabel: "Restore", confirmStyle: "fp-btn-success"
  });
  if (!confirmed) return;

  const { error } = await supabase
    .from("users").update({ is_active: true }).eq("id", userId);

  if (error) { await fpAlert("Failed to restore: " + error.message, "error"); return; }

  const idx = allUsers.findIndex(u => u.id === userId);
  if (idx !== -1) allUsers[idx].is_active = true;
  renderTable();
}

// ══════════════════════════════════════════════════════════════
//  EXPOSE + EVENTS
// ══════════════════════════════════════════════════════════════
window.toggleSortDir    = toggleSortDir;
window.onNewRoleChange  = onNewRoleChange;
window.autoUppercase    = autoUppercase;
window.openEditModal    = openEditModal;
window.confirmArchive   = confirmArchive;
window.restoreUser      = restoreUser;

document.getElementById("add-user-btn").addEventListener("click", openAddModal);
document.getElementById("save-user-btn").addEventListener("click", saveUser);
document.getElementById("cancel-add-btn").addEventListener("click", closeAddModal);
document.getElementById("save-edit-btn")?.addEventListener("click", saveEdit);
document.getElementById("cancel-edit-btn")?.addEventListener("click", closeEditModal);
document.getElementById("confirm-archive-btn")?.addEventListener("click", archiveUser);
document.getElementById("cancel-archive-btn")?.addEventListener("click", () => {
  document.getElementById("archive-modal").classList.add("hidden");
});
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

document.getElementById("search-input").addEventListener("input", renderTable);
document.getElementById("filter-role").addEventListener("change", renderTable);
document.getElementById("filter-section").addEventListener("change", renderTable);
document.getElementById("filter-status-users")?.addEventListener("change", renderTable);
// sort-az-btn uses onclick in HTML — no addEventListener needed

loadSections();
loadUsers();