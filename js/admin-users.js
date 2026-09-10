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
            onclick="confirmArchive('${u.id}', '${escHtml(displayName).replace(/'/g, "\\'")}')">
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

// ── Sort — click a column button to sort by it; click again to flip direction ──
let sortField = "name";
let sortAsc   = true;

function getSort() {
  return { field: sortField, asc: sortAsc };
}

function setSort(field) {
  if (sortField === field) {
    sortAsc = !sortAsc;
  } else {
    sortField = field;
    sortAsc   = true;
  }
  updateSortButtons();
  renderTable();
}

function updateSortButtons() {
  ["name", "role", "section"].forEach(f => {
    const btn   = document.getElementById(`sort-${f}`);
    const arrow = document.getElementById(`arrow-${f}`);
    if (btn)   btn.classList.toggle("active", f === sortField);
    if (arrow) arrow.textContent = f === sortField ? (sortAsc ? "↑" : "↓") : "";
  });

  // Compat: admin.html's Users tab uses a single "A–Z / Z–A" toggle button
  // (id="sort-az-btn") instead of per-column buttons. Keep its label in sync
  // whenever sort state changes, regardless of which UI triggered the change.
  const azBtn = document.getElementById("sort-az-btn");
  if (azBtn) azBtn.textContent = sortField === "name" ? (sortAsc ? "A–Z ↑" : "Z–A ↓") : "Sort: " + sortField;
}

// Compat shim for admin.html's single-button sort UI (always sorts by name, A-Z/Z-A only)
function toggleSortDir() {
  setSort("name");
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

      // ── Create their Supabase Auth login automatically ──
      // Falls back to the old "do it manually" message if the endpoint
      // isn't reachable at all — e.g. local dev under Live Server, where
      // this Vercel function doesn't exist. Never falls back to creating
      // the Auth account directly from the browser: that would require
      // the service_role key to be present client-side, which must never
      // happen regardless of environment.
      let authOutcomeMsg;
      const isLocalDev = ["127.0.0.1", "localhost"].includes(window.location.hostname);

      if (isLocalDev) {
        authOutcomeMsg =
          `\n\n⚠️ Running locally — the login-creation function only exists on Vercel.\n` +
          `Add their login manually in Supabase → Authentication → Users → Add User.\n\nEmail: ${email}\nPassword: ${password}`;
      } else {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          const resp = await fetch("/api/create-teacher-auth", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ email, password, name }),
          });
          const result = await resp.json();
          authOutcomeMsg = resp.ok
            ? "\n\nTheir login account was created automatically."
            : `\n\n⚠️ Login account was NOT created automatically: ${result.error || "unknown error"}.\n` +
              `Add it manually in Supabase → Authentication → Users → Add User.\n\nEmail: ${email}\nPassword: ${password}`;
        } catch (err) {
          authOutcomeMsg =
            `\n\n⚠️ Couldn't reach the login-creation service: ${err.message}.\n` +
            `Add it manually in Supabase → Authentication → Users → Add User.\n\nEmail: ${email}\nPassword: ${password}`;
        }
      }

      await fpAlert(`User "${name}" added to the system.${authOutcomeMsg}`, authOutcomeMsg.includes("⚠️") ? "warning" : "success");
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
//  XLSX IMPORT — "Student Profile" template (redesigned)
//
//  The registrar switched templates AND confirmed they cannot supply
//  teacher-assignment data going forward — not "haven't sent it yet",
//  genuinely can't provide it. That retires the old "Sheet 2" plan
//  (subjects linked to a teacher by email) outright; there's no data
//  source for it anymore, full stop.
//
//  This template is one row per student (no more duplicate-per-semester
//  rows) and has NO Academic_Year or Semester columns at all — the admin
//  picks an existing semester record at import time instead, and the
//  academic year is parsed out of that semester's label.
//
//  Each row also lists enrolled courses in wide columns (Course1/Units1
//  .. CourseN/UnitsN). Those are used to create subject placeholders
//  (course name + section + semester) with teacher_id left NULL — a
//  person still has to claim/assign each one afterward, but at least
//  the enrollment link now exists instead of not existing at all.
// ══════════════════════════════════════════════════════════════

