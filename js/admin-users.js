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
import { ORG_DEPARTMENTS, departmentLabel, orgDepartmentOf } from "./departments.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../staff.html";
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

// ── Organizational departments (as of 2026-10-09) ──
// These are REAL administrative units, distinct from program/section codes
// (BSIT, BSED, BSA, BSInfoTech, BSTM, BSHM, ...). One org department can
// cover several programs (HTM -> BSTM + BSHM, TEd -> BEED + BSED), which is
// exactly why faculty/supervisor "department" can no longer be the same
// string as a section's program code — that was the source of the earlier
// BSTM/BSHM ambiguity. This list is for TEACHER/SUPERVISOR accounts only.
//
// Known consequence, accepted deliberately (2026-10-09): Subject
// Assignment's per-department teacher filter (admin.js, loadTeachersForAssignment)
// still matches users.department against a SECTION's program-code department
// — with teacher.department now an org unit, filtering Subject Assignment by
// a specific program (e.g. "BSIT") will show no teachers. Use "All
// Departments" there and find the teacher by name/search until that panel is
// updated to understand the org-department -> program mapping too.
// (ORG_DEPARTMENTS now comes from ./departments.js — shared with admin.js.)

// ── State ──
let allUsers        = [];
let sections        = [];
let departments      = []; // program codes (sections.department) — student section filtering only
let editTargetId    = null;
let archiveTargetId = null;
let currentPage     = 1;
const PAGE_SIZE     = 10;

// ══════════════════════════════════════════════════════════════
//  LOAD DEPARTMENTS
//  Two separate vocabularies, deliberately kept apart:
//   - Program codes (sections.department: BSIT, BSED, BSA, ...) — used only
//     to filter the student Add-User form's Section list.
//   - Org departments (ORG_DEPARTMENTS, above) — used for teacher/supervisor
//     accounts, since one org department can span several programs.
// ══════════════════════════════════════════════════════════════
async function loadDepartments() {
  const { data, error } = await supabase.from("sections").select("department");
  if (error) { console.error("Failed to load departments:", error); return; }

  departments = [...new Set((data || []).map(r => r.department).filter(Boolean))].sort();

  ["new-department", "edit-department"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">-- Select Department --</option>` +
      ORG_DEPARTMENTS.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join("");
    if (ORG_DEPARTMENTS.includes(current)) sel.value = current;
  });
}

