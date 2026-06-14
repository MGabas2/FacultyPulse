// ============================================================
//  FacultyPulse — Admin Submission Monitoring
//
//  Shows the admin/QA:
//   - Who submitted, who hasn't, who never logged in
//   - When each student last logged in
//   - Each comment (with who wrote it) + verify valid/invalid
//
//  This is the ONE place identity is intentionally visible —
//  for QA monitoring and comment verification per CMO process.
// ============================================================

import { supabase } from "./supabase.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../index.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + sessionStorage.getItem("name");

// ── State ──
let rows           = [];   // each row = one student × one subject (participation)
let commentList    = [];   // identity-free comments: {subjectId, subjectName, teacherId, teacherName, comment}
let sections       = [];
let subjects       = [];
let activeSemester = null;

// ══════════════════════════════════════════════════════════════
//  LOAD EVERYTHING
//  Builds a row for every (student × subject they should evaluate)
//  then marks whether each one submitted.
// ══════════════════════════════════════════════════════════════
async function loadMonitoring() {
  const tbody = document.getElementById("monitor-tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  // 1. Active semester
  const { data: semester } = await supabase
    .from("semesters")
    .select("id, label")
    .eq("is_active", true)
    .single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="6">No active semester.</td></tr>`;
    return;
  }
  activeSemester = semester;

  // 2. All students with their section + last login
  const { data: students } = await supabase
    .from("users")
    .select("id, student_id, section_id, last_login, sections(name)")
    .eq("role", "student");

  if (!students || students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No students found.</td></tr>`;
    return;
  }

  // 3. All subjects this semester (with teacher + section)
  const { data: subs } = await supabase
    .from("subjects")
    .select("id, name, section_id, teacher_id, users(name)")
    .eq("semester_id", semester.id);

  subjects = subs || [];

  // 4. All submissions this semester (tracking = participation only, no comment)
  const { data: tracking } = await supabase
    .from("evaluation_tracking")
    .select("id, student_id, subject_id, submitted_at")
    .eq("semester_id", semester.id);

  const trackMap = new Map();
  (tracking || []).forEach(t => {
    trackMap.set(`${t.student_id}|${t.subject_id}`, t);
  });

  // 4b. Identity-free comments (separate table — no student link)
  const subjectInfo = new Map();
  subjects.forEach(s => subjectInfo.set(s.id, {
    name:        s.name,
    teacherId:   s.teacher_id || null,
    teacherName: s.users?.name || "—",
  }));

  const { data: comments } = await supabase
    .from("evaluation_comments")
    .select("id, subject_id, comment")
    .eq("semester_id", semester.id);

  commentList = (comments || [])
    .filter(c => subjectInfo.has(c.subject_id))
    .map(c => {
      const info = subjectInfo.get(c.subject_id);
      return {
        subjectId:   c.subject_id,
        subjectName: info.name,
        teacherId:   info.teacherId,
        teacherName: info.teacherName,
        comment:     c.comment,
      };
    });

  // 5. Build rows: each student × each subject in their section
  rows = [];
  students.forEach(student => {
    const studentSubjects = subjects.filter(s => s.section_id === student.section_id);

    studentSubjects.forEach(subject => {
      const key   = `${student.student_id}|${subject.id}`;
      const track = trackMap.get(key);

      rows.push({
        studentId:   student.student_id,
        section:     student.sections?.name || "—",
        sectionId:   student.section_id,
        subjectId:   subject.id,
        subjectName: subject.name,
        teacherName: subject.users?.name || "—",
        teacherId:   subject.teacher_id || null,
        lastLogin:   student.last_login,
        submitted:   !!track,
        submittedAt: track?.submitted_at || null,
      });
    });
  });

  // Populate filters
  populateFilters();

  // Render
  renderTable();
  renderSummary();
  renderComments();
}

// ── Populate section + subject filters ──
function populateFilters() {
  // Submission-tab filters (Faculty + Section + Subject) are interdependent —
  // each one narrows the others to combinations that actually exist.
  refreshDependentFilters();

  // Comments-tab filters (Faculty + Subject) are also interdependent
  refreshCommentsFilters();
}

