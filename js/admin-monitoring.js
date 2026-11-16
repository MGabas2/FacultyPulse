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
  window.location.href = "../staff.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + (sessionStorage.getItem("name") && sessionStorage.getItem("name") !== "null" ? sessionStorage.getItem("name") : "Administrator");

// ── Fetch every row of a query, ignoring Supabase's default 1000-row
//    cap. Pass a function that builds (but doesn't execute) the query —
//    .range() gets appended fresh on every page, since a query builder
//    can't be re-run after it's already been awaited once.
//    e.g. fetchAllPages(() => supabase.from("users").select("id").eq("role","student"))
async function fetchAllPages(buildQuery) {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ── State ──
let rows           = [];   // each row = one student × one subject they're ACTUALLY enrolled in
let commentList    = [];   // identity-free comments: {subjectId, subjectName, teacherId, teacherName, comment}
let sections       = [];
let subjects       = [];
let activeSemester = null;

// ══════════════════════════════════════════════════════════════
//  LOAD EVERYTHING
//  Builds a row for every (student × subject they're actually enrolled
//  in, per student_subjects) then marks whether each one submitted.
// ══════════════════════════════════════════════════════════════
async function loadMonitoring() {
  const tbody = document.getElementById("monitor-tbody");
  tbody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;

  // 1. Active semester
  const { data: semester } = await supabase
    .from("semesters")
    .select("id, label")
    .eq("is_active", true)
    .single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="7">No active semester.</td></tr>`;
    return;
  }
  activeSemester = semester;

  let students, subs, tracking, comments, enrollments;
  try {
    // 2. All students with their section + last login
    students = await fetchAllPages(() =>
      supabase.from("users")
        .select("id, student_id, section_id, last_login, sections(name, department)")
        .eq("role", "student")
    );

    // 3. All subjects this semester (with teacher + section)
    subs = await fetchAllPages(() =>
      supabase.from("subjects")
        .select("id, name, section_id, teacher_id, users(name), sections(department)")
        .eq("semester_id", semester.id)
    );

    // 4. All submissions this semester (tracking = participation only, no comment)
    tracking = await fetchAllPages(() =>
      supabase.from("evaluation_tracking")
        .select("id, student_id, subject_id, submitted_at")
        .eq("semester_id", semester.id)
    );

    // 4b comments source data
    comments = await fetchAllPages(() =>
      supabase.from("evaluation_comments")
        .select("id, subject_id, comment")
        .eq("semester_id", semester.id)
    );

    // 5. Actual enrollment — see note below on why this can't be a
    //    plain unpaginated .select()
    enrollments = await fetchAllPages(() =>
      supabase.from("student_subjects")
        .select("student_id, subject_id")
        .eq("semester_id", semester.id)
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">
      Failed to load monitoring data: ${err.message}
      ${err.message?.includes("does not exist")
        ? " — check that all required tables/migrations exist."
        : ""}
    </td></tr>`;
    return;
  }

  if (!students || students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No students found.</td></tr>`;
    return;
  }
  const studentByStudentId = new Map(students.map(s => [s.student_id, s]));

  subjects = subs || [];
  const subjectById = new Map(subjects.map(s => [s.id, s]));

  const trackMap = new Map();
  (tracking || []).forEach(t => {
    trackMap.set(`${t.student_id}|${t.subject_id}`, t);
  });

  // Identity-free comments (separate table — no student link)
  const subjectInfo = new Map();
  subjects.forEach(s => subjectInfo.set(s.id, {
    name:        s.name,
    teacherId:   s.teacher_id || null,
    teacherName: s.users?.name || "—",
  }));

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

  // Build rows from ACTUAL enrollment (student_subjects), not from
  // "every subject offered to this student's section." Sections can
  // mix regular and irregular students with different course loads —
  // that's the whole reason student_subjects exists (see the import
  // redesign). Cross-joining by section instead of using this table
  // fabricates evaluation obligations students were never enrolled
  // in, which inflates the total row count and makes the "fully
  // submitted" completion rate essentially unreachable.
  rows = [];
  enrollments.forEach(en => {
    const student = studentByStudentId.get(en.student_id);
    const subject = subjectById.get(en.subject_id);
    if (!student || !subject) return; // orphaned enrollment row — skip rather than crash

    // Tracking rows store the student's uuid (users.id) as text; older rows
    // may hold the text Student ID — accept either.
    const track = trackMap.get(`${student.id}|${en.subject_id}`)
               || trackMap.get(`${en.student_id}|${en.subject_id}`);

    rows.push({
      studentId:   en.student_id,
      section:     student.sections?.name || "—",
      sectionId:   student.section_id,
      department:  student.sections?.department || "—",
      subjectId:   subject.id,
      subjectName: subject.name,
      teacherName: subject.users?.name || "—",
      teacherId:   subject.teacher_id || null,
      lastLogin:   student.last_login,
      submitted:   !!track,
      submittedAt: track?.submitted_at || null,
    });
  });

  // Populate filters
  populateFilters();

  // Render
  renderTable();
  renderSummary();
  renderComments();
  renderStudentDrawer();   // keep an open drawer in step with a refresh
}

// ── Populate section + subject filters ──
function populateFilters() {
  // Submission-tab filters (Program + Faculty + Section + Subject) are
  // interdependent — each one narrows the others to combinations that
  // actually exist.
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
  rebuildSelect(subSel, "All Courses", subPairs, sub);
}

// ── Interdependent (faceted) filters for the Submission Status tab ──
//    Each of Program / Faculty / Section / Subject is rebuilt to show only
//    the options consistent with the OTHER three current selections, so:
//      • pick a program → Faculty + Section + Subject narrow to that program
//      • pick a faculty → Program + Section + Subject narrow to that faculty
//      • pick a section → Program + Faculty + Subject narrow to that section
//      • pick a subject → Program + Faculty + Section narrow to that subject
//    A current selection is kept if still valid, otherwise reset to "All".
function refreshDependentFilters() {
  const progSel    = document.getElementById("filter-program");
  const facList    = document.getElementById("faculty-datalist");
  const sectionSel = document.getElementById("mon-filter-section");
  const subjectSel = document.getElementById("filter-subject");
  if (!progSel || !facList || !sectionSel || !subjectSel) return;

  const prog = progSel.value;
  const fac  = facultyIdFromInput("filter-faculty"); // resolved teacherId or ""
  const sec  = sectionSel.value;
  const sub  = subjectSel.value;

  // Program options ← rows matching current Faculty + Section + Subject
  const progPairs = new Map();
  // Faculty options ← rows matching current Program + Section + Subject
  const facPairs = new Map();
  // Section options ← rows matching current Program + Faculty + Subject
  const secPairs = new Map();
  // Subject options ← rows matching current Program + Faculty + Section
  const subPairs = new Map();

  rows.forEach(r => {
    if ((!fac || r.teacherId === fac) && (!sec || r.sectionId === sec) && (!sub || r.subjectId === sub) && r.department)
      progPairs.set(r.department, r.department);
    if ((!prog || r.department === prog) && (!sec || r.sectionId === sec) && (!sub || r.subjectId === sub) && r.teacherId)
      facPairs.set(r.teacherId, r.teacherName);
    if ((!prog || r.department === prog) && (!fac || r.teacherId === fac) && (!sub || r.subjectId === sub) && r.sectionId)
      secPairs.set(r.sectionId, r.section);
    if ((!prog || r.department === prog) && (!fac || r.teacherId === fac) && (!sec || r.sectionId === sec) && r.subjectId)
      subPairs.set(r.subjectId, r.subjectName);
  });

  rebuildSelect(progSel, "All Programs", progPairs, prog);
  rebuildFacultyDatalist(facList, facPairs);          // narrow suggestions
  rebuildSelect(sectionSel, "All Sections", secPairs, sec);
  rebuildSelect(subjectSel, "All Courses", subPairs, sub);
}

// Rebuild a <select> from an id→name Map, preserving the current value
// if it's still a valid option (otherwise it falls back to "All").
function rebuildSelect(sel, allLabel, pairs, current) {
  let html = `<option value="">${allLabel}</option>`;
  pairs.forEach((name, id) => {
    html += `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(name)}</option>`;
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
    html += `<option value="${escapeHtml(name)}"></option>`;
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
const MONITOR_SIZE = 25;

// Structural filters (search + faculty + section + subject) — shared by the
// table and the summary cards. Status is intentionally NOT included here:
// the summary cards report the submitted/pending breakdown, so filtering them
// by status would be circular.
function applyStructuralFilters(list) {
  const search        = document.getElementById("mon-search-input").value.toLowerCase();
  const filterSection = document.getElementById("mon-filter-section").value;
  const filterFaculty = facultyIdFromInput("filter-faculty");
  const filterSubject = document.getElementById("filter-subject").value;
  const filterProgram = document.getElementById("filter-program")?.value || "";

  return list.filter(r => {
    const matchSearch  = !search        || r.studentId.toLowerCase().includes(search);
    const matchSection = !filterSection || r.sectionId === filterSection;
    const matchFaculty = !filterFaculty || r.teacherId === filterFaculty;
    const matchSubject = !filterSubject || r.subjectId === filterSubject;
    const matchProgram = !filterProgram || r.department === filterProgram;
    return matchSearch && matchSection && matchFaculty && matchSubject && matchProgram;
  });
}

// One entry per STUDENT (not per course). `list` is the already-filtered
// set of student × course rows; each student's courses are folded into a
// done/total count so the table stays one line per student. The full
// course list lives in the side drawer (openStudentDrawer).
function groupByStudent(list) {
  const map = new Map();
  list.forEach(r => {
    let g = map.get(r.studentId);
    if (!g) {
      g = { studentId: r.studentId, section: r.section, lastLogin: r.lastLogin,
            total: 0, done: 0, lastSubmittedAt: null };
      map.set(r.studentId, g);
    }
    g.total++;
    if (r.submitted) {
      g.done++;
      if (r.submittedAt && (!g.lastSubmittedAt || r.submittedAt > g.lastSubmittedAt)) {
        g.lastSubmittedAt = r.submittedAt;
      }
    }
  });
  return [...map.values()];
}

// complete | partial | not-started | never-login
function studentState(g) {
  if (g.total > 0 && g.done === g.total) return "complete";
  if (g.done > 0)                        return "partial";
  return g.lastLogin ? "not-started" : "never-login";
}

const STATE_BADGE = {
  "complete":    `<span class="badge submitted">Complete</span>`,
  "partial":     `<span class="badge partial">In Progress</span>`,
  "not-started": `<span class="badge not-submitted">Not Started</span>`,
  "never-login": `<span class="badge never-login">Never Logged In</span>`,
};

function renderTable() {
  const filterStatus = document.getElementById("filter-status").value;

  // Structural filters first (which courses count), fold to one entry per
  // student, then the status filter on the STUDENT — the same definition
  // the summary cards use, so the cards and the table always agree.
  const allGroups = groupByStudent(applyStructuralFilters(rows));
  const groups = allGroups.filter(g => {
    const st = studentState(g);
    if (filterStatus === "submitted")     return st === "complete";
    if (filterStatus === "partial")       return st === "partial";
    if (filterStatus === "not-submitted") return st !== "complete";   // includes never-logged-in
    if (filterStatus === "never-login")   return st === "never-login";
    return true;
  });

  // Section, then Student ID — a stable order QA can scan.
  groups.sort((a, b) =>
    String(a.section).localeCompare(String(b.section)) ||
    String(a.studentId).localeCompare(String(b.studentId)));

  const totalStudents = new Set(rows.map(r => r.studentId)).size;
  document.getElementById("row-count").textContent =
    `Showing ${groups.length} of ${totalStudents} students`;

  const tbody = document.getElementById("monitor-tbody");

  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No students match the filters.</td></tr>`;
    document.getElementById("monitor-page-info").textContent = "";
    document.getElementById("monitor-page-buttons").innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(groups.length / MONITOR_SIZE);
  if (monitorPage > totalPages) monitorPage = totalPages;
  if (monitorPage < 1) monitorPage = 1;

  const start = (monitorPage - 1) * MONITOR_SIZE;
  const end   = start + MONITOR_SIZE;

  tbody.innerHTML = groups.slice(start, end).map(g => {
    const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
    const sid = escapeHtml(g.studentId);
    return `
      <tr class="mon-student-row" data-student="${sid}" tabindex="0"
          title="Show this student's courses">
        <td><b>${sid}</b></td>
        <td>${escapeHtml(g.section)}</td>
        <td>
          <div class="mon-progress">
            <div class="mon-progress-track"><div class="mon-progress-fill${pct === 100 ? " full" : ""}" style="width:${pct}%;"></div></div>
            <span class="mon-progress-num">${g.done} / ${g.total}</span>
          </div>
        </td>
        <td>${STATE_BADGE[studentState(g)]}</td>
        <td class="last-login-cell">${timeAgo(g.lastLogin)}</td>
        <td class="last-login-cell">${timeAgo(g.lastSubmittedAt)}</td>
        <td style="text-align:center;"><button type="button" class="btn-secondary mon-courses-btn">View</button></td>
      </tr>`;
  }).join("");

  document.getElementById("monitor-page-info").textContent =
    `Page ${monitorPage} of ${totalPages} — showing students ${start + 1}–${Math.min(end, groups.length)} of ${groups.length}`;

  renderMonitorPager(totalPages);
}