// ══════════════════════════════════════════════════════════════
//  LOAD SECTIONS
// ══════════════════════════════════════════════════════════════
async function loadSections() {
  // department is selected here too — the student Add-User form filters
  // its Section list by the department picked above it.
  const { data } = await supabase.from("sections").select("id, name, department").order("name");
  sections = data || [];

  const filterSection = document.getElementById("filter-section");
  sections.forEach(s => {
    filterSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  const newSection = document.getElementById("new-section-id");
  sections.forEach(s => {
    newSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });

  // Populate edit-modal section dropdown
  const editSection = document.getElementById("edit-section-id");
  if (editSection) {
    sections.forEach(s => {
      editSection.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
  }

  populateStudentDepartmentOptions();

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

// ── Add Student: Department → Section → Courses ─────────────────────────
// The Department dropdown shows real DEPARTMENT names (IT, HTM, TEd, …), not
// program codes. A department's courses are the subjects offered to every
// section whose program maps to it (departments.js). "Minor / general"
// courses are subjects of sections whose program has NO owning department
// (PEU = general ed / PE, or anything unmapped) — those are offered under
// every department. Subjects belong to sections (subjects.section_id), and
// students enroll individually through student_subjects.
let newStudentPicked = new Set();   // subject ids currently ticked in the Add form
let newStudentSubjects = [];        // subjects loaded for the current department

const sectionDept = (s) => orgDepartmentOf(s.department);

function populateStudentDepartmentOptions() {
  const sel = document.getElementById("new-student-department");
  if (!sel) return;
  const current = sel.value;
  const present = [...new Set(sections.map(sectionDept).filter(Boolean))]
    .sort((a, b) => ORG_DEPARTMENTS.indexOf(a) - ORG_DEPARTMENTS.indexOf(b));
  sel.innerHTML = `<option value="">-- Select Department --</option>` +
    present.map(d => `<option value="${escHtml(d)}">${escHtml(departmentLabel(d))}</option>`).join("");
  if (present.includes(current)) sel.value = current;
}

// Narrows the Section dropdown to the chosen department (all sections when
// blank), then reloads the course checklist.
function onNewStudentDepartmentChange() {
  const dept = document.getElementById("new-student-department")?.value || "";
  const sel  = document.getElementById("new-section-id");
  if (!sel) return;

  const currentValue = sel.value;
  const pool = dept ? sections.filter(s => sectionDept(s) === dept) : sections;

  sel.innerHTML = `<option value="">-- Select Section --</option>` +
    pool.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join("");
  if ([...sel.options].some(o => o.value === currentValue)) sel.value = currentValue;

  newStudentPicked = new Set();
  loadNewStudentSubjects();
}
window.onNewStudentDepartmentChange = onNewStudentDepartmentChange;

// Picking a section ticks that section's own courses (the student's usual
// load); the admin can then add or untick anything from the department list
// or the minor/general list.
function onNewSectionChange() {
  const sectionId = document.getElementById("new-section-id")?.value || "";
  newStudentPicked = new Set(
    newStudentSubjects.filter(s => s.section_id === sectionId).map(s => s.id)
  );
  renderNewStudentSubjects();
}
window.onNewSectionChange = onNewSectionChange;

async function loadNewStudentSubjects() {
  const container = document.getElementById("new-student-subjects-list");
  if (!container) return;
  const dept = document.getElementById("new-student-department")?.value || "";

  newStudentSubjects = [];
  if (!dept) {
    container.innerHTML = `<p style="color:#888; margin:0;">Select a department to see its courses.</p>`;
    return;
  }

  container.innerHTML = `<p style="color:#888; margin:0;">Loading courses…</p>`;

  const { data: sem } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).maybeSingle();
  if (!sem) {
    container.innerHTML = `<p style="color:#b91c1c; margin:0;">No active semester — set one in Semester Management first.</p>`;
    return;
  }

  const deptSectionIds  = sections.filter(s => sectionDept(s) === dept).map(s => s.id);
  const minorSectionIds = sections.filter(s => !sectionDept(s)).map(s => s.id);
  const ids = [...deptSectionIds, ...minorSectionIds];
  if (ids.length === 0) {
    container.innerHTML = `<p style="color:#888; margin:0;">No sections found for this department.</p>`;
    return;
  }

  const { data: subs, error } = await supabase
    .from("subjects").select("id, name, section_id")
    .eq("semester_id", sem.id).in("section_id", ids).order("name").limit(1000);
  if (error) {
    container.innerHTML = `<p style="color:#b91c1c; margin:0;">Failed to load courses: ${escHtml(error.message)}</p>`;
    return;
  }

  const minorSet = new Set(minorSectionIds);
  newStudentSubjects = (subs || []).map(s => ({ ...s, minor: minorSet.has(s.section_id) }));
  newStudentSubjects.semLabel = sem.label;
  onNewSectionChange(); // pre-ticks the chosen section's subjects (if any) and renders
}

function renderNewStudentSubjects() {
  const container = document.getElementById("new-student-subjects-list");
  if (!container) return;
  const dept = document.getElementById("new-student-department")?.value || "";
  if (!dept) return;

  if (newStudentSubjects.length === 0) {
    container.innerHTML = `<p style="color:#888; margin:0;">No courses offered for this department yet${newStudentSubjects.semLabel ? " in " + escHtml(newStudentSubjects.semLabel) : ""}.</p>`;
    return;
  }

  const q = (document.getElementById("new-student-subject-search")?.value || "").trim().toLowerCase();
  const secName = Object.fromEntries(sections.map(s => [s.id, s.name]));
  const visible = newStudentSubjects.filter(s =>
    !q || s.name.toLowerCase().includes(q) || (secName[s.section_id] || "").toLowerCase().includes(q));

  const group = (title, list) => {
    if (list.length === 0) return "";
    const bySection = {};
    list.forEach(s => (bySection[s.section_id] ||= []).push(s));
    return `<div style="font-weight:600; font-size:12px; margin:10px 0 2px; color:#475569;">${escHtml(title)}</div>` +
      Object.entries(bySection).map(([sid, items]) => `
        <div style="font-size:11px; color:#94a3b8; margin:6px 0 1px;">${escHtml(secName[sid] || "—")}</div>
        ${items.map(s => `
          <label style="display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer;">
            <input type="checkbox" class="new-student-subject-cb" value="${s.id}"
              ${newStudentPicked.has(s.id) ? "checked" : ""} />
            ${escHtml(s.name)}
          </label>`).join("")}`).join("");
  };

  const html =
    group(`${departmentLabel(dept)} courses`, visible.filter(s => !s.minor)) +
    group("Minor / general courses", visible.filter(s => s.minor));
  container.innerHTML = html || `<p style="color:#888; margin:0;">No courses match "${escHtml(q)}".</p>`;
}

// Keep the picked set in sync with the checkboxes (the list re-renders on
// search, and ticks must survive that). Delegated: the list is rebuilt often.
document.addEventListener("change", (e) => {
  const cb = e.target;
  if (cb?.classList?.contains("new-student-subject-cb")) {
    cb.checked ? newStudentPicked.add(cb.value) : newStudentPicked.delete(cb.value);
  }
});
document.addEventListener("input", (e) => {
  if (e.target?.id === "new-student-subject-search") renderNewStudentSubjects();
});

// ══════════════════════════════════════════════════════════════
//  LOAD USERS
// ══════════════════════════════════════════════════════════════
async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("users")
    .select("id, student_id, role, name, email, section_id, is_active, academic_rank, employment_type, department, major, is_supervisor, is_executive, sections(name)");

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
    executive:  ["Name", "Email", "Role", "—", "Status", "Action"],
    "":         ["Name", "ID / Student ID", "Role", "Email", "Status", "Action"],
  };

  const cols = headers[role] || headers[""];
  thead.innerHTML = `<tr>${cols.map(h => `<th>${h}</th>`).join("")}</tr>`;
}

// ══════════════════════════════════════════════════════════════
//  RENDER TABLE
// ══════════════════════════════════════════════════════════════
// Rebuilds the Majoring filter's option list from whatever distinct, non-
// blank major values currently exist among students (scoped to the active
// Section filter, if any) — never a hardcoded list, since majors aren't
// controlled vocabulary and vary by program/registrar export.
function populateMajoringFilterOptions(filterSection) {
  const select = document.getElementById("filter-majoring");
  if (!select) return;
  const current = select.value;

  const majors = new Set();
  allUsers.forEach(u => {
    if (u.role !== "student" || !u.major) return;
    if (filterSection && u.section_id !== filterSection) return;
    majors.add(u.major);
  });

  const sorted = [...majors].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">All Majors</option>` +
    sorted.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join("");
  // Preserve the admin's current selection if it's still a valid option.
  if (sorted.includes(current)) select.value = current;
}

function renderTable() {
  const search        = document.getElementById("search-input").value.toLowerCase();
  const filterRole    = document.getElementById("filter-role").value;
  const filterSection = document.getElementById("filter-section").value;
  const filterStatus  = document.getElementById("filter-status-users")?.value || "";
  const filterMajoring = document.getElementById("filter-majoring")?.value || "";

  // Update headers to match current role filter
  updateTableHeaders(filterRole);

  // Majoring only applies to students — hide the filter entirely otherwise,
  // and (re)populate it from whatever major values actually exist right now.
  const majoringGroup = document.getElementById("filter-majoring-group");
  if (majoringGroup) {
    if (filterRole === "student") {
      majoringGroup.style.display = "";
      populateMajoringFilterOptions(filterSection);
    } else {
      majoringGroup.style.display = "none";
    }
  }

  let filtered = allUsers.filter(u => {
    if (u.role === "admin") return false;   // admins not shown in user management
    const nameOrId     = `${u.name || ""} ${u.student_id || ""} ${u.email || ""}`.toLowerCase();
    const matchSearch  = !search        || nameOrId.includes(search);
    // A teacher row with is_supervisor/is_executive=true (a dual/triple-role
    // chair or dean) must show up under the Supervisor / Management filter
    // too, not just under Teacher — otherwise they're invisible from this
    // screen unless you already know to search by name instead.
    const matchRole    = !filterRole
      || u.role === filterRole
      || (filterRole === "supervisor" && u.is_supervisor === true)
      || (filterRole === "executive"  && u.is_executive  === true);
    const matchSection = !filterSection || u.section_id === filterSection;
    const isActive     = u.is_active !== false;
    const matchStatus  = !filterStatus
      || (filterStatus === "active"   &&  isActive)
      || (filterStatus === "inactive" && !isActive);
    const matchMajoring = !filterMajoring || (u.major || "") === filterMajoring;
    return matchSearch && matchRole && matchSection && matchStatus && matchMajoring;
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
    // Small tags so a dual/triple-role account's EXTRA access is visible
    // right in the table, not just discoverable by opening Edit — this is
    // exactly what was invisible when a supervisor/exec is really a
    // role="teacher" row underneath (see matchRole above).
    const roleTags =
      (u.is_supervisor ? ` <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:9.5px;padding:1px 5px;">+Supervisor</span>` : "") +
      (u.is_executive  ? ` <span class="badge" style="background:#fef3c7;color:#92400e;font-size:9.5px;padding:1px 5px;">+Mgmt</span>` : "");

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
      col3 = `<span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>${roleTags}`;
      col4 = u.email || "—";

    } else if (filterRole === "teacher") {
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = teacherIdPlaceholder;
      col3 = (u.academic_rank
        ? `<span class="badge ${getRoleBadgeClass(u.role)}" style="font-size:11px;">${escHtml(u.academic_rank)}</span>`
        : "—") + roleTags;
      col4 = u.email || "—";

    } else if (filterRole === "student") {
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = u.student_id
        ? `<code style="font-size:11px;">${escHtml(u.student_id)}</code>`
        : "—";
      col3 = u.major
        ? `${escHtml(section)}<br><span style="font-size:11px; color:var(--slate);">${escHtml(u.major)}</span>`
        : section;
      col4 = u.email || "—";

    } else {
      // supervisor / admin / executive — no ID column, use col2 for email,
      // col3 for role badge. roleLabel shows the account's REAL underlying
      // role (e.g. "Teacher") even when it matched this filter via a
      // is_supervisor/is_executive flag — roleTags is what explains why.
      col1 = `<b>${escHtml(u.name || "—")}</b>`;
      col2 = u.email || "—";
      col3 = `<span class="badge ${getRoleBadgeClass(u.role)}">${roleLabel}</span>${roleTags}`;
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
       : role === "executive" ? "badge-admin" // reuse admin's styling — no dedicated color defined for this role
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
  const role           = document.getElementById("new-role").value;
  const studentFields  = document.getElementById("student-fields");
  const staffFields    = document.getElementById("staff-fields");
  const rankGroup      = document.getElementById("new-rank-group");
  const deptGroup      = document.getElementById("new-department-group");
  const supervisorGroup = document.getElementById("new-is-supervisor-group");
  const executiveGroup  = document.getElementById("new-is-executive-group");

  studentFields.classList.add("hidden");
  staffFields.classList.add("hidden");
  if (rankGroup) rankGroup.style.display = "none";
  if (deptGroup) deptGroup.style.display = "none";
  if (supervisorGroup) supervisorGroup.style.display = "none";
  if (executiveGroup) executiveGroup.style.display = "none";

  if (role === "student") {
    studentFields.classList.remove("hidden");
  } else if (["teacher","supervisor","admin","executive"].includes(role)) {
    staffFields.classList.remove("hidden");
    if (role === "teacher" && rankGroup) rankGroup.style.display = "block";
    // Department applies to teacher AND supervisor — not admin, who isn't
    // scoped to any one department. It's descriptive/display only for
    // supervisors now — supervisor_assignments (not department) is what
    // actually governs who they can see/review; see admin-users.js's
    // runSupervisorAssignmentImport for that model.
    if ((role === "teacher" || role === "supervisor") && deptGroup) {
      deptGroup.style.display = "block";
    }
    const empGroup = document.getElementById("new-employment-group");
    if (role === "teacher" && empGroup) empGroup.style.display = "block";
    else if (empGroup) empGroup.style.display = "none";
    // "Also a supervisor" / "Also Management" only make sense for a
    // TEACHER account (the multi-role case — a chair/dean who also
    // teaches). Picking role=Supervisor or role=Executive already creates
    // a dedicated single-purpose account; no separate flag needed there.
    if (role === "teacher" && supervisorGroup) supervisorGroup.style.display = "block";
    if (role === "teacher" && executiveGroup)  executiveGroup.style.display  = "block";
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
      // Name + Department are additions on top of the original form:
      // Department is a pure UI filter for narrowing Section (students
      // don't have their own department column — see onNewStudentDepartmentChange).
      const name       = document.getElementById("new-student-name")?.value.trim() || "";
      const studentId  = document.getElementById("new-student-id").value.trim();
      const sectionId  = document.getElementById("new-section-id").value;

      if (!name)      { errorEl.textContent = "Full name is required."; return; }
      if (!studentId) { errorEl.textContent = "Student ID is required."; return; }
      if (!STUDENT_ID_FORMAT.test(studentId)) {
        errorEl.textContent = "Invalid format. Use: 2023-1154-AB"; return;
      }
      if (!sectionId) { errorEl.textContent = "Please select a section."; return; }

      // Optional email. Blank is fine (saved as NULL). If given: must look
      // like an email and must not already belong to ANY account — users.email
      // is UNIQUE, and the student login uses it for the email-code step.
      const email = (document.getElementById("new-student-email")?.value || "").trim().toLowerCase();
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errorEl.textContent = "That email doesn't look valid (e.g. name@gmail.com)."; return;
        }
        const owner = allUsers.find(u => u.email && u.email.toLowerCase() === email);
        if (owner) {
          errorEl.textContent = `That email already belongs to ${owner.name || "another account"}.`; return;
        }
      }

      const { error } = await supabase.from("users").insert({
        name, student_id: studentId, role: "student", section_id: sectionId,
        email: email || null,
      });
      if (error) {
        errorEl.textContent = error.code === "23505"
          ? (/email/i.test(error.message) ? "That email is already used by another account."
                                            : "That Student ID already exists.")
          : "Failed to save: " + error.message;
        return;
      }

      // ── Enroll into whichever subjects were checked ──
      // Optional: an admin can save the student with nothing checked and
      // enroll them later. Failure to enroll should NOT undo the user
      // creation that already succeeded above — it's reported as a
      // separate warning instead, same pattern as the Auth-account
      // creation fallback below for staff.
      // Read from the picked set, not the DOM: ticked courses hidden by the
      // search box aren't rendered, so querying checkboxes would drop them.
      const checkedSubjectIds = [...newStudentPicked];

      if (checkedSubjectIds.length > 0) {
        const { data: sem } = await supabase
          .from("semesters").select("id").eq("is_active", true).maybeSingle();

        if (!sem) {
          await fpAlert(
            `Student "${name}" added, but couldn't enroll them in courses — no active semester found. Enroll them manually once a semester is active.`,
            "warning"
          );
        } else {
          const { error: enrollError } = await supabase
            .from("student_subjects")
            .insert(checkedSubjectIds.map(subjectId => ({
              student_id: studentId,
              subject_id: subjectId,
              semester_id: sem.id,
            })));
          if (enrollError) {
            await fpAlert(
              `Student "${name}" added, but course enrollment failed: ${enrollError.message}` +
              (enrollError.message?.includes("does not exist")
                ? " — the student_subjects table hasn't been created yet. Run the migration first."
                : "") +
              `\n\nEnroll them manually from Course Assignment.`,
              "warning"
            );
          }
        }
      }

    } else {
      const name          = document.getElementById("new-name").value.trim();
      const email         = document.getElementById("new-email").value.trim();
      const password      = document.getElementById("new-password").value.trim();
      const academicRank  = document.getElementById("new-academic-rank")?.value || null;
      const employmentType = document.getElementById("new-employment-type")?.value || null;
      const department     = document.getElementById("new-department")?.value || null;

      if (!name)     { errorEl.textContent = "Full name is required."; return; }
      if (!email)    { errorEl.textContent = "Email is required."; return; }
      if (!password) { errorEl.textContent = "Password is required."; return; }
      if ((role === "teacher" || role === "supervisor") && !department) {
        errorEl.textContent = "Please select a department.";
        return;
      }

      // NOTE: this used to enforce "exactly one active supervisor per
      // department" here — a holdover from the old department-match
      // access-control model. That model was replaced on 2026-10-12 by
      // the supervisor_assignments link table (see supervisor.js), which
      // explicitly supports multiple supervisors per department and even
      // multiple supervisors on the same faculty member. The old check
      // was never removed when the model changed, so it was silently
      // blocking valid real-world cases (e.g. one HTM chair covering both
      // BSTM and BSHM, or two co-supervisors over the same roster) with an
      // error message describing a rule the rest of the system no longer
      // follows. Department is kept below as a descriptive/display field
      // only for supervisors — it plays no role in who they can see or
      // supervise; that's entirely determined by supervisor_assignments.

      // Multi-role: a teacher account that's ALSO a supervisor and/or sits
      // on the executive/management dashboard (a chair or dean who also
      // teaches) — same login via any of those tabs, see login.js. Only
      // meaningful for role==="teacher"; the checkboxes are hidden otherwise.
      const isSupervisor = role === "teacher" && document.getElementById("new-is-supervisor")?.checked;
      const isExecutive  = role === "teacher" && document.getElementById("new-is-executive")?.checked;

      const insertData = {
        role, name, email,
        academic_rank:   academicRank || null,
        employment_type: employmentType || null,
        department:      (role === "teacher" || role === "supervisor") ? department : null,
        is_supervisor:   isSupervisor,
        is_executive:    isExecutive,
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

      const supervisorNote = isSupervisor
        ? `\n\nThey can now log in as a supervisor via the same email/password through the Supervisor tab. ` +
          `Still need to assign WHICH faculty they supervise — run a Supervisor Assignments import with their email, ` +
          `or they'll see an empty faculty list until then.`
        : "";
      const executiveNote = isExecutive
        ? `\n\nThey can now log in to the Management dashboard via the same email/password through the Management tab.`
        : "";
      await fpAlert(`User "${name}" added to the system.${authOutcomeMsg}${supervisorNote}${executiveNote}`, authOutcomeMsg.includes("⚠️") ? "warning" : "success");
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
  if (document.getElementById("new-student-name"))
    document.getElementById("new-student-name").value = "";
  if (document.getElementById("new-student-department"))
    document.getElementById("new-student-department").value = "";
  document.getElementById("new-name").value      = "";
  document.getElementById("new-email").value     = "";
  document.getElementById("new-password").value  = "";
  document.getElementById("add-error").textContent = "";
  document.getElementById("student-fields").classList.add("hidden");
  document.getElementById("staff-fields").classList.add("hidden");
  if (document.getElementById("new-rank-group"))
    document.getElementById("new-rank-group").style.display = "none";
  if (document.getElementById("new-department-group"))
    document.getElementById("new-department-group").style.display = "none";
  if (document.getElementById("new-department"))
    document.getElementById("new-department").value = "";
  if (document.getElementById("new-is-supervisor-group"))
    document.getElementById("new-is-supervisor-group").style.display = "none";
  if (document.getElementById("new-is-supervisor"))
    document.getElementById("new-is-supervisor").checked = false;
  if (document.getElementById("new-is-executive-group"))
    document.getElementById("new-is-executive-group").style.display = "none";
  if (document.getElementById("new-is-executive"))
    document.getElementById("new-is-executive").checked = false;
  if (document.getElementById("new-student-email")) document.getElementById("new-student-email").value = "";
  const subjSearch = document.getElementById("new-student-subject-search");
  if (subjSearch) subjSearch.value = "";
  if (document.getElementById("new-student-department")) document.getElementById("new-student-department").value = "";
  onNewStudentDepartmentChange(); // resets the section list and the course checklist
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
  if (document.getElementById("edit-department"))
    document.getElementById("edit-department").value = u.department || "";
  document.getElementById("edit-is-active").value     = u.is_active !== false ? "active" : "inactive";
  document.getElementById("edit-error").textContent   = "";

  // Show/hide rank + section + department fields based on role
  const isTeacher    = u.role === "teacher";
  const isSupervisor = u.role === "supervisor";
  const isStudent    = u.role === "student";
  document.getElementById("edit-rank-row").style.display       = isTeacher ? "block" : "none";
  document.getElementById("edit-employment-row").style.display  = isTeacher ? "block" : "none";
  document.getElementById("edit-section-row").style.display     = isStudent ? "block" : "none";
  const deptRow = document.getElementById("edit-department-row");
  if (deptRow) deptRow.style.display = (isTeacher || isSupervisor) ? "block" : "none";
  document.getElementById("edit-name-row").style.display        = isStudent ? "none"  : "block";
  // Students: email is OPTIONAL and only used for their login/reset code, so
  // the admin can set, correct or clear it here (a student locked out by a
  // misspelled email can't fix it themselves).
  document.getElementById("edit-email-row").style.display       = "block";
  document.getElementById("edit-email").placeholder =
    isStudent ? "Optional — leave blank for no email" : "";

  // Multi-role flags: only meaningful for a TEACHER account (the dual/
  // triple-role case — a chair/dean who also teaches). Pre-check from the
  // row's current value so re-opening Edit doesn't silently reset them.
  const editSupGroup  = document.getElementById("edit-is-supervisor-group");
  const editExecGroup = document.getElementById("edit-is-executive-group");
  if (editSupGroup)  editSupGroup.style.display  = isTeacher ? "block" : "none";
  if (editExecGroup) editExecGroup.style.display = isTeacher ? "block" : "none";
  if (document.getElementById("edit-is-supervisor"))
    document.getElementById("edit-is-supervisor").checked = u.is_supervisor === true;
  if (document.getElementById("edit-is-executive"))
    document.getElementById("edit-is-executive").checked = u.is_executive === true;

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
  } else {
    const newEmail = document.getElementById("edit-email").value.trim().toLowerCase();
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      errorEl.textContent = "That doesn't look like a valid email address.";
      return;
    }
    if (newEmail !== (u.email || "").toLowerCase()) {
      const ok = await fpConfirm(
        newEmail
          ? `Change this student's email to "${newEmail}"?\n\nTheir login code and password-reset code will be sent to this address. ` +
            `A misspelled email locks the student out of their account — please double-check every letter.`
          : "Remove this student's email?\n\nThey will log in with Student ID and password only, and won't be able to reset a forgotten password themselves.",
        { confirmLabel: newEmail ? "Yes, change it" : "Yes, remove it" }
      );
      if (!ok) return;
    }
    updates.email = newEmail || null;
  }

  if (u.role === "teacher") {
    updates.academic_rank   = document.getElementById("edit-academic-rank").value || null;
    updates.employment_type = document.getElementById("edit-employment-type").value || null;
  }

  if (u.role === "teacher" || u.role === "supervisor") {
    const dept = document.getElementById("edit-department")?.value || "";
    if (!dept) { errorEl.textContent = "Please select a department."; return; }

    // NOTE: this used to enforce "exactly one active supervisor per
    // department" here too — the same stale department-match access-control
    // holdover removed from saveUser() (Add User) on 2026-10-12, when the
    // model moved to supervisor_assignments (which explicitly supports
    // multiple supervisors per department and multiple supervisors on the
    // same faculty member). It was never removed from THIS function, so
    // editing an existing supervisor's department was still silently
    // blocking valid real-world cases. Department is kept below as a
    // descriptive/display field only for supervisors — supervisor_assignments
    // is what actually governs who they can see/supervise.
    updates.department = dept;
  }

  // Multi-role flags — only meaningful/saved for a TEACHER account; the
  // checkboxes are hidden (and thus never checked) for every other role.
  if (u.role === "teacher") {
    updates.is_supervisor = document.getElementById("edit-is-supervisor")?.checked === true;
    updates.is_executive  = document.getElementById("edit-is-executive")?.checked === true;
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
  majoring:   ["Majoring", "Major"], // optional — some programs don't have one
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
    else if (key !== "middleName" && key !== "email" && key !== "majoring") missing.push(aliases[0]);
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
    const majoring    = colMap.majoring ? cleanOptionalText(row[colMap.majoring]) : "";

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

    parsed.push({ studentId, name, email: email || null, sectionName, program, courses, major: majoring || null });
  });

  if (parsed.length === 0) {
    renderImportSummary({ sectionsCreated: 0, studentsAdded: 0, studentsPromoted: 0, duplicateRows: 0, subjectsCreated: 0, enrollmentsLinked: 0, errors, totalRows: rows.length });
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

    // ── 2b. Resolve email collisions BEFORE inserting — an email already
    //    claimed is dropped to blank rather than blocking the whole row,
    //    since a student can still be added with no email and fill it in
    //    themselves later. Two kinds of collision, both "first one wins,
    //    everyone else goes blank":
    //      (a) against a NON-student account (teacher/supervisor/admin) —
    //          this is the gap that let a roster email silently overwrite
    //          a real faculty email with zero warning; now it's blocked
    //          and reported instead.
    //      (b) against another row in THIS SAME file, or an already-
    //          existing student in the DB — "the one on top" (first row
    //          encountered, or whoever already has it in the DB) keeps
    //          the email; every later claimant is blanked.
    //    This only ever touches NEW inserts' email field — promotions
    //    never touch email (see step 5), so an existing student's email
    //    they already have is never taken away by a later roster row. ──
    const emailWarnings = [];
    if (dedupedParsed.some(p => p.email)) {
      const { data: existingEmailUsers, error: emailLookupError } = await fetchAllRows("users", "email, role");
      if (emailLookupError) throw new Error("Email collision check failed: " + emailLookupError.message);

      const nonStudentEmails = new Set(
        (existingEmailUsers || [])
          .filter(u => u.role !== "student" && u.email)
          .map(u => u.email.toLowerCase())
      );
      // Existing students' emails — "first one wins" against the DB too,
      // so a roster re-import can't silently reassign an email that's
      // already attached to a different student_id.
      const studentEmailOwner = new Map(); // email -> student_id already holding it
      (existingEmailUsers || [])
        .filter(u => u.role === "student" && u.email)
        .forEach(u => studentEmailOwner.set(u.email.toLowerCase(), u.student_id));

      const claimedThisRun = new Set();
      for (const p of dedupedParsed) {
        if (!p.email) continue;
        const emailLc = p.email.toLowerCase();

        if (nonStudentEmails.has(emailLc)) {
          emailWarnings.push({ row: "-", studentId: p.studentId, issues: `email "${p.email}" already belongs to a non-student account — student added without it` });
          p.email = null;
          continue;
        }
        const owner = studentEmailOwner.get(emailLc);
        if (owner && owner !== p.studentId) {
          emailWarnings.push({ row: "-", studentId: p.studentId, issues: `email "${p.email}" already belongs to student ${owner} — this student added without it` });
          p.email = null;
          continue;
        }
        if (claimedThisRun.has(emailLc)) {
          emailWarnings.push({ row: "-", studentId: p.studentId, issues: `email "${p.email}" is repeated earlier in this file — this student added without it (first row keeps it)` });
          p.email = null;
          continue;
        }
        claimedThisRun.add(emailLc);
      }
    }
    // NOT pushed into `errors` — these rows are NOT skipped, the student
    // IS added/promoted normally, just without that one roster email.
    // Mixing them into `errors` would mislabel them as failures in the
    // summary below ("row(s) skipped due to issues"), which they aren't.

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
        toPromote.push({ studentId: p.studentId, sectionId, major: p.major });
      } else {
        toInsert.push({
          student_id: p.studentId, name: p.name, email: p.email,
          role: "student", section_id: sectionId, major: p.major,
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
      for (const row of batch) {
        const { error: rowError } = await supabase.from("users").insert(row);
        if (rowError) {
          errors.push({ row: "-", studentId: row.student_id, issues: "insert failed: " + rowError.message });
        } else {
          studentsAdded++;
        }
      }
    }

    // ── 5. Promote existing students (section_id only) ──
    setImportStatus(`Updating section for ${toPromote.length} returning student(s)…`);
    let studentsPromoted = 0;
    await runWithConcurrency(toPromote, 15, async (p) => {
      // Only overwrite major if this import actually provided one — a blank
      // Majoring cell on a re-import (or an older template without the
      // column at all) must never silently erase a value set earlier.
      const updates = { section_id: p.sectionId };
      if (p.major) updates.major = p.major;
      const { error } = await supabase
        .from("users").update(updates)
        .eq("student_id", p.studentId).eq("role", "student");
      if (error) {
        errors.push({ row: "-", studentId: p.studentId, issues: "promotion failed: " + error.message });
      } else {
        studentsPromoted++;
      }
    });

    // ── 6. Create subject placeholders from the course columns ──
    setImportStatus("Resolving courses…");
    const subjectMap = new Map(); // "course|sectionId" -> row
    for (const p of dedupedParsed) {
      const sectionId = sectionMap[p.sectionName];
      if (!sectionId) continue;
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
        const { data: upserted, error } = await supabase
          .from("subjects")
          .upsert(batch, { onConflict: "name,section_id,semester_id" })
          .select("id, name, section_id");
        if (error) {
          throw new Error(
            "Course creation failed: " + error.message +
            (error.message?.includes("no unique or exclusion constraint")
              ? ' — run: ALTER TABLE subjects ADD CONSTRAINT subjects_name_section_semester_unique UNIQUE (name, section_id, semester_id);'
              : "")
          );
        }
        (upserted || []).forEach(row => {
          const key = `${row.name}|${row.section_id}`;
          const existing = subjectMap.get(key);
          if (existing) existing.id = row.id;
        });
      }
      subjectsCreated = subjectRows.length;
    }

    // ── 7. Link each student to the SPECIFIC subjects they take ──
    setImportStatus("Linking students to their specific courses…");
    const enrollmentRows = [];
    for (const p of dedupedParsed) {
      const sectionId = sectionMap[p.sectionName];
      if (!sectionId) continue;
      for (const courseName of p.courses) {
        const subjectRow = subjectMap.get(`${courseName}|${sectionId}`);
        if (!subjectRow?.id) continue;
        enrollmentRows.push({
          student_id: p.studentId,
          subject_id: subjectRow.id,
          semester_id: semesterId,
        });
      }
    }

    let enrollmentsLinked = 0;
    for (const batch of chunkArray(enrollmentRows, 500)) {
      if (batch.length === 0) continue;
      const { error } = await supabase
        .from("student_subjects")
        .upsert(batch, { onConflict: "student_id,subject_id,semester_id", ignoreDuplicates: true });
      if (error) {
        throw new Error(
          "Student-course linking failed: " + error.message +
          (error.message?.includes("does not exist")
            ? " — the student_subjects table hasn't been created yet. Run the migration first."
            : "")
        );
      }
      enrollmentsLinked += batch.length;
    }

    // ── Auto-sync enrolled_count right now, not on a timer ──
    // subjects.enrolled_count is a denormalized cache of how many
    // student_subjects rows point at it — it only ever needs recomputing
    // at the exact moment enrollment changes, which is right here, not on
    // some later background tick that depends on an admin happening to be
    // on a particular tab. See js/admin.js's syncEnrolledCounts() for the
    // original — duplicated here (not imported; these are separate pages
    // with no shared module) with the same pagination fix: Supabase caps
    // an unpaginated select() at 1000 rows, and this institution has well
    // over 1000 student_subjects rows, so fetchAllRows() pages through
    // with .range() instead of trusting a single select() to return
    // everything (that exact gap previously corrupted enrolled_count —
    // keep this paginated version in sync with admin.js's if it changes).
    const syncResult = await syncEnrolledCountsAfterImport();

    renderImportSummary({ sectionsCreated, studentsAdded, studentsPromoted, duplicateRows, subjectsCreated, enrollmentsLinked, errors, emailWarnings, totalRows: rows.length, syncResult });

    await loadSections();
    await loadDepartments();
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

async function fetchAllRows(table, columns) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) return { error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return { data: all };
}

async function syncEnrolledCountsAfterImport() {
  const { data: links, error: linksError } = await fetchAllRows("student_subjects", "subject_id");
  if (linksError) return { error: linksError.message };

  const counts = new Map();
  (links || []).forEach(r => {
    counts.set(r.subject_id, (counts.get(r.subject_id) || 0) + 1);
  });

  const { data: subjects, error: subjError } = await fetchAllRows("subjects", "id, enrolled_count");
  if (subjError) return { error: subjError.message };

  const toUpdate = (subjects || []).filter(
    s => (counts.get(s.id) || 0) !== (s.enrolled_count || 0)
  );

  let updated = 0;
  const errors = [];
  const CHUNK = 20;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const batch = toUpdate.slice(i, i + CHUNK);
    const results = await Promise.all(
      batch.map(s =>
        supabase.from("subjects")
          .update({ enrolled_count: counts.get(s.id) || 0 })
          .eq("id", s.id)
      )
    );
    results.forEach(({ error }) => {
      if (error) errors.push(error.message);
      else updated++;
    });
  }

  if (errors.length > 0) return { updated, error: errors.slice(0, 3).join("; ") };
  return { updated };
}

function renderImportSummary({ sectionsCreated, studentsAdded, studentsPromoted, duplicateRows = 0, subjectsCreated = 0, enrollmentsLinked = 0, errors, emailWarnings = [], totalRows, syncResult = {} }) {
  setImportStatus(`Done — processed ${totalRows} row(s).`);
  const box = document.getElementById("import-summary");
  if (!box) return;

  let html = `
    <ul style="margin:8px 0 0; padding-left:18px; font-size:13px; line-height:1.8;">
      <li>${sectionsCreated} section(s) created</li>
      <li>${studentsAdded} new student(s) added</li>
      <li>${studentsPromoted} returning student(s) moved to their new section</li>
      ${duplicateRows > 0 ? `<li>${duplicateRows} duplicate row(s) for the same student collapsed to one</li>` : ""}
      <li>${subjectsCreated} course(s) resolved — <b>no teacher assigned yet</b>, that still needs to be done manually</li>
      <li>${enrollmentsLinked} student-to-course enrollment(s) recorded</li>
      <li style="${syncResult.error ? "color:#dc2626;" : ""}">
        ${syncResult.error
          ? `Enrolled-count sync failed: ${escHtml(syncResult.error)} — run "Sync Enrolled" manually from the Dashboard.`
          : `Enrolled counts auto-synced (${syncResult.updated ?? 0} course${syncResult.updated === 1 ? "" : "s"} updated) — no manual sync needed.`}
      </li>
      ${emailWarnings.length > 0 ? `<li style="color:#b45309;">${emailWarnings.length} student(s) added WITHOUT their roster email — it already belonged to someone else; they can add it once they log in</li>` : ""}
      <li style="${errors.length ? "color:#dc2626;" : ""}">${errors.length} row(s) skipped due to issues</li>
    </ul>
  `;

  if (emailWarnings.length > 0) {
    const shownWarn = emailWarnings.slice(0, 50);
    html += `
      <p style="font-size:12px; font-weight:600; margin:14px 0 6px; color:#b45309;">
        Added without their roster email${emailWarnings.length > shownWarn.length ? ` (showing first ${shownWarn.length} of ${emailWarnings.length})` : ""}:
      </p>
      <div style="max-height:160px; overflow-y:auto; border:1px solid #fde68a; border-radius:6px; padding:8px 10px; background:#fffbeb;">
        ${shownWarn.map(e => `
          <div style="font-size:11px; color:#92400e; margin-bottom:4px;">
            <code>${escHtml(e.studentId)}</code>: ${escHtml(e.issues)}
          </div>
        `).join("")}
      </div>
    `;
  }

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
//  XLSX IMPORT — bulk faculty account creation ("Faculty Profile" template)
//
//  Each row creates (or updates) one teacher account:
//   - New email  -> insert into `users` (role: teacher), auto-generate a
//     random password, and create their Supabase Auth login via the same
//     /api/create-teacher-auth function the single Add-User flow uses.
//     Supabase Auth passwords can't be retrieved later, so the summary
//     table below is the ONLY place a generated password is ever shown —
//     the admin must copy it down before closing this modal.
//   - Existing email (matches an existing role='teacher' user, case-
//     insensitive) -> UPDATE academic_rank/employment_type/department
//     only. Password and Auth login are never touched for an existing
//     account — re-importing a roster must never silently reset someone's
//     login credentials.
//
//  Department has no free-text fallback: it must exactly match one of the
//  ORG_DEPARTMENTS values (Agri, HTM, ICT, IT, TEd — see the constant
//  above) — NOT a program/section code like "BSIT" or "BSTM". A typo'd or
//  program-code department fails that row rather than silently creating a
//  new, disconnected department string nothing else recognizes.
//
//  A "*Reference" column (which program(s) sit under that org department,
//  e.g. HTM -> BSTM, BSHM) may be present in the file for the admin's own
//  reading — it is purely informational and is never read or imported.
// ══════════════════════════════════════════════════════════════

const FACULTY_IMPORT_COLUMNS = {
  name:           ["Name", "Full Name", "Faculty Name"],
  email:          ["Email"],
  employmentType: ["Employment Status", "Employment Type", "Employment_Type"],
  academicRank:   ["Current Faculty Rank", "Academic Rank", "Rank"],
  department:     ["Department", "Department1"],
};

const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "COS"];

function generateRandomPassword() {
  // 12 random chars, avoiding visually-ambiguous ones (0/O, 1/l/I) since
  // these get hand-copied off a screen by an admin.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

function openFacultyImportPicker() {
  document.getElementById("faculty-import-modal")?.classList.remove("hidden");
  document.getElementById("faculty-import-summary").innerHTML = "";
  setFacultyImportStatus("");
}

function setFacultyImportStatus(text, isError = false) {
  const el = document.getElementById("faculty-roster-import-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#dc2626" : "#475569";
}

async function handleFacultyImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;

  if (typeof XLSX === "undefined") {
    await fpAlert("The spreadsheet library failed to load. Check your connection and try again.", "error");
    return;
  }

  setFacultyImportStatus("Reading file…");

  let workbook;
  try {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array" });
  } catch (err) {
    setFacultyImportStatus("Failed to read the file: " + err.message, true);
    return;
  }

  // The template ships a "Read Me" sheet alongside the real data — use
  // whichever sheet is actually named "Faculty Profile" if present, else
  // fall back to the first sheet.
  const sheetName = workbook.SheetNames.find(n => /faculty profile/i.test(n)) || workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  if (rows.length === 0) {
    setFacultyImportStatus("That sheet has no data rows.", true);
    return;
  }

  const headerRow = Object.keys(rows[0]);
  const colMap = {};
  let missing = [];
  for (const [key, aliases] of Object.entries(FACULTY_IMPORT_COLUMNS)) {
    const found = findHeaderKey(headerRow, aliases);
    if (found) colMap[key] = found;
    else missing.push(aliases[0]);
  }
  if (missing.length > 0) {
    setFacultyImportStatus(`Missing required column(s): ${missing.join(", ")}. Check the file has Name, Email, Department, Employment Status, and Current Faculty Rank columns.`, true);
    return;
  }

  await runFacultyImport(rows, colMap, workbook);
}

// ══════════════════════════════════════════════════════════════
//  SUPERVISOR ASSIGNMENTS — "Supervisors" + "Assignments" sheets,
//  read from the SAME workbook as the Faculty Profile import.
//
//  Confirm-then-create (2026-10-20, supersedes the 2026-10-12 lookup-only
//  design): a Supervisor Code's email can now auto-create a supervisor
//  account, same as faculty rows do — but ONLY after the admin explicitly
//  confirms a preview listing exactly which new accounts are about to be
//  created. A supervisor account has more access than a teacher account,
//  so silently creating one from a typo'd spreadsheet row is a bigger
//  mistake than silently creating a teacher account would be — the
//  confirmation step is what makes a typo something the admin SEES and can
//  cancel, instead of something that happens invisibly. Decline the
//  confirmation (or cancel it) and those rows fall back to the old
//  behavior: skipped with "add them via + Add User first".
//
//  Faculty Email rows are still lookup-only — that side is already
//  covered by the Faculty Profile import earlier in this same run, so an
//  unresolved faculty email means a real data problem (wrong sheet, typo,
//  import order), not something to paper over by creating a phantom
//  teacher account with no profile data behind it.
//
//  Sheets are optional — a plain Faculty Profile-only file (the old
//  format) still imports fine; these two sheets are just skipped if absent.
// ══════════════════════════════════════════════════════════════
function findSheetByName(workbook, pattern) {
  const name = workbook.SheetNames.find(n => pattern.test(n));
  return name ? workbook.Sheets[name] : null;
}

async function runSupervisorAssignmentImport(workbook) {
  const supWs = findSheetByName(workbook, /^supervisors$/i);
  const asnWs = findSheetByName(workbook, /^assignments$/i);
  if (!supWs || !asnWs) return null; // sheets not present — nothing to do

  const supRows = XLSX.utils.sheet_to_json(supWs, { defval: "", raw: false });
  const asnRows = XLSX.utils.sheet_to_json(asnWs, { defval: "", raw: false });

  const errors = [];

  // ── Resolve Supervisor Code -> email/name, from the Supervisors sheet ──
  // "Supervisor Name" is read from whichever of these headers is present;
  // older files that only ever had it as a "(reference only)" column still
  // work, since the name is now actually used (for a newly-created
  // account's display name), not just decorative.
  const codeToEmail = new Map();
  const codeToName  = new Map();
  supRows.forEach((row, i) => {
    const rowNum = i + 2;
    const code  = cleanOptionalText(row["Supervisor Code"]);
    const email = cleanOptionalText(row["Supervisor Email"]).toLowerCase();
    const name  = cleanOptionalText(row["Supervisor Name"] || row["Supervisor Name (reference only)"]);
    if (!code || !email) return; // blank trailing rows — not an error, just skip
    if (codeToEmail.has(code)) {
      errors.push({ row: rowNum, email, issues: `Supervisor Code "${code}" is used more than once in the Supervisors sheet` });
      return;
    }
    codeToEmail.set(code, email);
    if (name) codeToName.set(code, name);
  });

  if (asnRows.length === 0) {
    return { linked: 0, errors, totalRows: 0, createdSupervisors: [], grantedSupervisors: [] };
  }

  // ── Re-fetch current users so a teacher created earlier in THIS SAME
  //    import run is already linkable, and so a supervisor added to the
  //    system moments ago (by another admin, another tab) is seen too. ──
  const { data: existingUsers, error: existingError } = await fetchAllRows("users", "id, email, role, department");
  if (existingError) {
    errors.push({ row: "-", email: "-", issues: "Could not check accounts: " + existingError.message });
    return { linked: 0, errors, totalRows: asnRows.length, createdSupervisors: [], grantedSupervisors: [] };
  }
  const supervisorByEmail = new Map(
    (existingUsers || []).filter(u => u.role === "supervisor" && u.email).map(u => [u.email.toLowerCase(), u])
  );
  const teacherByEmail = new Map(
    (existingUsers || []).filter(u => u.role === "teacher" && u.email).map(u => [u.email.toLowerCase(), u])
  );
  // Real BatSC department chairs ARE teachers (evaluated by students like
  // anyone else) who ALSO supervise other faculty's SEF — one person, one
  // email/login, two hats. So a supervisor email matching an existing
  // TEACHER account is no longer an error: it's a grant candidate (flip
  // is_supervisor=true on their existing row, same login, no new
  // password — see neededGrantEmails below). Only a role that genuinely
  // can't be a supervisor (student/admin) blocks the row outright.
  const blockedRoleEmails = new Set(
    (existingUsers || []).filter(u => (u.role === "student" || u.role === "admin") && u.email).map(u => u.email.toLowerCase())
  );

  // ── Pass 1: resolve what we can, and collect which supervisor emails
  //    are referenced but don't have an account yet (candidates to
  //    create, pending the admin's confirmation below), plus which ones
  //    match an EXISTING teacher account and just need is_supervisor
  //    granted on it (no new account/password). ──
  const pending = []; // { rowNum, facultyEmail, supEmail, teacher }
  const neededSupEmails   = new Map(); // email -> { name, rows: [rowNum,...] }  (brand-new accounts)
  const neededGrantEmails = new Map(); // email -> { name, rows: [rowNum,...] }  (existing teacher -> is_supervisor=true)

  asnRows.forEach((row, i) => {
    const rowNum = i + 2;
    const code = cleanOptionalText(row["Supervisor Code"]);
    const facultyEmail = cleanOptionalText(row["Faculty Email (Supervised)"]).toLowerCase();
    if (!code && !facultyEmail) return; // blank trailing row

    if (!code) { errors.push({ row: rowNum, email: facultyEmail || "(blank)", issues: "missing Supervisor Code" }); return; }
    if (!facultyEmail) { errors.push({ row: rowNum, email: "(blank)", issues: "missing Faculty Email" }); return; }

    const supEmail = codeToEmail.get(code);
    if (!supEmail) { errors.push({ row: rowNum, email: facultyEmail, issues: `Supervisor Code "${code}" not found in the Supervisors sheet` }); return; }

    const teacher = teacherByEmail.get(facultyEmail);
    if (!teacher) { errors.push({ row: rowNum, email: facultyEmail, issues: `No existing teacher account for this email — check it's on the Faculty Profile sheet and was imported successfully` }); return; }

    // A supervisor who is ALSO a teacher (e.g. a department chair with a
    // teaching load) must never be linked to supervise their own faculty
    // account — that would let them submit their own SEF and potentially
    // see their own students' SET scores before official release. Teacher
    // and supervisor accounts are separate rows/emails by design, so this
    // only fires if the SAME email appears as both a Supervisor Email and
    // a Faculty Email, which is always a data-entry mistake, not a valid
    // "I supervise myself" case.
    if (supEmail === facultyEmail) {
      errors.push({ row: rowNum, email: facultyEmail, issues: `"${supEmail}" is listed as both the supervisor and the faculty being supervised on this row — a supervisor can't be assigned over themselves` });
      return;
    }

    if (blockedRoleEmails.has(supEmail)) {
      errors.push({ row: rowNum, email: facultyEmail, issues: `"${supEmail}" already exists as a student or admin account — can't grant supervisor access to it` });
      return;
    }

    if (!supervisorByEmail.has(supEmail)) {
      if (teacherByEmail.has(supEmail)) {
        // Existing teacher account — grant is_supervisor, don't create anew.
        const entry = neededGrantEmails.get(supEmail) || { name: codeToName.get(code) || "", rows: [] };
        entry.rows.push(rowNum);
        neededGrantEmails.set(supEmail, entry);
      } else {
        const entry = neededSupEmails.get(supEmail) || { name: codeToName.get(code) || "", rows: [] };
        entry.rows.push(rowNum);
        neededSupEmails.set(supEmail, entry);
      }
    }

    pending.push({ rowNum, facultyEmail, supEmail, teacher });
  });

  // ── Confirm-then-create: show the admin exactly which new supervisor
  //    accounts are about to be created, before anything is written. ──
  const createdSupervisors = [];
  if (neededSupEmails.size > 0) {
    const previewLines = [...neededSupEmails.entries()]
      .map(([email, info]) => `• ${info.name ? info.name + " — " : ""}${email}`)
      .join("\n");
    const proceed = await fpConfirm(
      `${neededSupEmails.size} supervisor account(s) referenced in the Assignments sheet ` +
      `don't exist yet and will be CREATED with a random password:\n\n${previewLines}\n\n` +
      `Check these emails carefully — a typo here creates a brand-new account with ` +
      `supervisor-level access. Create them?`,
      { confirmLabel: "Create Accounts", confirmStyle: "fp-btn-success" }
    );

    if (!proceed) {
      // Declined — fall back to the old behavior for every row that
      // depended on one of these, instead of silently dropping them.
      neededSupEmails.forEach((info, email) => {
        info.rows.forEach(rowNum => {
          errors.push({ row: rowNum, email, issues: `No existing supervisor account for "${email}" — add them via + Add User first, or re-run the import and confirm account creation` });
        });
      });
    } else {
      const isLocalDev = ["127.0.0.1", "localhost"].includes(window.location.hostname);
      for (const [email, info] of neededSupEmails.entries()) {
        const password = generateRandomPassword();
        const name = info.name || email;

        const { data: inserted, error: insertErr } = await supabase
          .from("users")
          .insert({ role: "supervisor", name, email, is_active: true })
          .select("id")
          .single();

        if (insertErr) {
          info.rows.forEach(rowNum => errors.push({
            row: rowNum, email,
            issues: `Could not create supervisor account: ${insertErr.message}`,
          }));
          continue;
        }

        let authOk = false, authMsg;
        if (isLocalDev) {
          authMsg = "⚠️ Running locally — add login manually in Supabase";
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
            authOk  = resp.ok;
            authMsg = resp.ok ? "Created" : `⚠️ Not created: ${result.error || "unknown error"}`;
          } catch (err) {
            authMsg = `⚠️ Couldn't reach login service: ${err.message}`;
          }
        }

        supervisorByEmail.set(email, { id: inserted.id, email, role: "supervisor" });
        createdSupervisors.push({ name, email, password, authOk, authMsg });
      }
    }
  }

  // ── Confirm-then-grant: for emails that already have a teacher login
  //    (the real, common case — a department chair who also teaches),
  //    flip is_supervisor=true on their EXISTING row. Same person, same
  //    email/password, same user id — nothing new to create or remember,
  //    and supervisor_assignments.supervisor_id below just points at that
  //    same id. ──
  const grantedSupervisors = [];
  if (neededGrantEmails.size > 0) {
    const previewLines = [...neededGrantEmails.entries()]
      .map(([email, info]) => `• ${info.name ? info.name + " — " : ""}${email}`)
      .join("\n");
    const proceed = await fpConfirm(
      `${neededGrantEmails.size} supervisor(s) referenced in the Assignments sheet already have an ` +
      `existing TEACHER account under this same email (a chair who also teaches). They will be GRANTED ` +
      `supervisor access on their existing account — same login, no new password:\n\n${previewLines}\n\n` +
      `They'll be able to switch between their Teacher and Supervisor dashboards with the same credentials. Grant access?`,
      { confirmLabel: "Grant Access", confirmStyle: "fp-btn-success" }
    );

    if (!proceed) {
      neededGrantEmails.forEach((info, email) => {
        info.rows.forEach(rowNum => {
          errors.push({ row: rowNum, email, issues: `Supervisor access for "${email}" was declined — re-run the import and confirm to grant it` });
        });
      });
    } else {
      for (const [email, info] of neededGrantEmails.entries()) {
        const teacherRow = teacherByEmail.get(email);
        const { error: grantErr } = await supabase
          .from("users")
          .update({ is_supervisor: true })
          .eq("id", teacherRow.id);

        if (grantErr) {
          info.rows.forEach(rowNum => errors.push({
            row: rowNum, email,
            issues: `Could not grant supervisor access: ${grantErr.message}` +
              (grantErr.message?.includes("is_supervisor")
                ? " — the is_supervisor column hasn't been added to users yet. Run the migration first."
                : ""),
          }));
          continue;
        }

        // The teacher's own id IS the supervisor_id going forward — no
        // separate account, so supervisorByEmail just points at the same row.
        supervisorByEmail.set(email, { id: teacherRow.id, email, role: "teacher" });
        grantedSupervisors.push({
          name: info.name || teacherRow.email, email,
          // Department plays NO role in who they can see/supervise — that's
          // entirely supervisor_assignments — so a blank one here is a
          // data-quality flag only, never a reason this grant should fail.
          departmentMissing: !teacherRow.department,
        });
      }
    }
  }

  // ── Pass 2: now that any confirmed accounts exist, resolve supervisor_id
  //    for every pending row. ──
  const toLink = [];
  pending.forEach(p => {
    const supervisor = supervisorByEmail.get(p.supEmail);
    if (!supervisor) return; // already recorded as an error above (declined or failed to create)
    toLink.push({ supervisor_id: supervisor.id, teacher_id: p.teacher.id, row: p.rowNum, email: p.facultyEmail });
  });

  let linked = 0;
  if (toLink.length > 0) {
    for (const batch of chunkArray(toLink, 200)) {
      const { error } = await supabase
        .from("supervisor_assignments")
        .upsert(
          batch.map(b => ({ supervisor_id: b.supervisor_id, teacher_id: b.teacher_id })),
          { onConflict: "supervisor_id,teacher_id", ignoreDuplicates: true }
        );
      if (error) {
        batch.forEach(b => errors.push({
          row: b.row, email: b.email,
          issues: "link failed: " + error.message +
            (error.message?.includes("does not exist")
              ? " — the supervisor_assignments table hasn't been created yet. Run the migration first."
              : ""),
        }));
      } else {
        linked += batch.length;
      }
    }
  }

  return { linked, errors, totalRows: asnRows.length, createdSupervisors, grantedSupervisors };
}

async function runFacultyImport(rows, colMap, workbook) {
  const errors = [];
  const parsed = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // account for header row
    const name             = cleanOptionalText(row[colMap.name]);
    const email            = cleanOptionalText(row[colMap.email]).toLowerCase();
    const employmentRaw    = cleanOptionalText(row[colMap.employmentType]);
    const employmentType   = EMPLOYMENT_TYPES.find(t => t.toLowerCase() === employmentRaw.toLowerCase()) || employmentRaw;
    const academicRankRaw  = cleanOptionalText(row[colMap.academicRank]);
    const academicRank     = ACADEMIC_RANKS.find(r => r.toLowerCase() === academicRankRaw.toLowerCase()) || academicRankRaw;
    const departmentRaw    = cleanOptionalText(row[colMap.department]);
    const department       = ORG_DEPARTMENTS.find(d => d.toLowerCase() === departmentRaw.toLowerCase()) || "";

    const rowErrors = [];
    if (!name)  rowErrors.push("missing Name");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push("missing/invalid Email");
    if (!departmentRaw) rowErrors.push("missing Department");
    else if (!department) rowErrors.push(`Department "${departmentRaw}" doesn't match any known org department (${ORG_DEPARTMENTS.join(", ")})`);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, email: email || "(blank)", issues: rowErrors.join(", ") });
      return;
    }

    parsed.push({ name, email, employmentType: employmentType || null, academicRank: academicRank || null, department });
  });

  if (parsed.length === 0) {
    renderFacultyImportSummary({ created: [], updated: 0, errors, totalRows: rows.length });
    return;
  }

  // De-dup by email within the file itself — same safety net as the
  // student importer, so one accidentally-repeated row doesn't create two
  // accounts for the same person.
  const seenEmails = new Set();
  const deduped = [];
  let duplicateRows = 0;
  for (const p of parsed) {
    if (seenEmails.has(p.email)) { duplicateRows++; continue; }
    seenEmails.add(p.email);
    deduped.push(p);
  }

  setFacultyImportStatus(`Checking ${deduped.length} email(s) against existing accounts…`);
  const { data: existingUsers, error: existingError } = await fetchAllRows("users", "id, email, role");
  if (existingError) {
    setFacultyImportStatus("Import stopped: " + existingError.message, true);
    return;
  }
  const existingByEmail = new Map(
    (existingUsers || [])
      .filter(u => u.role === "teacher" && u.email)
      .map(u => [u.email.toLowerCase(), u])
  );
  // A different role (student/supervisor/admin) already owns that email —
  // skip rather than silently repurposing someone's account.
  const otherRoleEmails = new Set(
    (existingUsers || [])
      .filter(u => u.role !== "teacher" && u.email)
      .map(u => u.email.toLowerCase())
  );

  const toInsert = [];
  const toUpdate = [];
  for (const p of deduped) {
    if (otherRoleEmails.has(p.email)) {
      errors.push({ row: "-", email: p.email, issues: "email already belongs to a non-teacher account" });
      continue;
    }
    const existing = existingByEmail.get(p.email);
    if (existing) toUpdate.push({ ...p, id: existing.id });
    else toInsert.push(p);
  }

  // ── Create new teacher accounts (row + Auth login) ──
  const isLocalDev = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  let authToken = null;
  if (!isLocalDev) {
    const { data: sessionData } = await supabase.auth.getSession();
    authToken = sessionData?.session?.access_token || null;
  }

  const created = []; // { name, email, password, authOk, authMsg }
  const insertErrors = [];
  setFacultyImportStatus(`Creating ${toInsert.length} new faculty account(s)…`);

  await runWithConcurrency(toInsert, 3, async (p) => {
    const password = generateRandomPassword();
    const { error: insertError } = await supabase.from("users").insert({
      role: "teacher", name: p.name, email: p.email,
      academic_rank: p.academicRank, employment_type: p.employmentType, department: p.department,
    });
    if (insertError) {
      insertErrors.push({
        row: "-", email: p.email,
        issues: insertError.code === "23505" ? "email already exists" : "insert failed: " + insertError.message,
      });
      return;
    }

    let authOk = false, authMsg;
    if (isLocalDev) {
      authMsg = "local dev — add manually in Supabase";
    } else {
      try {
        const resp = await fetch("/api/create-teacher-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
          body: JSON.stringify({ email: p.email, password, name: p.name }),
        });
        const result = await resp.json();
        authOk = resp.ok;
        authMsg = resp.ok ? "login created" : "login FAILED: " + (result.error || "unknown error");
      } catch (err) {
        authMsg = "login FAILED: " + err.message;
      }
    }

    created.push({ name: p.name, email: p.email, password, authOk, authMsg });
  });

  // ── Update existing teacher accounts (rank/employment/department only) ──
  setFacultyImportStatus(`Updating ${toUpdate.length} existing faculty account(s)…`);
  let updated = 0;
  await runWithConcurrency(toUpdate, 10, async (p) => {
    const { error } = await supabase.from("users").update({
      academic_rank: p.academicRank, employment_type: p.employmentType, department: p.department,
    }).eq("id", p.id);
    if (error) {
      errors.push({ row: "-", email: p.email, issues: "update failed: " + error.message });
    } else {
      updated++;
    }
  });

  // ── Supervisor Assignments pass — only runs if the workbook actually
  //    has "Supervisors" + "Assignments" sheets (the combined-file format).
  //    Runs AFTER faculty accounts above, so a brand-new teacher in this
  //    same file is already linkable. ──
  let supervisorResult = null;
  if (workbook) {
    setFacultyImportStatus("Checking for Supervisor Assignment sheets…");
    supervisorResult = await runSupervisorAssignmentImport(workbook);
  }

  renderFacultyImportSummary({
    created, updated, duplicateRows,
    errors: [...errors, ...insertErrors],
    totalRows: rows.length,
    supervisorResult,
  });

  await loadDepartments();
  await loadUsers();
}

