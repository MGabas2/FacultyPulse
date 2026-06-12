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
let rows           = [];   // each row = one student × one subject
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
  tbody.innerHTML = `<tr><td colspan="8">Loading...</td></tr>`;

  // 1. Active semester
  const { data: semester } = await supabase
    .from("semesters")
    .select("id, label")
    .eq("is_active", true)
    .single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="8">No active semester.</td></tr>`;
    return;
  }
  activeSemester = semester;

  // 2. All students with their section + last login
  const { data: students } = await supabase
    .from("users")
    .select("id, student_id, section_id, last_login, sections(name)")
    .eq("role", "student");

  if (!students || students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">No students found.</td></tr>`;
    return;
  }

  // 3. All subjects this semester (with teacher + section)
  const { data: subs } = await supabase
    .from("subjects")
    .select("id, name, section_id, users(name)")
    .eq("semester_id", semester.id);

  subjects = subs || [];

  // 4. All submissions this semester (tracking table — has identity)
  const { data: tracking } = await supabase
    .from("evaluation_tracking")
    .select("id, student_id, subject_id, comment, is_verified, submitted_at")
    .eq("semester_id", semester.id);

  const trackMap = new Map();
  (tracking || []).forEach(t => {
    trackMap.set(`${t.student_id}|${t.subject_id}`, t);
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
        lastLogin:   student.last_login,
        submitted:   !!track,
        submittedAt: track?.submitted_at || null,
        comment:     track?.comment || null,
        isVerified:  track?.is_verified ?? null,
        trackingId:  track?.id || null,
      });
    });
  });

  // Populate filters
  populateFilters();

  // Render
  renderTable();
  renderSummary();
}

// ── Populate section + subject filters ──
function populateFilters() {
  const sectionSet = new Map();
  const subjectSet = new Map();

  rows.forEach(r => {
    if (r.sectionId) sectionSet.set(r.sectionId, r.section);
    if (r.subjectId) subjectSet.set(r.subjectId, r.subjectName);
  });

  const filterSection = document.getElementById("filter-section");
  const filterSubject = document.getElementById("filter-subject");

  // Only populate once
  if (filterSection.options.length <= 1) {
    sectionSet.forEach((name, id) => {
      filterSection.innerHTML += `<option value="${id}">${name}</option>`;
    });
  }
  if (filterSubject.options.length <= 1) {
    subjectSet.forEach((name, id) => {
      filterSubject.innerHTML += `<option value="${id}">${name}</option>`;
    });
  }
}

// ── Render summary cards ──
function renderSummary() {
  // Count unique students (not rows)
  const uniqueStudents = new Set(rows.map(r => r.studentId));
  const total = uniqueStudents.size;

  // A student "submitted" if they completed ALL their subjects
  const studentStatus = {};
  rows.forEach(r => {
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

function renderTable() {
  const search        = document.getElementById("search-input").value.toLowerCase();
  const filterStatus  = document.getElementById("filter-status").value;
  const filterSection = document.getElementById("filter-section").value;
  const filterSubject = document.getElementById("filter-subject").value;

  let filtered = rows.filter(r => {
    // Status classification
    let status;
    if (r.submitted)         status = "submitted";
    else if (r.lastLogin)    status = "not-submitted";
    else                     status = "never-login";

    const matchSearch  = !search        || r.studentId.toLowerCase().includes(search);
    const matchStatus  = !filterStatus  || status === filterStatus;
    const matchSection = !filterSection || r.sectionId === filterSection;
    const matchSubject = !filterSubject || r.subjectId === filterSubject;

    return matchSearch && matchStatus && matchSection && matchSubject;
  });

  document.getElementById("row-count").textContent =
    `Showing ${filtered.length} of ${rows.length} records`;

  const tbody = document.getElementById("monitor-tbody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">No records match the filters.</td></tr>`;
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

    // Comment cell
    const commentHtml = r.comment
      ? `<div class="comment-cell">"${r.comment}"</div>`
      : `<span class="comment-empty">No comment</span>`;

    // Verify buttons (only if there's a comment)
    let verifyHtml = "—";
    if (r.comment && r.trackingId) {
      verifyHtml = `
        <div class="verify-btns">
          <button class="btn-tiny btn-valid ${r.isVerified === true ? "active" : ""}"
            onclick="verifyComment('${r.trackingId}', true)">✓ Valid</button>
          <button class="btn-tiny btn-invalid ${r.isVerified === false ? "active" : ""}"
            onclick="verifyComment('${r.trackingId}', false)">✗ Invalid</button>
        </div>
      `;
    }

    tbody.innerHTML += `
      <tr>
        <td><b>${r.studentId}</b></td>
        <td>${r.section}</td>
        <td>${r.subjectName}<br/><small style="color:#94a3b8;">${r.teacherName}</small></td>
        <td class="last-login-cell">${lastLogin}</td>
        <td>${badge}</td>
        <td class="last-login-cell">${submittedAt}</td>
        <td>${commentHtml}</td>
        <td>${verifyHtml}</td>
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
//  VERIFY COMMENT — mark valid (included in report) or invalid (excluded)
// ══════════════════════════════════════════════════════════════
async function verifyComment(trackingId, isValid) {
  const { error } = await supabase
    .from("evaluation_tracking")
    .update({ is_verified: isValid })
    .eq("id", trackingId);

  if (error) {
    alert("Failed to update: " + error.message);
    return;
  }

  // Update local state and re-render
  const row = rows.find(r => r.trackingId === trackingId);
  if (row) row.isVerified = isValid;
  renderTable();
}

// ── Expose to HTML ──
window.verifyComment = verifyComment;

// ── Filter changes reset to page 1 ──
function onFilterChange() {
  monitorPage = 1;
  renderTable();
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
document.getElementById("filter-section").addEventListener("change", onFilterChange);
document.getElementById("filter-subject").addEventListener("change", onFilterChange);

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