// ══════════════════════════════════════════════════════════════
//  STUDENT COURSES DRAWER
//  The per-course detail that used to stretch the table: every course
//  this student is enrolled in, and whether each one is submitted.
//  Always shows ALL of the student's courses, whatever filters are on.
// ══════════════════════════════════════════════════════════════
let drawerStudentId = null;

// This module runs on TWO pages: the standalone admin-monitoring.html and
// the Monitoring panel inside admin.html. Build the drawer, the table
// header and the extra status option here when the page doesn't have them,
// so an older or cached copy of either page can never break the module.
const MON_STYLES = `
.badge.partial { background:#dbeafe; color:#1e40af; }

.mon-student-row { cursor: pointer; }
.mon-student-row:hover, .mon-student-row:focus-visible { background: #fdf7f1; outline: none; }
.mon-courses-btn { font-size: 12px; padding: 4px 10px; }

.mon-progress { display: flex; align-items: center; gap: 8px; min-width: 130px; }
.mon-progress-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; min-width: 60px; }
.mon-progress-fill { height: 100%; background: #d97706; }
.mon-progress-fill.full { background: #16a34a; }
.mon-progress-num { font-size: 12px; color: #475569; white-space: nowrap; font-variant-numeric: tabular-nums; }

#mon-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(15,23,42,.25);
  opacity: 0; pointer-events: none; transition: opacity .2s ease; z-index: 890;
}
#mon-drawer-backdrop.open { opacity: 1; pointer-events: auto; }
#mon-drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: min(400px, 100vw);
  background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,.18);
  transform: translateX(105%); transition: transform .2s ease;
  z-index: 900; display: flex; flex-direction: column;
}
#mon-drawer.open { transform: translateX(0); }
.mon-drawer-head { padding: 14px 16px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: flex-start; gap: 8px; }
#mon-drawer-title { font-weight: 700; font-size: 15px; }
#mon-drawer-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
#mon-drawer-close { font-size: 13px; padding: 4px 10px; }
#mon-drawer-list { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 4px 16px 16px; }
.mon-drawer-item { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
.mon-drawer-course { min-width: 0; }
.mon-drawer-name { font-size: 13px; font-weight: 600; color: #1e293b; }
.mon-drawer-teacher { font-size: 12px; color: #94a3b8; }
.mon-drawer-status { flex: none; text-align: right; }
.mon-drawer-when { font-size: 11px; color: #64748b; margin-top: 3px; }
.mon-table-wrap { overflow-x: auto; }
.mon-table-wrap table { min-width: 720px; }
`;