// ── Interdependent (faceted) filters for the Student Comments tab ──
//    Faculty and Subject narrow each other, based on rows that have a comment.
function refreshCommentsFilters() {
  const facList = document.getElementById("comments-faculty-datalist");
  const subSel  = document.getElementById("comments-subject");
  if (!facList || !subSel) return;

  const fac = facultyIdFromInput("comments-faculty"); // resolved teacherId or ""
  const sub = subSel.value;

  const facPairs = new Map(); // teacherId -> name
  const subPairs = new Map(); // subjectId -> name
  commentList.forEach(c => {
    if ((!sub || c.subjectId === sub) && c.teacherId) facPairs.set(c.teacherId, c.teacherName);
    if ((!fac || c.teacherId === fac) && c.subjectId) subPairs.set(c.subjectId, c.subjectName);
  });

  rebuildFacultyDatalist(facList, facPairs);
  rebuildSelect(subSel, "All Subjects", subPairs, sub);
}

// ── Interdependent (faceted) filters for the Submission Status tab ──
//    Each of Faculty / Section / Subject is rebuilt to show only the
//    options consistent with the OTHER two current selections, so:
//      • pick a faculty → Section + Subject narrow to that faculty
//      • pick a section → Faculty + Subject narrow to that section
//      • pick a subject → Faculty + Section narrow to that subject
//    A current selection is kept if still valid, otherwise reset to "All".
function refreshDependentFilters() {
  const facList    = document.getElementById("faculty-datalist");
  const sectionSel = document.getElementById("filter-section");
  const subjectSel = document.getElementById("filter-subject");
  if (!facList || !sectionSel || !subjectSel) return;

  const fac = facultyIdFromInput("filter-faculty"); // resolved teacherId or ""
  const sec = sectionSel.value;
  const sub = subjectSel.value;

  // Faculty options ← rows matching current Section + Subject
  const facPairs = new Map();
  // Section options ← rows matching current Faculty + Subject
  const secPairs = new Map();
  // Subject options ← rows matching current Faculty + Section
  const subPairs = new Map();

  rows.forEach(r => {
    if ((!sec || r.sectionId === sec) && (!sub || r.subjectId === sub) && r.teacherId)
      facPairs.set(r.teacherId, r.teacherName);
    if ((!fac || r.teacherId === fac) && (!sub || r.subjectId === sub) && r.sectionId)
      secPairs.set(r.sectionId, r.section);
    if ((!fac || r.teacherId === fac) && (!sec || r.sectionId === sec) && r.subjectId)
      subPairs.set(r.subjectId, r.subjectName);
  });

  rebuildFacultyDatalist(facList, facPairs);          // narrow suggestions
  rebuildSelect(sectionSel, "All Sections", secPairs, sec);
  rebuildSelect(subjectSel, "All Subjects", subPairs, sub);
}

// Rebuild a <select> from an id→name Map, preserving the current value
// if it's still a valid option (otherwise it falls back to "All").
function rebuildSelect(sel, allLabel, pairs, current) {
  let html = `<option value="">${allLabel}</option>`;
  pairs.forEach((name, id) => {
    html += `<option value="${id}"${id === current ? " selected" : ""}>${name}</option>`;
  });
  sel.innerHTML = html;
  if (current && !pairs.has(current)) sel.value = "";
}

// ── Faculty autocomplete combobox helpers ──
// The faculty filter is a text input + <datalist> (search-as-you-type) so it
// scales to many teachers. The input holds the typed NAME; these helpers
// resolve it to a teacherId and rebuild the suggestion list.
function facultyIdFromInput(inputId) {
  const text = (document.getElementById(inputId)?.value || "").trim().toLowerCase();
  if (!text) return "";
  const hit = rows.find(r => r.teacherId && (r.teacherName || "").toLowerCase() === text);
  return hit ? hit.teacherId : "";
}

function rebuildFacultyDatalist(datalistEl, pairs) {
  if (!datalistEl) return;
  const names = new Set();
  pairs.forEach(name => names.add(name));
  let html = "";
  names.forEach(name => {
    html += `<option value="${String(name).replace(/"/g, "&quot;")}"></option>`;
  });
  datalistEl.innerHTML = html;
}