const IMPORT_COLUMNS = {
  studentId:  ["ID No.", "Student_ID"],
  lastName:   ["Last Name", "Last_Name"],
  firstName:  ["First Name", "First_Name"],
  middleName: ["Middle Name", "Middle_Name"],
  program:    ["Degree Program", "Degree_Program"],
  yearLevel:  ["Year Level", "Year_Level"],
  email:      ["Email"],
};

function findHeaderKey(headerRow, aliases) {
  const lower = headerRow.map(h => String(h || "").trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.toLowerCase());
    if (idx !== -1) return headerRow[idx];
  }
  return null;
}

// Any header matching "Course1", "Course2", ... "CourseN" — the template
// doesn't fix a column count, so detect however many are actually there.
function findCourseColumns(headerRow) {
  return headerRow.filter(h => /^course\d+$/i.test(String(h || "").trim()));
}

// Sections already in the database use Roman numerals for year level
// (e.g. "BSInfoTech-III-2025-2026", from the previous template). This
// template gives plain digits (1-4) instead. Normalize so this year's
// import lands in the SAME sections rather than creating a parallel,
// disconnected "BSInfoTech-3-..." section nothing else points to.
const ROMAN_YEAR_LEVELS = { "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI" };
function normalizeYearLevel(value) {
  const str = String(value ?? "").trim();
  return ROMAN_YEAR_LEVELS[str] || str; // already Roman, or unrecognized — leave as-is
}

// Run up to `limit` async tasks concurrently over `items`
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Some registrar exports (typically Python/pandas-generated) write literal
// text like "None", "N/A", "nan", or "-" into blank cells instead of leaving
// them actually empty. Treat those as blank too, or they end up baked into
// names/emails as real data (e.g. "Balles, John Wayne None").
const BLANK_PLACEHOLDERS = new Set(["none", "n/a", "na", "nan", "null", "-", "—"]);
function cleanOptionalText(value) {
  const str = String(value ?? "").trim();
  return BLANK_PLACEHOLDERS.has(str.toLowerCase()) ? "" : str;
}

function extractAcademicYear(label) {
  const match = String(label || "").match(/(\d{4}-\d{4})/);
  return match ? match[1] : "";
}

function openImportPicker() {
  showImportModal();
  populateImportSemesterOptions();
}

// Semester is now picked from real semester records (Semester Management),
// not typed/guessed — fixes the earlier disconnect where the import's
// semester dropdown had nothing to do with the actual `semesters` table.
async function populateImportSemesterOptions() {
  const sel = document.getElementById("import-semester");
  if (!sel) return;
  sel.innerHTML = `<option value="">Loading semesters…</option>`;

  const { data, error } = await supabase
    .from("semesters").select("id, label, is_active")
    .order("label", { ascending: false });

  if (error || !data || data.length === 0) {
    sel.innerHTML = `<option value="">No semesters found — create one in Semester Management first</option>`;
    return;
  }

  sel.innerHTML = data.map(s =>
    `<option value="${s.id}"${s.is_active ? " selected" : ""}>${escHtml(s.label)}${s.is_active ? " (active)" : ""}</option>`
  ).join("");
}

async function handleImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;

  if (typeof XLSX === "undefined") {
    await fpAlert("The spreadsheet library failed to load. Check your connection and try again.", "error");
    return;
  }

  const semesterSelect = document.getElementById("import-semester");
  const semesterId     = semesterSelect?.value || "";
  const semesterLabel  = semesterSelect?.selectedOptions?.[0]?.textContent || "";
  const academicYear   = extractAcademicYear(semesterLabel);

  if (!semesterId) {
    setImportStatus("Pick a semester first.", true);
    return;
  }
  if (!academicYear) {
    setImportStatus(`Couldn't find a YYYY-YYYY academic year inside "${semesterLabel}". Section names need this — check how the semester was labeled.`, true);
    return;
  }

  hideImportPicker();
  setImportStatus("Reading file…");

  let workbook;
  try {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array" });
  } catch (err) {
    setImportStatus("Failed to read the file: " + err.message, true);
    return;
  }

  if (workbook.SheetNames.length > 1) {
    setImportStatus(
      `Note: this workbook has ${workbook.SheetNames.length} sheets. ` +
      `Only the first sheet ("${workbook.SheetNames[0]}") is imported.`,
      false, true
    );
  }

  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  if (rows.length === 0) {
    setImportStatus("That sheet has no data rows.", true);
    return;
  }

  const headerRow = Object.keys(rows[0]);
  const colMap = {};
  let missing = [];
  for (const [key, aliases] of Object.entries(IMPORT_COLUMNS)) {
    const found = findHeaderKey(headerRow, aliases);
    if (found) colMap[key] = found;
    else if (key !== "middleName" && key !== "email") missing.push(aliases[0]);
  }
  if (missing.length > 0) {
    setImportStatus(`Missing required column(s): ${missing.join(", ")}. Check the file matches the current template.`, true);
    return;
  }

  const courseColumns = findCourseColumns(headerRow);

  await runImport(rows, colMap, courseColumns, semesterId, academicYear);
}