function ensureMonitoringMarkup() {
  // Styles travel with the module: admin.html loads admin.css, not
  // admin-monitoring.css, so the drawer would otherwise be unstyled there.
  if (!document.getElementById("mon-styles")) {
    const st = document.createElement("style");
    st.id = "mon-styles";
    st.textContent = MON_STYLES;
    document.head.appendChild(st);
  }

  const table = document.getElementById("monitor-tbody")?.closest("table");
  if (table && !table.parentElement.classList.contains("mon-table-wrap")) {
    const wrapDiv = document.createElement("div");
    wrapDiv.className = "mon-table-wrap";
    table.parentElement.insertBefore(wrapDiv, table);
    wrapDiv.appendChild(table);
  }

  if (!document.getElementById("mon-drawer")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="mon-drawer-backdrop"></div>
      <aside id="mon-drawer" aria-hidden="true">
        <div class="mon-drawer-head">
          <div style="flex:1; min-width:0;">
            <div id="mon-drawer-title">Student</div>
            <div id="mon-drawer-sub"></div>
          </div>
          <button id="mon-drawer-close" type="button" class="btn-secondary" aria-label="Close">✕</button>
        </div>
        <div id="mon-drawer-list"></div>
      </aside>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }

  const headRow = document.getElementById("monitor-tbody")?.closest("table")?.querySelector("thead tr");
  if (headRow && headRow.children.length !== 7) {
    headRow.innerHTML = `
      <th>Student ID</th>
      <th>Section</th>
      <th>Courses Submitted</th>
      <th>Status</th>
      <th>Last Login</th>
      <th>Last Submitted</th>
      <th style="width:74px; text-align:center;">Courses</th>`;
  }

  const statusSel = document.getElementById("filter-status");
  if (statusSel && !statusSel.querySelector('option[value="partial"]')) {
    statusSel.innerHTML = `
      <option value="">All Statuses</option>
      <option value="submitted">Complete (all courses)</option>
      <option value="not-submitted">Not Yet Complete</option>
      <option value="partial">In Progress (some courses)</option>
      <option value="never-login">Never Logged In</option>`;
  }
}
ensureMonitoringMarkup();