// ── Render summary cards ──
function renderSummary() {
  // Reflect the current structural filters (faculty/section/subject/search)
  const subset = applyStructuralFilters(rows);

  // Count unique students (not rows)
  const uniqueStudents = new Set(subset.map(r => r.studentId));
  const total = uniqueStudents.size;

  // A student "submitted" if they completed ALL their subjects (within the filter)
  const studentStatus = {};
  subset.forEach(r => {
    if (!studentStatus[r.studentId]) {
      studentStatus[r.studentId] = { total: 0, done: 0 };
    }
    studentStatus[r.studentId].total++;
    if (r.submitted) studentStatus[r.studentId].done++;
  });

  let fullyDone = 0;
  Object.values(studentStatus).forEach(s => {
    if (s.done === s.total) fullyDone++;
  });

  const pending = total - fullyDone;
  const rate    = total > 0 ? Math.round((fullyDone / total) * 100) : 0;

  document.getElementById("card-total").textContent     = total;
  document.getElementById("card-submitted").textContent = fullyDone;
  document.getElementById("card-pending").textContent   = pending;
  document.getElementById("card-rate").textContent      = rate + "%";
  document.getElementById("progress-fill").style.width  = rate + "%";
}

// ── Render the table ──
let monitorPage = 1;
const MONITOR_SIZE = 20;

// Structural filters (search + faculty + section + subject) — shared by the
// table and the summary cards. Status is intentionally NOT included here:
// the summary cards report the submitted/pending breakdown, so filtering them
// by status would be circular.
function applyStructuralFilters(list) {
  const search        = document.getElementById("search-input").value.toLowerCase();
  const filterSection = document.getElementById("filter-section").value;
  const filterFaculty = facultyIdFromInput("filter-faculty");
  const filterSubject = document.getElementById("filter-subject").value;

  return list.filter(r => {
    const matchSearch  = !search        || r.studentId.toLowerCase().includes(search);
    const matchSection = !filterSection || r.sectionId === filterSection;
    const matchFaculty = !filterFaculty || r.teacherId === filterFaculty;
    const matchSubject = !filterSubject || r.subjectId === filterSubject;
    return matchSearch && matchSection && matchFaculty && matchSubject;
  });
}

function renderTable() {
  const filterStatus = document.getElementById("filter-status").value;

  // Structural filters first, then the status filter on top.
  let filtered = applyStructuralFilters(rows).filter(r => {
    if (filterStatus === "submitted")     return r.submitted;
    if (filterStatus === "not-submitted") return !r.submitted;             // includes never-logged-in
    if (filterStatus === "never-login")   return !r.submitted && !r.lastLogin;
    return true;
  });

  document.getElementById("row-count").textContent =
    `Showing ${filtered.length} of ${rows.length} records`;

  const tbody = document.getElementById("monitor-tbody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No records match the filters.</td></tr>`;
    document.getElementById("monitor-page-info").textContent = "";
    document.getElementById("monitor-page-buttons").innerHTML = "";
    return;
  }

  // ── Pagination ──
  const totalPages = Math.ceil(filtered.length / MONITOR_SIZE);
  if (monitorPage > totalPages) monitorPage = totalPages;
  if (monitorPage < 1) monitorPage = 1;

  const start = (monitorPage - 1) * MONITOR_SIZE;
  const end   = start + MONITOR_SIZE;
  const pageRows = filtered.slice(start, end);

  tbody.innerHTML = "";
  pageRows.forEach(r => {
    // Status badge
    let badge;
    if (r.submitted) {
      badge = `<span class="badge submitted">Submitted</span>`;
    } else if (r.lastLogin) {
      badge = `<span class="badge not-submitted">Not Yet</span>`;
    } else {
      badge = `<span class="badge never-login">Never Logged In</span>`;
    }

    // Last login formatted
    const lastLogin = r.lastLogin
      ? new Date(r.lastLogin).toLocaleString("en-PH", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        })
      : "—";

    // Submitted at formatted
    const submittedAt = r.submittedAt
      ? new Date(r.submittedAt).toLocaleString("en-PH", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        })
      : "—";

    tbody.innerHTML += `
      <tr>
        <td><b>${r.studentId}</b></td>
        <td>${r.section}</td>
        <td>${r.subjectName}<br/><small style="color:#94a3b8;">${r.teacherName}</small></td>
        <td class="last-login-cell">${lastLogin}</td>
        <td>${badge}</td>
        <td class="last-login-cell">${submittedAt}</td>
      </tr>
    `;
  });

  // Render pagination controls
  document.getElementById("monitor-page-info").textContent =
    `Page ${monitorPage} of ${totalPages} — showing ${start + 1}–${Math.min(end, filtered.length)}`;

  renderMonitorPager(totalPages);
}

