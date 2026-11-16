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
        .select("id, student_id, name, section_id, last_login, sections(name, department)")
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
      studentName: (student.name || "").trim(),
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
  renderMonDrawer();       // keep an open drawer in step with a refresh
  loadRequests(semester.id);   // separate table; its failure never blocks monitoring
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
    const matchSearch  = !search        || r.studentId.toLowerCase().includes(search)
      || (r.studentName || "").toLowerCase().includes(search)
      || (monView === "faculty" && (r.teacherName || "").toLowerCase().includes(search));
    const matchSection = !filterSection || r.sectionId === filterSection;
    const matchFaculty = !filterFaculty || r.teacherId === filterFaculty;
    const matchSubject = !filterSubject || r.subjectId === filterSubject;
    const matchProgram = !filterProgram || r.department === filterProgram;
    return matchSearch && matchSection && matchFaculty && matchSubject && matchProgram;
  });
}

// ── Grouping ─────────────────────────────────────────────────────
// `list` is the already-filtered set of student × course rows. The table
// shows ONE line per faculty (default) or per student; the per-course /
// per-student detail lives in the side drawer.
let monView = "faculty";   // "faculty" | "student"

function groupByStudent(list) {
  const map = new Map();
  list.forEach(r => {
    let g = map.get(r.studentId);
    if (!g) {
      g = { key: r.studentId, studentId: r.studentId, studentName: r.studentName, section: r.section, lastLogin: r.lastLogin,
            total: 0, done: 0, lastSubmittedAt: null };
      map.set(r.studentId, g);
    }
    g.total++;
    if (r.submitted) {
      g.done++;
      if (r.submittedAt && (!g.lastSubmittedAt || r.submittedAt > g.lastSubmittedAt)) g.lastSubmittedAt = r.submittedAt;
    }
  });
  return [...map.values()];
}

const NO_TEACHER = "__none__";
const facultyKeyOf = r => r.teacherId || NO_TEACHER;

function groupByFaculty(list) {
  const map = new Map();
  list.forEach(r => {
    const key = facultyKeyOf(r);
    let g = map.get(key);
    if (!g) {
      g = { key, name: r.teacherId ? r.teacherName : "No teacher assigned",
            courses: new Set(), students: new Set(),
            total: 0, done: 0, lastSubmittedAt: null };
      map.set(key, g);
    }
    g.courses.add(r.subjectId);
    g.students.add(r.studentId);
    g.total++;
    if (r.submitted) {
      g.done++;
      if (r.submittedAt && (!g.lastSubmittedAt || r.submittedAt > g.lastSubmittedAt)) g.lastSubmittedAt = r.submittedAt;
    }
  });
  return [...map.values()];
}

// Student: complete | partial | not-started | never-login
function studentState(g) {
  if (g.total > 0 && g.done === g.total) return "complete";
  if (g.done > 0)                        return "partial";
  return g.lastLogin ? "not-started" : "never-login";
}
// Faculty: complete | partial | none
function facultyState(g) {
  if (g.total > 0 && g.done === g.total) return "complete";
  return g.done > 0 ? "partial" : "none";
}

const STATE_BADGE = {
  "complete":    `<span class="badge submitted">Complete</span>`,
  "partial":     `<span class="badge partial">In Progress</span>`,
  "not-started": `<span class="badge not-submitted">Not Started</span>`,
  "never-login": `<span class="badge never-login">Never Logged In</span>`,
  "none":        `<span class="badge never-login">No Submissions</span>`,
};

const VIEW_HEAD = {
  faculty: `
      <th>Faculty</th>
      <th>Courses</th>
      <th>Students</th>
      <th>Evaluations Submitted</th>
      <th>Status</th>
      <th>Last Submitted</th>
      <th style="width:74px; text-align:center;">Students</th>`,
  student: `
      <th>Student</th>
      <th>Section</th>
      <th>Courses Submitted</th>
      <th>Status</th>
      <th>Last Login</th>
      <th>Last Submitted</th>
      <th style="width:74px; text-align:center;">Courses</th>`,
};