function renderStudentDrawer() {
  if (!drawerStudentId) return;
  const mine = rows.filter(r => r.studentId === drawerStudentId);
  const list = document.getElementById("mon-drawer-list");
  if (mine.length === 0) {           // e.g. un-enrolled since the last refresh
    closeStudentDrawer();
    return;
  }
  const done = mine.filter(r => r.submitted).length;

  document.getElementById("mon-drawer-title").textContent = drawerStudentId;
  document.getElementById("mon-drawer-sub").textContent =
    `${mine[0].section} · ${done} of ${mine.length} submitted · last login ${timeAgo(mine[0].lastLogin)}`;

  // Pending first — that's what QA is chasing — then by course name.
  mine.sort((a, b) => (a.submitted - b.submitted) ||
    String(a.subjectName).localeCompare(String(b.subjectName)));

  list.innerHTML = mine.map(r => `
    <div class="mon-drawer-item">
      <div class="mon-drawer-course">
        <div class="mon-drawer-name">${escapeHtml(r.subjectName)}</div>
        <div class="mon-drawer-teacher">${escapeHtml(r.teacherName)}</div>
      </div>
      <div class="mon-drawer-status">
        ${r.submitted
          ? `<span class="badge submitted">Submitted</span><div class="mon-drawer-when">${timeAgo(r.submittedAt)}</div>`
          : `<span class="badge not-submitted">Not Yet</span>`}
      </div>
    </div>`).join("");
}