function renderFacultyImportSummary({ created, updated, duplicateRows = 0, errors, totalRows, supervisorResult = null }) {
  setFacultyImportStatus(`Done — processed ${totalRows} row(s).`);
  const box = document.getElementById("faculty-import-summary");
  if (!box) return;

  const authFailures = created.filter(c => !c.authOk);

  let html = `
    <ul style="margin:8px 0 0; padding-left:18px; font-size:13px; line-height:1.8;">
      <li>${created.length} new faculty account(s) created</li>
      <li>${updated} existing faculty account(s) updated (rank / employment / department)</li>
      ${duplicateRows > 0 ? `<li>${duplicateRows} duplicate row(s) for the same email collapsed to one</li>` : ""}
      ${authFailures.length > 0 ? `<li style="color:#dc2626;">${authFailures.length} login(s) NOT created automatically — see below, add manually in Supabase</li>` : ""}
      <li style="${errors.length ? "color:#dc2626;" : ""}">${errors.length} row(s) skipped due to issues</li>
    </ul>
  `;

  if (created.length > 0) {
    html += `
      <p style="font-size:12px; font-weight:700; margin:14px 0 6px; color:#671408;">
        ⚠️ New account passwords — copy these down now. They cannot be shown again once this window is closed.
      </p>
      <div style="max-height:220px; overflow-y:auto; border:1px solid #f3c9bd; border-radius:6px;">
        <table style="width:100%; font-size:12px;">
          <thead><tr>
            <th style="padding:6px 8px;">Name</th>
            <th style="padding:6px 8px;">Email</th>
            <th style="padding:6px 8px;">Password</th>
            <th style="padding:6px 8px;">Login</th>
          </tr></thead>
          <tbody>
            ${created.map(c => `
              <tr>
                <td style="padding:6px 8px;">${escHtml(c.name)}</td>
                <td style="padding:6px 8px;">${escHtml(c.email)}</td>
                <td style="padding:6px 8px; font-family:monospace;">${escHtml(c.password)}</td>
                <td style="padding:6px 8px; color:${c.authOk ? "#065f46" : "#dc2626"};">${escHtml(c.authMsg)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, 50);
    html += `
      <p style="font-size:12px; font-weight:600; margin:14px 0 6px; color:#dc2626;">
        Skipped rows${errors.length > shown.length ? ` (showing first ${shown.length} of ${errors.length})` : ""}:
      </p>
      <div style="max-height:160px; overflow-y:auto; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; background:#fef2f2;">
        ${shown.map(e => `
          <div style="font-size:11px; color:#991b1b; margin-bottom:4px;">
            Row ${e.row} — <code>${escHtml(e.email)}</code>: ${escHtml(e.issues)}
          </div>
        `).join("")}
      </div>
    `;
  }

  if (supervisorResult) {
    const createdSups = supervisorResult.createdSupervisors || [];
    const grantedSups = supervisorResult.grantedSupervisors || [];
    html += `
      <hr style="margin:18px 0; border:none; border-top:1px solid #e2e8f0;" />
      <p style="font-size:13px; font-weight:700; margin:0 0 8px; color:#16324f;">🔗 Supervisor Assignments</p>
      <ul style="margin:0 0 0; padding-left:18px; font-size:13px; line-height:1.8;">
        ${createdSups.length > 0 ? `<li>${createdSups.length} new supervisor account(s) created</li>` : ""}
        ${grantedSups.length > 0 ? `<li>${grantedSups.length} existing teacher account(s) granted supervisor access (same login)</li>` : ""}
        <li>${supervisorResult.linked} faculty-to-supervisor link(s) created or confirmed</li>
        <li style="${supervisorResult.errors.length ? "color:#dc2626;" : ""}">${supervisorResult.errors.length} row(s) skipped due to issues</li>
      </ul>
    `;

    if (grantedSups.length > 0) {
      html += `
        <p style="font-size:12px; font-weight:700; margin:14px 0 6px; color:#16324f;">
          Existing teacher accounts granted supervisor access — no new password, they log in with their current credentials via either tab:
        </p>
        <div style="max-height:160px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px;">
          <table style="width:100%; font-size:12px;">
            <thead><tr>
              <th style="padding:6px 8px;">Name</th>
              <th style="padding:6px 8px;">Email</th>
              <th style="padding:6px 8px;">Department</th>
            </tr></thead>
            <tbody>
              ${grantedSups.map(g => `
                <tr>
                  <td style="padding:6px 8px;">${escHtml(g.name)}</td>
                  <td style="padding:6px 8px;">${escHtml(g.email)}</td>
                  <td style="padding:6px 8px; ${g.departmentMissing ? "color:#b45309; font-weight:600;" : ""}">
                    ${g.departmentMissing ? "⚠️ blank — check Faculty Profile sheet" : "OK"}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${grantedSups.some(g => g.departmentMissing) ? `
          <p style="font-size:11px; color:#92400e; margin:6px 0 0;">
            Blank department is a data-quality flag only — it does NOT affect who they can see or supervise
            (that's entirely supervisor_assignments), it's just display info worth fixing.
          </p>
        ` : ""}
      `;
    }

    if (createdSups.length > 0) {
      html += `
        <p style="font-size:12px; font-weight:700; margin:14px 0 6px; color:#671408;">
          ⚠️ New supervisor account passwords — copy these down now. They cannot be shown again once this window is closed.
        </p>
        <div style="max-height:220px; overflow-y:auto; border:1px solid #f3c9bd; border-radius:6px;">
          <table style="width:100%; font-size:12px;">
            <thead><tr>
              <th style="padding:6px 8px;">Name</th>
              <th style="padding:6px 8px;">Email</th>
              <th style="padding:6px 8px;">Password</th>
              <th style="padding:6px 8px;">Login</th>
            </tr></thead>
            <tbody>
              ${createdSups.map(c => `
                <tr>
                  <td style="padding:6px 8px;">${escHtml(c.name)}</td>
                  <td style="padding:6px 8px;">${escHtml(c.email)}</td>
                  <td style="padding:6px 8px; font-family:monospace;">${escHtml(c.password)}</td>
                  <td style="padding:6px 8px; color:${c.authOk ? "#065f46" : "#dc2626"};">${escHtml(c.authMsg)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    if (supervisorResult.errors.length > 0) {
      const shownSup = supervisorResult.errors.slice(0, 50);
      html += `
        <p style="font-size:12px; font-weight:600; margin:14px 0 6px; color:#dc2626;">
          Skipped assignment rows${supervisorResult.errors.length > shownSup.length ? ` (showing first ${shownSup.length} of ${supervisorResult.errors.length})` : ""}:
        </p>
        <div style="max-height:160px; overflow-y:auto; border:1px solid #fecaca; border-radius:6px; padding:8px 10px; background:#fef2f2;">
          ${shownSup.map(e => `
            <div style="font-size:11px; color:#991b1b; margin-bottom:4px;">
              Row ${e.row} — <code>${escHtml(e.email)}</code>: ${escHtml(e.issues)}
            </div>
          `).join("")}
        </div>
      `;
    }
  } else {
    html += `
      <p style="font-size:11.5px; color:#8b98a5; margin:14px 0 0;">
        No "Supervisors"/"Assignments" sheets found in this file — supervisor links were not touched.
      </p>
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
  window.location.href = "../staff.html";
});

document.getElementById("search-input").addEventListener("input", renderTable);
document.getElementById("filter-role").addEventListener("change", renderTable);
document.getElementById("filter-section").addEventListener("change", renderTable);
document.getElementById("filter-status-users")?.addEventListener("change", renderTable);
document.getElementById("filter-majoring")?.addEventListener("change", renderTable);

document.getElementById("import-users-btn")?.addEventListener("click", openImportPicker);
document.getElementById("import-choose-file-btn")?.addEventListener("click", () => {
  document.getElementById("import-file-input")?.click();
});
document.getElementById("import-file-input")?.addEventListener("change", handleImportFile);
document.getElementById("close-import-btn")?.addEventListener("click", () => {
  document.getElementById("import-modal").classList.add("hidden");
});

document.getElementById("import-faculty-btn")?.addEventListener("click", openFacultyImportPicker);
document.getElementById("faculty-import-choose-file-btn")?.addEventListener("click", () => {
  document.getElementById("faculty-roster-import-file-input")?.click();
});
document.getElementById("faculty-roster-import-file-input")?.addEventListener("change", handleFacultyImportFile);
document.getElementById("close-faculty-import-btn")?.addEventListener("click", () => {
  document.getElementById("faculty-import-modal").classList.add("hidden");
});

loadDepartments();
loadSections();
loadUsers();