// Name on top, Student ID underneath (ID alone when no name is on file).
function studentCell(name, id) {
  return name
    ? `<b>${escapeHtml(name)}</b><div class="mon-sub-id">${escapeHtml(id)}</div>`
    : `<b>${escapeHtml(id)}</b>`;
}

function progressCell(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `
          <div class="mon-progress">
            <div class="mon-progress-track"><div class="mon-progress-fill${pct === 100 ? " full" : ""}" style="width:${pct}%;"></div></div>
            <span class="mon-progress-num">${done} / ${total}</span>
          </div>`;
}

// Exact date + time — "earliest first" needs real times, not "3 days ago".
function exactTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderTable() {
  const filterStatus = document.getElementById("filter-status").value;
  const isFaculty    = monView === "faculty";
  const filteredRows = applyStructuralFilters(rows);

  const allGroups = isFaculty ? groupByFaculty(filteredRows) : groupByStudent(filteredRows);
  const stateOf   = isFaculty ? facultyState : studentState;

  // The status filter applies to the whole faculty / student — the same
  // "all courses done" definition the summary cards use.
  const groups = allGroups.filter(g => {
    const st = stateOf(g);
    if (filterStatus === "submitted")     return st === "complete";
    if (filterStatus === "partial")       return st === "partial";
    if (filterStatus === "not-submitted") return st !== "complete";
    if (filterStatus === "never-login")   return st === "never-login" || st === "none";
    return true;
  });

  if (isFaculty) {
    groups.sort((a, b) =>
      (a.key === NO_TEACHER) - (b.key === NO_TEACHER) ||
      String(a.name).localeCompare(String(b.name)));
  } else {
    groups.sort((a, b) =>
      String(a.section).localeCompare(String(b.section)) ||
      String(a.studentName || "").localeCompare(String(b.studentName || "")) ||
      String(a.studentId).localeCompare(String(b.studentId)));
  }

  const noun = isFaculty ? "faculty" : "students";
  document.getElementById("row-count").textContent =
    `Showing ${groups.length} of ${allGroups.length} ${noun}`;

  const tbody   = document.getElementById("monitor-tbody");
  const headRow = tbody.closest("table")?.querySelector("thead tr");
  if (headRow && headRow.dataset.view !== monView) {
    headRow.innerHTML    = VIEW_HEAD[monView];
    headRow.dataset.view = monView;
  }

  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No ${noun} match the filters.</td></tr>`;
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
    const key = escapeHtml(g.key);
    if (isFaculty) {
      return `
      <tr class="mon-group-row" data-key="${key}" tabindex="0" title="Show this faculty's students">
        <td><b>${escapeHtml(g.name)}</b></td>
        <td>${g.courses.size}</td>
        <td>${g.students.size}</td>
        <td>${progressCell(g.done, g.total)}</td>
        <td>${STATE_BADGE[facultyState(g)]}</td>
        <td class="last-login-cell">${timeAgo(g.lastSubmittedAt)}</td>
        <td style="text-align:center;"><button type="button" class="btn-secondary mon-courses-btn">View</button></td>
      </tr>`;
    }
    return `
      <tr class="mon-group-row" data-key="${key}" tabindex="0" title="Show this student's courses">
        <td>${studentCell(g.studentName, g.studentId)}</td>
        <td>${escapeHtml(g.section)}</td>
        <td>${progressCell(g.done, g.total)}</td>
        <td>${STATE_BADGE[studentState(g)]}</td>
        <td class="last-login-cell">${timeAgo(g.lastLogin)}</td>
        <td class="last-login-cell">${timeAgo(g.lastSubmittedAt)}</td>
        <td style="text-align:center;"><button type="button" class="btn-secondary mon-courses-btn">View</button></td>
      </tr>`;
  }).join("");

  document.getElementById("monitor-page-info").textContent =
    `Page ${monitorPage} of ${totalPages} — showing ${noun} ${start + 1}–${Math.min(end, groups.length)} of ${groups.length}`;

  renderMonitorPager(totalPages);
}

// ══════════════════════════════════════════════════════════════
//  SIDE DRAWER
//  Faculty view  → that faculty's students: earliest submitters first,
//                  then not-yet-submitted, never-logged-in at the bottom.
//  Student view  → that student's courses, pending first.
//  The drawer always shows everything for the faculty / student,
//  whatever table filters are on.
// ══════════════════════════════════════════════════════════════
let drawerMode = null;   // "faculty" | "student" | null (closed)
let drawerKey  = null;

const MON_STYLES = `
.badge.partial { background:#dbeafe; color:#1e40af; }

.mon-group-row { cursor: pointer; }
.mon-group-row:hover, .mon-group-row:focus-visible { background: #fdf7f1; outline: none; }
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
.mon-viewswitch { display: inline-flex; gap: 4px; padding: 4px; background: #f1f5f9; border-radius: 8px; margin-bottom: 12px; }
#mon-viewswitch button.mon-view-btn, #mon-viewswitch button.mon-view-btn:hover { border: none; background: transparent; color: #64748b; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer; box-shadow: none; transform: none; filter: none; letter-spacing: normal; text-transform: none; }
#mon-viewswitch button.mon-view-btn.active, #mon-viewswitch button.mon-view-btn.active:hover { background: #fff; color: #671408; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
#mon-drawer-controls { display: flex; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
#mon-drawer-controls:empty { display: none; }
#mon-drawer-controls select { flex: 1; min-width: 0; width: auto; max-width: none; font-size: 12.5px; }
.mon-drawer-divider { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #64748b; padding: 14px 0 4px; }
.mon-drawer-rank { display: inline-block; min-width: 24px; color: #94a3b8; font-weight: 500; font-variant-numeric: tabular-nums; }
.mon-sub-id { font-size: 12px; color: #94a3b8; font-variant-numeric: tabular-nums; }
.mon-req-help { font-size: 12.5px; color: #64748b; line-height: 1.55; margin: 0 0 14px; }
.mon-req-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.mon-req-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
.mon-req-student { font-weight: 700; font-size: 14.5px; color: #1e293b; }
.mon-req-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 700px) { .mon-req-cols { grid-template-columns: 1fr; } }
.mon-req-col { border-radius: 8px; padding: 10px 12px; }
.mon-req-col.wrong { background: #fef2f2; }
.mon-req-col.right { background: #f0fdf4; }
.mon-req-col h5 { margin: 0 0 6px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #64748b; }
.mon-req-line { font-size: 13px; color: #334155; padding: 2px 0; display: flex; gap: 8px; }
.mon-req-line span { flex: none; width: 150px; color: #64748b; font-size: 12px; }
.mon-req-line b { font-weight: 600; overflow-wrap: anywhere; }
.mon-req-flag { background: #fee2e2; color: #991b1b; border-radius: 999px; padding: 1px 8px; font-size: 10px; letter-spacing: 0; text-transform: none; }
.mon-req-actions { display: flex; gap: 8px; margin-top: 12px; }
.mon-req-actions button { font-size: 12px; padding: 5px 12px; }
.mon-drawer-empty { color: #94a3b8; font-size: 13px; padding: 16px 0; }
`;

// This module runs on TWO pages: the standalone admin-monitoring.html and
// the Monitoring panel inside admin.html. Build the styles, view switch,
// drawer and status options here when the page doesn't have them, so an
// older or cached copy of either page can never break the module.
function ensureMonitoringMarkup() {
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

  if (table && !document.getElementById("mon-viewswitch")) {
    const sw = document.createElement("div");
    sw.id = "mon-viewswitch";
    sw.className = "mon-viewswitch";
    sw.innerHTML = `
      <button type="button" class="mon-view-btn active" data-view="faculty">By Faculty</button>
      <button type="button" class="mon-view-btn" data-view="student">By Student</button>`;
    const wrapEl = table.parentElement;
    wrapEl.parentElement.insertBefore(sw, wrapEl);
    sw.addEventListener("click", (e) => {
      const btn = e.target.closest(".mon-view-btn");
      if (!btn || btn.dataset.view === monView) return;
      monView = btn.dataset.view;
      sw.querySelectorAll(".mon-view-btn").forEach(b => b.classList.toggle("active", b === btn));
      syncStatusOptions();
      monitorPage = 1;
      renderTable();
      renderSummary();   // the search box matches faculty names only in faculty view
    });
  }

  if (!document.getElementById("mon-drawer")) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="mon-drawer-backdrop"></div>
      <aside id="mon-drawer" aria-hidden="true">
        <div class="mon-drawer-head">
          <div style="flex:1; min-width:0;">
            <div id="mon-drawer-title"></div>
            <div id="mon-drawer-sub"></div>
          </div>
          <button id="mon-drawer-close" type="button" class="btn-secondary" aria-label="Close">✕</button>
        </div>
        <div id="mon-drawer-controls"></div>
        <div id="mon-drawer-list"></div>
      </aside>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  }
  if (!document.getElementById("mon-drawer-controls")) {
    const c = document.createElement("div");
    c.id = "mon-drawer-controls";
    const listEl = document.getElementById("mon-drawer-list");
    listEl.parentElement.insertBefore(c, listEl);
  }

  syncStatusOptions();
}

// The status dropdown means slightly different things per view.
function syncStatusOptions() {
  const sel = document.getElementById("filter-status");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = monView === "faculty"
    ? `<option value="">All Statuses</option>
       <option value="submitted">Complete (all students submitted)</option>
       <option value="not-submitted">Not Yet Complete</option>
       <option value="partial">In Progress (some submitted)</option>
       <option value="never-login">No Submissions Yet</option>`
    : `<option value="">All Statuses</option>
       <option value="submitted">Complete (all courses)</option>
       <option value="not-submitted">Not Yet Complete</option>
       <option value="partial">In Progress (some courses)</option>
       <option value="never-login">Never Logged In</option>`;
  sel.value = current;

  const searchEl = document.getElementById("mon-search-input");
  if (searchEl) searchEl.placeholder = monView === "faculty"
    ? "🔍 Search faculty, student name or ID..."
    : "🔍 Search student name or ID...";
}
ensureMonitoringMarkup();

function renderFacultyDrawer() {
  const mine = rows.filter(r => facultyKeyOf(r) === drawerKey);
  if (mine.length === 0) { closeMonDrawer(); return; }

  const controls = document.getElementById("mon-drawer-controls");
  // Build the controls once per open; keep the user's picks on re-render.
  if (controls.dataset.key !== drawerKey) {
    // One course can span several sections; label it by name only then.
    const bySubject = new Map();
    mine.forEach(r => {
      if (!bySubject.has(r.subjectId)) bySubject.set(r.subjectId, { name: r.subjectName, secs: new Set() });
      bySubject.get(r.subjectId).secs.add(r.section);
    });
    let opts = `<option value="">All courses (${bySubject.size})</option>`;
    [...bySubject.entries()]
      .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)))
      .forEach(([id, c]) => {
        const label = c.secs.size === 1 ? `${c.name} — ${[...c.secs][0]}` : c.name;
        opts += `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
      });
    controls.innerHTML = `
      <select id="mon-drawer-course" aria-label="Course">${opts}</select>
      <select id="mon-drawer-status" aria-label="Status">
        <option value="">Everyone</option>
        <option value="submitted">Submitted</option>
        <option value="pending">Not yet submitted</option>
        <option value="never">Never logged in</option>
      </select>`;
    controls.dataset.key = drawerKey;
    controls.querySelectorAll("select").forEach(el => el.addEventListener("change", renderFacultyDrawer));
  }

  const fCourse = document.getElementById("mon-drawer-course").value;
  const fStatus = document.getElementById("mon-drawer-status").value;
  const scoped  = fCourse ? mine.filter(r => r.subjectId === fCourse) : mine;
  const done    = scoped.filter(r => r.submitted).length;

  document.getElementById("mon-drawer-title").textContent =
    drawerKey === NO_TEACHER ? "No teacher assigned" : mine[0].teacherName;
  document.getElementById("mon-drawer-sub").textContent =
    `${done} of ${scoped.length} evaluations submitted · ${new Set(scoped.map(r => r.studentId)).size} students`;

  // 0 = submitted, 1 = logged in but not submitted, 2 = never logged in
  const bucket = r => r.submitted ? 0 : (r.lastLogin ? 1 : 2);
  const shown = scoped.filter(r => {
    if (fStatus === "submitted") return bucket(r) === 0;
    if (fStatus === "pending")   return bucket(r) !== 0;   // includes never logged in
    if (fStatus === "never")     return bucket(r) === 2;
    return true;
  }).sort((a, b) =>
    bucket(a) - bucket(b) ||
    (bucket(a) === 0 ? String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")) : 0) ||
    String(a.studentName || a.studentId).localeCompare(String(b.studentName || b.studentId)) ||
    String(a.studentId).localeCompare(String(b.studentId)) ||
    String(a.subjectName).localeCompare(String(b.subjectName)));

  const list = document.getElementById("mon-drawer-list");
  if (shown.length === 0) {
    list.innerHTML = `<div class="mon-drawer-empty">No students match.</div>`;
    return;
  }

  const DIVIDER = [
    n => `Submitted — earliest first (${n})`,
    n => `Not yet submitted (${n})`,
    n => `Never logged in (${n})`,
  ];
  const counts = [0, 1, 2].map(k => shown.filter(r => bucket(r) === k).length);
  let html = "", lastBucket = -1, rank = 0;
  shown.forEach(r => {
    const k = bucket(r);
    if (k !== lastBucket) { html += `<div class="mon-drawer-divider">${DIVIDER[k](counts[k])}</div>`; lastBucket = k; }
    const right = k === 0
      ? `<span class="badge submitted">Submitted</span><div class="mon-drawer-when">${exactTime(r.submittedAt)}</div>`
      : k === 1
        ? `<span class="badge not-submitted">Not Yet</span><div class="mon-drawer-when">last login ${timeAgo(r.lastLogin)}</div>`
        : `<span class="badge never-login">Never Logged In</span>`;
    html += `
    <div class="mon-drawer-item">
      <div class="mon-drawer-course">
        <div class="mon-drawer-name">${k === 0 ? `<span class="mon-drawer-rank">${++rank}.</span>` : ""}${escapeHtml(r.studentName || r.studentId)}</div>
        <div class="mon-drawer-teacher">${r.studentName ? escapeHtml(r.studentId) + " · " : ""}${escapeHtml(r.subjectName)} · ${escapeHtml(r.section)}</div>
      </div>
      <div class="mon-drawer-status">${right}</div>
    </div>`;
  });
  list.innerHTML = html;
}

function renderStudentDrawer() {
  const mine = rows.filter(r => r.studentId === drawerKey);
  if (mine.length === 0) { closeMonDrawer(); return; }

  const controls = document.getElementById("mon-drawer-controls");
  controls.innerHTML = "";
  delete controls.dataset.key;

  const done = mine.filter(r => r.submitted).length;
  document.getElementById("mon-drawer-title").textContent = mine[0].studentName || drawerKey;
  document.getElementById("mon-drawer-sub").textContent =
    `${mine[0].studentName ? drawerKey + " · " : ""}${mine[0].section} · ${done} of ${mine.length} submitted · last login ${timeAgo(mine[0].lastLogin)}`;

  // Pending first — that's what QA is chasing — then by course name.
  mine.sort((a, b) => (a.submitted - b.submitted) ||
    String(a.subjectName).localeCompare(String(b.subjectName)));

  document.getElementById("mon-drawer-list").innerHTML = mine.map(r => `
    <div class="mon-drawer-item">
      <div class="mon-drawer-course">
        <div class="mon-drawer-name">${escapeHtml(r.subjectName)}</div>
        <div class="mon-drawer-teacher">${escapeHtml(r.teacherName)}</div>
      </div>
      <div class="mon-drawer-status">
        ${r.submitted
          ? `<span class="badge submitted">Submitted</span><div class="mon-drawer-when">${exactTime(r.submittedAt)}</div>`
          : `<span class="badge not-submitted">Not Yet</span>`}
      </div>
    </div>`).join("");
}

function renderMonDrawer() {
  if (!drawerMode) return;
  if (drawerMode === "faculty") renderFacultyDrawer();
  else renderStudentDrawer();
}

function openMonDrawer(mode, key) {
  drawerMode = mode;
  drawerKey  = key;
  const controls = document.getElementById("mon-drawer-controls");
  controls.innerHTML = "";
  delete controls.dataset.key;
  renderMonDrawer();
  if (!drawerMode) return;
  const d = document.getElementById("mon-drawer");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  document.getElementById("mon-drawer-list").scrollTop = 0;
  document.getElementById("mon-drawer-backdrop").classList.add("open");
}

function closeMonDrawer() {
  drawerMode = null;
  drawerKey  = null;
  const d = document.getElementById("mon-drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  document.getElementById("mon-drawer-backdrop").classList.remove("open");
}

document.getElementById("monitor-tbody").addEventListener("click", (e) => {
  const row = e.target.closest(".mon-group-row");
  if (row) openMonDrawer(monView, row.dataset.key);
});
document.getElementById("monitor-tbody").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.closest("button")) return;
  const row = e.target.closest(".mon-group-row");
  if (row) openMonDrawer(monView, row.dataset.key);
});
document.getElementById("mon-drawer-close").addEventListener("click", closeMonDrawer);
document.getElementById("mon-drawer-backdrop").addEventListener("click", closeMonDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerMode) closeMonDrawer(); });

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

// ══════════════════════════════════════════════════════════════
//  REASSIGNMENT REQUESTS VIEW
//  Students who were listed under the wrong teacher / course / section
//  file a request from their dashboard (js/reassign-request.js). These
//  are NOT anonymous — each carries the student's ID and name so QA can
//  fix the enrollment in Course Assignment → Students, then mark it here.
// ══════════════════════════════════════════════════════════════
let reassignRequests = [];
let reassignLoadError = "";

function ensureRequestsMarkup() {
  const tabs = document.getElementById("tab-comments")?.parentElement;
  if (tabs && !document.getElementById("tab-requests")) {
    const b = document.createElement("button");
    b.className = "view-tab";
    b.id = "tab-requests";
    b.textContent = "🔁 Reassignment Requests";
    tabs.appendChild(b);
    b.addEventListener("click", () => switchView("requests"));
  }
  const commentsView = document.getElementById("view-comments");
  if (commentsView && !document.getElementById("view-requests")) {
    const v = document.createElement("div");
    v.id = "view-requests";
    v.style.display = "none";
    v.innerHTML = `
      <div class="section">
        <div class="toolbar">
          <select id="requests-status" aria-label="Request status">
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
          <span style="font-size:12px; color:#666;" id="requests-count"></span>
        </div>
        <p class="mon-req-help">To act on a request: fix the student's classes in <b>Course Assignment → Students</b>
          (remove them from the wrong class, add them to the right one), then mark the request resolved here.
          If the student already submitted for the wrong class, that anonymous evaluation stays in the teacher's results.</p>
        <div id="requests-container"></div>
      </div>`;
    commentsView.insertAdjacentElement("afterend", v);
    v.querySelector("#requests-status").addEventListener("change", renderRequests);
    v.querySelector("#requests-container").addEventListener("click", onRequestAction);
  }
}
ensureRequestsMarkup();

async function loadRequests(semesterId) {
  reassignLoadError = "";
  try {
    reassignRequests = await fetchAllPages(() =>
      supabase.from("evaluation_reassignment_requests")
        .select("id, student_id, student_name, wrong_subject_label, wrong_teacher_name, wrong_section_name, already_submitted, correct_teacher, correct_subject, correct_subject_code, correct_section, status, created_at, resolved_at")
        .eq("semester_id", semesterId)
        .order("created_at", { ascending: true })
    );
  } catch (err) {
    reassignRequests = [];
    reassignLoadError = err?.message || "unknown error";
  }
  renderRequests();
}

function renderRequests() {
  const container = document.getElementById("requests-container");
  if (!container) return;

  const pending = reassignRequests.filter(r => r.status === "pending").length;
  const tab = document.getElementById("tab-requests");
  if (tab) tab.textContent = `🔁 Reassignment Requests${pending ? ` (${pending})` : ""}`;

  if (reassignLoadError) {
    container.innerHTML = `<p style="color:#b91c1c; padding:8px 0;">Couldn't load requests: ${escapeHtml(reassignLoadError)}</p>`;
    return;
  }

  const f = document.getElementById("requests-status").value;
  const list = f ? reassignRequests.filter(r => r.status === f) : reassignRequests;
  document.getElementById("requests-count").textContent =
    `${list.length} request${list.length === 1 ? "" : "s"}`;

  if (list.length === 0) {
    container.innerHTML = `<p style="color:#94a3b8; padding:8px 0;">No ${f ? f + " " : ""}requests.</p>`;
    return;
  }

  const PILL = {
    pending:  `<span class="badge not-submitted">Pending</span>`,
    resolved: `<span class="badge submitted">Resolved</span>`,
    rejected: `<span class="badge never-login">Rejected</span>`,
  };
  const line = (label, value) =>
    `<div class="mon-req-line"><span>${label}</span><b>${escapeHtml(value || "—")}</b></div>`;

  container.innerHTML = list.map(r => `
    <div class="mon-req-card">
      <div class="mon-req-head">
        <div>
          <div class="mon-req-student">${escapeHtml(r.student_name || r.student_id)}</div>
          <div class="mon-sub-id">${escapeHtml(r.student_id)} · sent ${exactTime(r.created_at)}</div>
        </div>
        <div>${PILL[r.status] || ""}</div>
      </div>
      <div class="mon-req-cols">
        <div class="mon-req-col wrong">
          <h5>Incorrect evaluation details${r.already_submitted ? ` <span class="mon-req-flag">already submitted</span>` : ""}</h5>
          ${line("Faculty member evaluated", r.wrong_teacher_name)}
          ${line("Subject evaluated", r.wrong_subject_label)}
          ${line("Section", r.wrong_section_name)}
        </div>
        <div class="mon-req-col right">
          <h5>Correct information</h5>
          ${line("Correct faculty member", r.correct_teacher)}
          ${line("Correct subject", r.correct_subject)}
          ${line("Subject code", r.correct_subject_code)}
          ${line("Section", r.correct_section)}
        </div>
      </div>
      <div class="mon-req-actions">
        ${r.status === "pending"
          ? `<button type="button" class="btn-secondary" data-id="${escapeHtml(r.id)}" data-status="resolved">✓ Mark resolved</button>
             <button type="button" class="btn-secondary" data-id="${escapeHtml(r.id)}" data-status="rejected">✕ Reject</button>`
          : `<button type="button" class="btn-secondary" data-id="${escapeHtml(r.id)}" data-status="pending">↺ Reopen</button>`}
      </div>
    </div>`).join("");
}

async function onRequestAction(e) {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const { id, status } = btn.dataset;
  btn.disabled = true;
  const { error } = await supabase.from("evaluation_reassignment_requests")
    .update({ status, resolved_at: status === "pending" ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) {
    btn.disabled = false;
    alert("Couldn't update the request: " + error.message);
    return;
  }
  const r = reassignRequests.find(x => x.id === id);
  if (r) r.status = status;
  renderRequests();
}

// ── Tab switching (Submission Status ↔ Student Comments ↔ Requests) ──
function switchView(view) {
  ["monitoring", "comments", "requests"].forEach(v => {
    const pane = document.getElementById("view-" + v);
    const tab  = document.getElementById("tab-" + v);
    if (pane) pane.style.display = v === view ? "" : "none";
    if (tab)  tab.classList.toggle("active", v === view);
  });
  if (view === "comments") renderComments();
  if (view === "requests") renderRequests();
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