function openStudentDrawer(studentId) {
  drawerStudentId = studentId;
  renderStudentDrawer();
  if (!drawerStudentId) return;
  const d = document.getElementById("mon-drawer");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  document.getElementById("mon-drawer-backdrop").classList.add("open");
}

function closeStudentDrawer() {
  drawerStudentId = null;
  const d = document.getElementById("mon-drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  document.getElementById("mon-drawer-backdrop").classList.remove("open");
}

document.getElementById("monitor-tbody").addEventListener("click", (e) => {
  const row = e.target.closest(".mon-student-row");
  if (row) openStudentDrawer(row.dataset.student);
});
document.getElementById("monitor-tbody").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.closest("button")) return;
  const row = e.target.closest(".mon-student-row");
  if (row) openStudentDrawer(row.dataset.student);
});
document.getElementById("mon-drawer-close").addEventListener("click", closeStudentDrawer);
document.getElementById("mon-drawer-backdrop").addEventListener("click", closeStudentDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerStudentId) closeStudentDrawer(); });

// ── Relative time formatter ──
// < 1 min   → "just now"
// < 1 hour  → "X minutes ago"
// < 24 hrs  → "X hours ago"
// yesterday → "yesterday, HH:MM AM/PM"
// < 7 days  → "X days ago"
// >= 7 days → full date + time
function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const date  = new Date(dateStr);
  const now   = new Date();
  const diff  = Math.floor((now - date) / 1000); // seconds

  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min${Math.floor(diff / 60) > 1 ? "s" : ""} ago`;

  const diffHours = Math.floor(diff / 3600);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;

  // Check if it was "yesterday"
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "yesterday, " + date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
  }

  const diffDays = Math.floor(diff / 86400);
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  // >= 7 days → full date and time
  return date.toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
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
       🔒 To protect student anonymity, comments are shown only for courses with
       at least ${MIN_RESPONSES} responses.
     </div>`;

  if (visible.length === 0) {
    const msg = hiddenSubjects.size > 0
      ? `Comments exist, but every matching course has fewer than ${MIN_RESPONSES} responses, so they are hidden to protect anonymity.`
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
  const btn = document.getElementById("refresh-btn-mon");
  if (btn) { btn.textContent = "🔄 Refreshing..."; btn.disabled = true; }
  loadMonitoring().finally(() => {
    if (btn) { btn.textContent = "🔄 Refresh"; btn.disabled = false; }
  });
}