async function runImport(rows, colMap, courseColumns, semesterId, academicYear) {
  const errors = [];
  const parsed = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // account for header row
    const studentId  = cleanOptionalText(row[colMap.studentId]);
    const lastName    = cleanOptionalText(row[colMap.lastName]);
    const firstName   = cleanOptionalText(row[colMap.firstName]);
    const middleName  = colMap.middleName ? cleanOptionalText(row[colMap.middleName]) : "";
    const program     = cleanOptionalText(row[colMap.program]);
    const yearLevel   = normalizeYearLevel(cleanOptionalText(row[colMap.yearLevel]));
    const email       = colMap.email ? cleanOptionalText(row[colMap.email]) : "";

    const rowErrors = [];
    if (!STUDENT_ID_FORMAT.test(studentId)) rowErrors.push("invalid/missing ID No.");
    if (!lastName)  rowErrors.push("missing Last Name");
    if (!firstName) rowErrors.push("missing First Name");
    if (!program)   rowErrors.push("missing Degree Program");
    if (!yearLevel) rowErrors.push("missing Year Level");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, studentId: studentId || "(blank)", issues: rowErrors.join(", ") });
      return;
    }

    const sectionName = `${program}-${yearLevel}-${academicYear}`;
    const name = middleName ? `${lastName}, ${firstName} ${middleName}` : `${lastName}, ${firstName}`;
    const courses = courseColumns.map(col => cleanOptionalText(row[col])).filter(Boolean);

    parsed.push({ studentId, name, email: email || null, sectionName, program, courses });
  });

  if (parsed.length === 0) {
    renderImportSummary({ sectionsCreated: 0, studentsAdded: 0, studentsPromoted: 0, duplicateRows: 0, subjectsCreated: 0, errors, totalRows: rows.length });
    return;
  }

  // De-dup by Student_ID as a safety net. This template is one row per
  // student, but a single duplicate slipping through (a manual edit, a
  // re-export glitch) would fail the WHOLE insert batch it lands in, not
  // just that one row — see the per-row fallback further down too.
  const seenIds = new Set();
  const dedupedParsed = [];
  let duplicateRows = 0;
  for (const p of parsed) {
    if (seenIds.has(p.studentId)) { duplicateRows++; continue; }
    seenIds.add(p.studentId);
    dedupedParsed.push(p);
  }

  try {
    // ── 1. Resolve sections (create any that don't exist) ──
    // Uses upsert with onConflict:'name' instead of select-then-insert.
    // The old select-then-insert pattern isn't atomic — it created a
    // duplicate section row every time the import ran, because nothing
    // stopped two "this section doesn't exist yet" checks from both being
    // true at once. This requires a UNIQUE constraint on sections.name:
    //   ALTER TABLE sections ADD CONSTRAINT sections_name_unique UNIQUE (name);
    // Without it, upsert's onConflict has nothing to match against and
    // Postgres will error loudly — which is the correct failure mode here,
    // not a silent fourth duplicate.
    setImportStatus(`Resolving sections for ${dedupedParsed.length} student row(s)…`);
    const uniqueSectionNames = [...new Set(dedupedParsed.map(p => p.sectionName))];
    const sectionMap = {}; // name -> id

    for (const batch of chunkArray(uniqueSectionNames, 200)) {
      const { data, error } = await supabase.from("sections").select("id, name").in("name", batch);
      if (error) throw new Error("Section lookup failed: " + error.message);
      (data || []).forEach(s => { sectionMap[s.name] = s.id; });
    }

    const missingSections = uniqueSectionNames
      .filter(n => !sectionMap[n])
      .map(n => {
        const owner = dedupedParsed.find(p => p.sectionName === n);
        return { name: n, department: owner.program };
      });

    let sectionsCreated = 0;
    if (missingSections.length > 0) {
      for (const batch of chunkArray(missingSections, 200)) {
        const { error } = await supabase
          .from("sections")
          .upsert(batch, { onConflict: "name", ignoreDuplicates: true });
        if (error) {
          throw new Error(
            "Section creation failed: " + error.message +
            (error.message?.includes("no unique or exclusion constraint")
              ? ' — run: ALTER TABLE sections ADD CONSTRAINT sections_name_unique UNIQUE (name);'
              : "")
          );
        }
      }
      sectionsCreated = missingSections.length;

      // Re-fetch to get the real ids — upsert with ignoreDuplicates:true
      // doesn't reliably return rows it skipped, so its own response can't
      // be trusted to build sectionMap from.
      for (const batch of chunkArray(missingSections.map(s => s.name), 200)) {
        const { data, error } = await supabase.from("sections").select("id, name").in("name", batch);
        if (error) throw new Error("Section lookup failed: " + error.message);
        (data || []).forEach(s => { sectionMap[s.name] = s.id; });
      }
    }

    // ── 2. Fetch ALL existing student_ids (paginated — default query cap is 1000 rows) ──
    setImportStatus("Checking for existing students…");
    const existingIds = new Set();
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("users").select("student_id")
        .eq("role", "student")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Existing-student lookup failed: " + error.message);
      (data || []).forEach(r => { if (r.student_id) existingIds.add(r.student_id); });
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    // ── 3. Split into new inserts vs. promotions (section_id update only) ──
    const toInsert = [];
    const toPromote = [];
    for (const p of dedupedParsed) {
      const sectionId = sectionMap[p.sectionName];
      if (!sectionId) {
        errors.push({ row: "-", studentId: p.studentId, issues: `section "${p.sectionName}" could not be resolved` });
        continue;
      }
      if (existingIds.has(p.studentId)) {
        toPromote.push({ studentId: p.studentId, sectionId });
      } else {
        toInsert.push({
          student_id: p.studentId, name: p.name, email: p.email,
          role: "student", section_id: sectionId,
        });
      }
    }

    // ── 4. Insert new students ──
    let studentsAdded = 0;
    setImportStatus(`Adding ${toInsert.length} new student(s)…`);
    for (const batch of chunkArray(toInsert, 500)) {
      if (batch.length === 0) continue;
      const { error } = await supabase.from("users").insert(batch);
      if (!error) {
        studentsAdded += batch.length;
        continue;
      }
      // Batch failed — a single bad row (e.g. an unexpected duplicate) fails
      // the whole INSERT statement. Fall back to one-at-a-time for this
      // batch so the other 499 good rows aren't lost with it.
      for (const row of batch) {
        const { error: rowError } = await supabase.from("users").insert(row);
        if (rowError) {
          errors.push({ row: "-", studentId: row.student_id, issues: "insert failed: " + rowError.message });
        } else {
          studentsAdded++;
        }
      }
    }

    // ── 5. Promote existing students (section_id only — never touch name/email,
    //        which could silently undo an approved email-change request) ──
    setImportStatus(`Updating section for ${toPromote.length} returning student(s)…`);
    let studentsPromoted = 0;
    await runWithConcurrency(toPromote, 15, async (p) => {
      const { error } = await supabase
        .from("users").update({ section_id: p.sectionId })
        .eq("student_id", p.studentId).eq("role", "student");
      if (error) {
        errors.push({ row: "-", studentId: p.studentId, issues: "promotion failed: " + error.message });
      } else {
        studentsPromoted++;
      }
    });

    // ── 6. Create subject placeholders from the course columns ──
    // teacher_id is deliberately left NULL — the registrar cannot supply
    // teacher-assignment data, so there's nothing reliable to set it from.
    // A person still has to claim/assign each subject to a teacher.
    // Requires a UNIQUE constraint on (name, section_id, semester_id):
    //   ALTER TABLE subjects ADD CONSTRAINT subjects_name_section_semester_unique
    //     UNIQUE (name, section_id, semester_id);
    // Upsert omits teacher_id from the payload, so re-running this import
    // later (e.g. next week with more students) refreshes enrolled_count
    // without wiping out a teacher assignment someone made in the meantime.
    setImportStatus("Resolving course subjects…");
    const subjectMap = new Map(); // "course|sectionId" -> row
    for (const p of dedupedParsed) {
      const sectionId = sectionMap[p.sectionName];
      if (!sectionId) continue; // already recorded as an error above
      for (const courseName of p.courses) {
        const key = `${courseName}|${sectionId}`;
        if (!subjectMap.has(key)) {
          subjectMap.set(key, { name: courseName, section_id: sectionId, semester_id: semesterId, enrolled_count: 0 });
        }
        subjectMap.get(key).enrolled_count++;
      }
    }

    let subjectsCreated = 0;
    const subjectRows = [...subjectMap.values()];
    if (subjectRows.length > 0) {
      for (const batch of chunkArray(subjectRows, 200)) {
        const { error } = await supabase
          .from("subjects")
          .upsert(batch, { onConflict: "name,section_id,semester_id" });
        if (error) {
          throw new Error(
            "Subject creation failed: " + error.message +
            (error.message?.includes("no unique or exclusion constraint")
              ? ' — run: ALTER TABLE subjects ADD CONSTRAINT subjects_name_section_semester_unique UNIQUE (name, section_id, semester_id);'
              : "")
          );
        }
      }
      subjectsCreated = subjectRows.length;
    }

    renderImportSummary({ sectionsCreated, studentsAdded, studentsPromoted, duplicateRows, subjectsCreated, errors, totalRows: rows.length });

    await loadSections();
    await loadUsers();
  } catch (err) {
    setImportStatus("Import stopped: " + err.message, true);
  }
}