// ── Pagination renderer ──
function renderMonitorPager(totalPages) {
  const container = document.getElementById("monitor-page-buttons");
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const go = (p) => { monitorPage = p; renderTable(); };

  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.textContent = "‹ Prev";
  prev.disabled = monitorPage === 1;
  prev.onclick = () => go(monitorPage - 1);
  container.appendChild(prev);

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= monitorPage - 2 && i <= monitorPage + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  pages.forEach(p => {
    if (p === "...") {
      const span = document.createElement("span");
      span.textContent = "…";
      span.style.cssText = "padding:6px 4px; color:#94a3b8;";
      container.appendChild(span);
    } else {
      const btn = document.createElement("button");
      btn.className = "page-btn" + (p === monitorPage ? " active" : "");
      btn.textContent = p;
      btn.onclick = () => go(p);
      container.appendChild(btn);
    }
  });

  const next = document.createElement("button");
  next.className = "page-btn";
  next.textContent = "Next ›";
  next.disabled = monitorPage === totalPages;
  next.onclick = () => go(monitorPage + 1);
  container.appendChild(next);
}

// ══════════════════════════════════════════════════════════════
//  STUDENT COMMENTS VIEW — read-only, grouped Faculty → Subject
//  QA reads these and manually transcribes/summarizes the best ones
//  onto the printed IFER form. No verification happens here.
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Minimum number of respondents a subject must have before its comments are
// shown. Protects against correlation/re-identification: if only a few
// students submitted, a comment could be inferred to a specific student by
// cross-referencing the submission monitor. Standard k-anonymity practice.
const MIN_RESPONSES = 5;