// ── Attach events ──
document.getElementById("mon-search-input").addEventListener("input", onFilterChange);
document.getElementById("filter-status").addEventListener("change", onFilterChange);

// Faculty / Section / Subject are interdependent — refresh the other
// dropdowns' options, then re-render.
function onStructuralFilterChange() {
  refreshDependentFilters();
  onFilterChange(); // reset to page 1 + re-render
}
document.getElementById("filter-faculty").addEventListener("input", onStructuralFilterChange);
document.getElementById("mon-filter-section").addEventListener("change", onStructuralFilterChange);
document.getElementById("filter-subject").addEventListener("change", onStructuralFilterChange);

const programFilterEl = document.getElementById("filter-program");
if (programFilterEl) programFilterEl.addEventListener("change", onStructuralFilterChange);

// Reset all filters back to "All"
const resetBtn = document.getElementById("reset-filters");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    document.getElementById("mon-search-input").value = "";
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-faculty").value = "";
    document.getElementById("mon-filter-section").value = "";
    document.getElementById("filter-subject").value = "";
    const progFilter = document.getElementById("filter-program");
    if (progFilter) progFilter.value = "";
    refreshDependentFilters(); // rebuild full option lists
    onFilterChange();
  });
}

const monRefreshBtn = document.getElementById("refresh-btn-mon");
if (monRefreshBtn) monRefreshBtn.addEventListener("click", refreshMonitoring);

document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../staff.html";
});

// ── Init ──
loadMonitoring();