function showImportModal() {
  document.getElementById("import-modal")?.classList.remove("hidden");
  document.getElementById("import-summary").innerHTML = "";
  document.getElementById("import-status").textContent = "";
  document.getElementById("import-status").style.color = "";
  const picker = document.getElementById("import-picker");
  if (picker) picker.style.display = "block";
}

// Hide the semester/choose-file step once processing has started
function hideImportPicker() {
  const picker = document.getElementById("import-picker");
  if (picker) picker.style.display = "none";
}

function setImportStatus(text, isError = false, isNote = false) {
  const el = document.getElementById("import-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#dc2626" : isNote ? "#d97706" : "#475569";
}

function renderImportSummary({ sectionsCreated, studentsAdded, studentsPromoted, duplicateRows = 0, subjectsCreated = 0, errors, totalRows }) {
  setImportStatus(`Done — processed ${totalRows} row(s).`);
  const box = document.getElementById("import-summary");
  if (!box) return;

  let html = `
    <ul style="margin:8px 0 0; padding-left:18px; font-size:13px; line-height:1.8;">
      <li>${sectionsCreated} section(s) created</li>
      <li>${studentsAdded} new student(s) added</li>
      <li>${studentsPromoted} returning student(s) moved to their new section</li>
      ${duplicateRows > 0 ? `<li>${duplicateRows} duplicate row(s) for the same student collapsed to one</li>` : ""}
      <li>${subjectsCreated} course subject(s) resolved — <b>no teacher assigned yet</b>, that still needs to be done manually</li>
      <li style="${errors.length ? "color:#dc2626;" : ""}">${errors.length} row(s) skipped due to issues</li>
    </ul>
  `;

  if (errors.length > 0) {
    const shown = errors.slice(0, 50);
    html += `
      <p style="font-size:12px; font-weight:600; margin:14px 0 6px; color:#dc2626;">
        Skipped rows${errors.length > shown.length ? ` (showing first ${shown.length} of ${errors.length})` : ""}:
      </p>
      <div style="max-height:180px; overflow-y:auto; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; background:#fef2f2;">
        ${shown.map(e => `
          <div style="font-size:11px; color:#991b1b; margin-bottom:4px;">
            Row ${e.row} — <code>${escHtml(e.studentId)}</code>: ${escHtml(e.issues)}
          </div>
        `).join("")}
      </div>
    `;
  }

  box.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
//  EXPOSE + EVENTS
// ══════════════════════════════════════════════════════════════
window.setSort          = setSort;
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

document.getElementById("import-users-btn")?.addEventListener("click", openImportPicker);
document.getElementById("import-choose-file-btn")?.addEventListener("click", () => {
  document.getElementById("import-file-input")?.click();
});
document.getElementById("import-file-input")?.addEventListener("change", handleImportFile);
document.getElementById("close-import-btn")?.addEventListener("click", () => {
  document.getElementById("import-modal").classList.add("hidden");
});

loadSections();
loadUsers();