function renderComments() {
  const fFaculty = facultyIdFromInput("comments-faculty");
  const fSubject = document.getElementById("comments-subject").value;
  const search   = (document.getElementById("comments-search")?.value || "").toLowerCase();

  // Respondents (submitters) per subject — computed from ALL rows, not just
  // commented ones. This is the count that determines re-identification risk.
  const respondentsBySubject = new Map();
  rows.forEach(r => {
    if (r.submitted) {
      respondentsBySubject.set(r.subjectId, (respondentsBySubject.get(r.subjectId) || 0) + 1);
    }
  });

  // Comments after filters (from the identity-free comments table)
  let filteredComments = commentList.slice();
  if (fFaculty) filteredComments = filteredComments.filter(c => c.teacherId === fFaculty);
  if (fSubject) filteredComments = filteredComments.filter(c => c.subjectId === fSubject);
  if (search) {
    filteredComments = filteredComments.filter(c =>
      (c.teacherName && c.teacherName.toLowerCase().includes(search)) ||
      (c.subjectName && c.subjectName.toLowerCase().includes(search))
    );
  }

  // Split into visible (subject met threshold) and hidden (below threshold)
  const visible = [];
  let hiddenSubjects = new Set();
  filteredComments.forEach(c => {
    const respondents = respondentsBySubject.get(c.subjectId) || 0;
    if (respondents >= MIN_RESPONSES) visible.push(c);
    else hiddenSubjects.add(c.subjectId);
  });

  const countEl = document.getElementById("comments-count");
  if (countEl) {
    countEl.textContent =
      `${visible.length} comment${visible.length === 1 ? "" : "s"}`;
  }

  const container = document.getElementById("comments-container");

  // Persistent anonymity policy note (always shown — its presence reveals nothing)
  const policyNote =
    `<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px;
                 padding:8px 12px; margin-bottom:14px; font-size:12px; color:#1e40af;">
       🔒 To protect student anonymity, comments are shown only for subjects with
       at least ${MIN_RESPONSES} responses.
     </div>`;

  if (visible.length === 0) {
    const msg = hiddenSubjects.size > 0
      ? `Comments exist, but every matching subject has fewer than ${MIN_RESPONSES} responses, so they are hidden to protect anonymity.`
      : `No comments match the filters.`;
    container.innerHTML = policyNote +
      `<p style="color:#94a3b8; padding:8px 0;">${msg}</p>`;
    return;
  }

  // Group visible comments: faculty → subject → [comments]
  // Comments are shown anonymously here — QA reads them to pick/summarize
  // for the printed form. Student identity is never displayed in this tab.
  const byFaculty = new Map();
  visible.forEach(c => {
    const fKey = c.teacherName || "—";
    if (!byFaculty.has(fKey)) byFaculty.set(fKey, new Map());
    const subjMap = byFaculty.get(fKey);
    const sKey = c.subjectName || "—";
    if (!subjMap.has(sKey)) subjMap.set(sKey, []);
    subjMap.get(sKey).push(c);
  });

  let html = policyNote;
  byFaculty.forEach((subjMap, faculty) => {
    let facultyCount = 0;
    subjMap.forEach(arr => { facultyCount += arr.length; });

    html += `<div class="faculty-group">
      <h3>${escapeHtml(faculty)}
        <span style="font-weight:normal; font-size:13px; color:#64748b;">
          (${facultyCount} comment${facultyCount === 1 ? "" : "s"})
        </span>
      </h3>`;

    subjMap.forEach((arr, subject) => {
      html += `<div class="subject-group">
        <h4>${escapeHtml(subject)} — ${arr.length} comment${arr.length === 1 ? "" : "s"}</h4>`;
      arr.forEach(c => {
        html += `<div class="comment-card">
          <div class="c-text">"${escapeHtml(c.comment)}"</div>
        </div>`;
      });
      html += `</div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

// ── Tab switching (Submission Status ↔ Student Comments) ──
function switchView(view) {
  const isComments = view === "comments";
  document.getElementById("view-monitoring").style.display = isComments ? "none" : "";
  document.getElementById("view-comments").style.display   = isComments ? ""     : "none";
  document.getElementById("tab-monitoring").classList.toggle("active", !isComments);
  document.getElementById("tab-comments").classList.toggle("active", isComments);
  if (isComments) renderComments();
}

document.getElementById("tab-monitoring")
  .addEventListener("click", () => switchView("monitoring"));
document.getElementById("tab-comments")
  .addEventListener("click", () => switchView("comments"));

// Faculty / Subject are interdependent on the comments tab too.
function onCommentsFilterChange() {
  refreshCommentsFilters();
  renderComments();
}
document.getElementById("comments-faculty")
  .addEventListener("input", onCommentsFilterChange);
document.getElementById("comments-subject")
  .addEventListener("change", onCommentsFilterChange);

const commentsSearch = document.getElementById("comments-search");
if (commentsSearch) commentsSearch.addEventListener("input", renderComments);

const commentsReset = document.getElementById("comments-reset");
if (commentsReset) {
  commentsReset.addEventListener("click", () => {
    document.getElementById("comments-search").value = "";
    document.getElementById("comments-faculty").value = "";
    document.getElementById("comments-subject").value = "";
    refreshCommentsFilters();
    renderComments();
  });
}

// ══════════════════════════════════════════════════════════════
//  Filter changes reset to page 1
// ══════════════════════════════════════════════════════════════

// ── Filter changes reset to page 1 ──
function onFilterChange() {
  monitorPage = 1;
  renderTable();
  renderSummary(); // keep the summary cards in sync with the filters
}

// ── Refresh — reloads all data from Supabase ──
function refreshMonitoring() {
  const btn = document.getElementById("refresh-btn");
  if (btn) { btn.textContent = "🔄 Refreshing..."; btn.disabled = true; }
  loadMonitoring().finally(() => {
    if (btn) { btn.textContent = "🔄 Refresh"; btn.disabled = false; }
  });
}

// ── Attach events ──
document.getElementById("search-input").addEventListener("input", onFilterChange);
document.getElementById("filter-status").addEventListener("change", onFilterChange);

// Faculty / Section / Subject are interdependent — refresh the other
// dropdowns' options, then re-render.
function onStructuralFilterChange() {
  refreshDependentFilters();
  onFilterChange(); // reset to page 1 + re-render
}
document.getElementById("filter-faculty").addEventListener("input", onStructuralFilterChange);
document.getElementById("filter-section").addEventListener("change", onStructuralFilterChange);
document.getElementById("filter-subject").addEventListener("change", onStructuralFilterChange);

// Reset all filters back to "All"
const resetBtn = document.getElementById("reset-filters");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    document.getElementById("search-input").value = "";
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-faculty").value = "";
    document.getElementById("filter-section").value = "";
    document.getElementById("filter-subject").value = "";
    refreshDependentFilters(); // rebuild full option lists
    onFilterChange();
  });
}

const monRefreshBtn = document.getElementById("refresh-btn");
if (monRefreshBtn) monRefreshBtn.addEventListener("click", refreshMonitoring);

document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// ── Init ──
loadMonitoring();