// ============================================================
//  FacultyPulse — Admin Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula + IFER Report
// ============================================================

import { supabase } from "./supabase.js";
import { fpAlert, fpConfirm } from "./modal.js";

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../index.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + sessionStorage.getItem("name");

let barChart   = null;
let donutChart = null;

// ══════════════════════════════════════════════════════════════
//  RATING HELPERS (out of 100)
// ══════════════════════════════════════════════════════════════
function getRatingLabel(score) {
  if (score >= 90) return "Outstanding";
  if (score >= 75) return "Very Satisfactory";
  if (score >= 60) return "Satisfactory";
  if (score >= 45) return "Needs Improvement";
  return "Poor";
}

// ── Report pipeline stage badge ──
function getReportStageBadge(stage) {
  const map = {
    pending:                 { label: "📝 Pending Review",      bg: "#fef3c7", color: "#92400e" },
    forwarded_to_supervisor: { label: "📤 Awaiting Supervisor", bg: "#dbeafe", color: "#1e40af" },
    supervisor_done:         { label: "✅ Supervisor Done",     bg: "#d1fae5", color: "#065f46" },
    released:                { label: "🎓 Released",            bg: "#ede9fe", color: "#5b21b6" },
  };
  const s = map[stage] || map.pending;
  return `<span style="background:${s.bg}; color:${s.color}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; white-space:nowrap;">${s.label}</span>`;
}

function getRatingColor(score) {
  if (score >= 90) return "#10b981";
  if (score >= 75) return "#3b82f6";
  if (score >= 60) return "#f59e0b";
  if (score >= 45) return "#f97316";
  return "#ef4444";
}

// ══════════════════════════════════════════════════════════════
//  WEIGHTED SET COMPUTATION — CMO No. 19 Annex C
//  Returns { overallSET, classData, totalEnrolled, totalWeighted }
// ══════════════════════════════════════════════════════════════
async function computeWeightedSET(teacherId, semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) return null;

  const classData      = [];
  let totalWeighted    = 0;
  let totalEnrolled    = 0;
  let totalRespondents = 0;

  // Category accumulators
  const catTotals = { A: 0, B: 0, C: 0 };
  const catCounts = { A: 0, B: 0, C: 0 };

  for (const subject of subjects) {
    const { data: evals } = await supabase
      .from("evaluation_scores")
      .select("scores")
      .eq("subject_id", subject.id)
      .eq("semester_id", semesterId); // always read all scores for analytics

    if (!evals || evals.length === 0) {
      classData.push({
        subjectId:     subject.id,
        course:        subject.name,
        section:       subject.sections?.name || "—",
        noStudents:    subject.enrolled_count || 0,
        avgSETRating:  0,
        weightedScore: 0,
        respondents:   0,
      });
      continue;
    }

    let sumRatings = 0;
    evals.forEach(e => {
      // Per student: (total score / 75) × 100
      const totalScore = Object.values(e.scores).reduce((s, v) => s + v, 0);
      const rating     = (totalScore / 75) * 100;
      sumRatings      += rating;

      // Category scores
      const catA = ["q1","q2","q3","q4","q5","q6"]
        .reduce((s,k) => s + (e.scores[k] || 0), 0);
      const catB = ["q7","q8","q9","q10","q11"]
        .reduce((s,k) => s + (e.scores[k] || 0), 0);
      const catC = ["q12","q13","q14","q15"]
        .reduce((s,k) => s + (e.scores[k] || 0), 0);

      catTotals.A += (catA / 30) * 100;
      catTotals.B += (catB / 25) * 100;
      catTotals.C += (catC / 20) * 100;
      catCounts.A++;
      catCounts.B++;
      catCounts.C++;
    });

    const respondents   = evals.length;
    const avgSETRating  = parseFloat((sumRatings / respondents).toFixed(2));
    // Guard: enrolled_count must be at least the number of respondents.
    // If admin set it too low (or 0), fall back to respondents to avoid
    // a mathematically invalid weighted score.
    let enrolled = subject.enrolled_count || 0;
    if (enrolled < respondents) {
      console.warn(
        `⚠️ ${subject.name}: enrolled_count (${enrolled}) is less than ` +
        `respondents (${respondents}). Using respondents instead. ` +
        `Please correct enrolled_count in the subjects table.`
      );
      enrolled = respondents;
    }
    const weightedScore = parseFloat((enrolled * avgSETRating).toFixed(2));

    classData.push({
      subjectId:     subject.id,
      course:        subject.name,
      section:       subject.sections?.name || "—",
      noStudents:    enrolled,
      avgSETRating,
      weightedScore,
      respondents,
    });

    totalWeighted    += weightedScore;
    totalEnrolled    += enrolled;
    totalRespondents += respondents;
  }

  const overallSET = totalEnrolled > 0
    ? parseFloat((totalWeighted / totalEnrolled).toFixed(2))
    : 0;

  const avgA = catCounts.A > 0
    ? parseFloat((catTotals.A / catCounts.A).toFixed(2)) : 0;
  const avgB = catCounts.B > 0
    ? parseFloat((catTotals.B / catCounts.B).toFixed(2)) : 0;
  const avgC = catCounts.C > 0
    ? parseFloat((catTotals.C / catCounts.C).toFixed(2)) : 0;

  return {
    overallSET,
    classData,
    totalEnrolled,
    totalWeighted,
    totalRespondents,
    avgA, avgB, avgC,
    subjects,
  };
}

// ══════════════════════════════════════════════════════════════
//  LOAD SUMMARY COUNTS
// ══════════════════════════════════════════════════════════════
async function loadSummary() {
  const { count: facultyCount } = await supabase
    .from("users").select("*", { count: "exact", head: true }).eq("role", "teacher");
  const { count: studentCount } = await supabase
    .from("users").select("*", { count: "exact", head: true }).eq("role", "student");
  const { count: evalCount } = await supabase
    .from("evaluation_scores").select("*", { count: "exact", head: true });

  document.getElementById("count-faculty").textContent  = facultyCount  ?? "—";
  document.getElementById("count-students").textContent = studentCount  ?? "—";
  document.getElementById("count-evals").textContent    = evalCount     ?? "—";
}

// ══════════════════════════════════════════════════════════════
//  LOAD FACULTY RANKINGS + CHARTS
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  FACULTY RANKINGS — with pagination
// ══════════════════════════════════════════════════════════════
let allRanked    = [];
let rankPage     = 1;
const RANK_SIZE  = 10;

async function loadRankings() {
  const tbody = document.getElementById("rankings-tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data: semester } = await supabase
    .from("semesters").select("id").eq("is_active", true).single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="6">No active semester.</td></tr>`;
    return;
  }

  const { data: teachers } = await supabase
    .from("users").select("id, name, academic_rank").eq("role", "teacher");

  if (!teachers || teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No faculty found.</td></tr>`;
    return;
  }

  // Bulk fetch — 2 queries instead of N*M sequential queries
  const { data: allSubjects } = await supabase
    .from("subjects")
    .select("id, name, teacher_id, enrolled_count, sections(name, department)")
    .eq("semester_id", semester.id);

  const { data: allEvals } = await supabase
    .from("evaluation_scores")
    .select("subject_id, scores")
    .eq("semester_id", semester.id);

  // Bulk fetch all report release stages for this semester
  const { data: allReleases } = await supabase
    .from("report_releases")
    .select("teacher_id, stage")
    .eq("semester_id", semester.id);

  const releaseStageByTeacher = {};
  (allReleases || []).forEach(r => {
    releaseStageByTeacher[r.teacher_id] = r.stage;
  });

  // Index by subject_id
  const evalsBySubject = {};
  (allEvals || []).forEach(e => {
    if (!evalsBySubject[e.subject_id]) evalsBySubject[e.subject_id] = [];
    evalsBySubject[e.subject_id].push(e);
  });

  // Index subjects by teacher_id
  const subjectsByTeacher = {};
  (allSubjects || []).forEach(s => {
    if (!subjectsByTeacher[s.teacher_id]) subjectsByTeacher[s.teacher_id] = [];
    subjectsByTeacher[s.teacher_id].push(s);
  });

  const ranked = [];

  for (const teacher of teachers) {
    const subjects = subjectsByTeacher[teacher.id] || [];
    if (subjects.length === 0) continue;

    let totalWeighted = 0, totalEnrolled = 0, totalRespondents = 0;

    for (const subject of subjects) {
      const evals = evalsBySubject[subject.id] || [];
      if (evals.length === 0) continue;

      let sumRatings = 0;
      evals.forEach(e => {
        const total = Object.values(e.scores).reduce((s, v) => s + v, 0);
        sumRatings += (total / 75) * 100;
      });

      const avgSETRating  = parseFloat((sumRatings / evals.length).toFixed(2));
      const enrolledCount = subject.enrolled_count || evals.length;
      totalWeighted    += avgSETRating * enrolledCount;
      totalEnrolled    += enrolledCount;
      totalRespondents += evals.length;
    }

    if (totalRespondents === 0) continue;

    const overallSET = parseFloat((totalWeighted / totalEnrolled).toFixed(2));
    const program    = subjects[0]?.sections?.department || "—";

    ranked.push({
      id:          teacher.id,
      name:        teacher.name,
      rank:        teacher.academic_rank || "—",
      overallSET,
      respondents: totalRespondents,
      program,
      stage:       releaseStageByTeacher[teacher.id] || "pending",
    });
  }

  ranked.sort((a, b) => b.overallSET - a.overallSET);
  allRanked = ranked;

  const progFilter = document.getElementById("dash-program-filter");
  if (progFilter && progFilter.options.length <= 1) {
    const programs = [...new Set(ranked.map(t => t.program).filter(p => p && p !== "—"))].sort();
    programs.forEach(p => { progFilter.innerHTML += `<option value="${p}">${p}</option>`; });
  }

  rankPage = 1;
  renderRankingsPage();
  populateDashFacultyFilter();

  const select = document.getElementById("report-faculty");
  if (select) {
    select.innerHTML = ranked.map(t =>
      `<option value="${t.id}|${t.name}">${t.name}</option>`
    ).join("");
  }

  renderBarChart(ranked);
  renderDonutChart(ranked);
}

// ── Render current page of rankings ──
function renderRankingsPage() {
  const tbody = document.getElementById("rankings-tbody");

  // Apply program + faculty filters
  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  let filtered = progFilter
    ? allRanked.filter(t => t.program === progFilter)
    : allRanked;

  if (facFilter) {
    filtered = filtered.filter(t => t.id === facFilter);
  }

  // Bar chart reflects the current program filter (department averages when
  // "All Programs", individual faculty when a specific program is chosen)
  renderBarChart(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No evaluation data ${progFilter ? "for this program" : "yet"}.</td></tr>`;
    document.getElementById("rank-page-info").textContent = "";
    document.getElementById("rank-page-buttons").innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(filtered.length / RANK_SIZE);
  if (rankPage > totalPages) rankPage = totalPages;

  const start = (rankPage - 1) * RANK_SIZE;
  const end   = start + RANK_SIZE;
  const pageRows = filtered.slice(start, end);

  tbody.innerHTML = "";
  pageRows.forEach((t, idx) => {
    const globalRank = start + idx + 1; // continuous rank across pages
    const color = getRatingColor(t.overallSET);
    tbody.innerHTML += `
      <tr>
        <td>${globalRank}</td>
        <td>${t.name}</td>
        <td style="text-align:center;">${t.overallSET} / 100</td>
        <td>
          <span class="badge done" style="background:${color}20; color:${color};">
            ${getRatingLabel(t.overallSET)}
          </span>
        </td>
        <td>${getReportStageBadge(t.stage)}</td>
        <td>
          <button onclick="viewReport('${t.id}','${t.name.replace(/'/g,"\\'")}')">
            View Report
          </button>
        </td>
      </tr>
    `;
  });

  document.getElementById("rank-page-info").textContent =
    `Showing ${start + 1}–${Math.min(end, filtered.length)} of ${filtered.length} faculty`;

  renderPager("rank-page-buttons", totalPages, rankPage, (p) => {
    rankPage = p;
    renderRankingsPage();
  });
}

// ══════════════════════════════════════════════════════════════
//  LOAD USERS — full list with pagination
// ══════════════════════════════════════════════════════════════
let allUsersList = [];
let currentPage  = 1;
const PAGE_SIZE  = 15;

async function loadUsers() {
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;

  const { data: users } = await supabase
    .from("users")
    .select("name, role, student_id, sections(name)")
    .order("role")
    .order("student_id");

  allUsersList = users || [];

  // Fill user-summary cards (count by role from the loaded list)
  const studentN = allUsersList.filter(u => u.role === "student").length;
  const teacherN = allUsersList.filter(u => u.role === "teacher").length;
  const adminN   = allUsersList.filter(u => u.role === "admin").length;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("usum-students", studentN);
  setText("usum-teachers", teacherN);
  setText("usum-admins",   adminN);

  currentPage  = 1;
  renderUsersPage();
}

// ── Render the current page of users ──
function renderUsersPage() {
  const tbody = document.getElementById("users-tbody");

  if (allUsersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No users found.</td></tr>`;
    document.getElementById("page-info").textContent = "";
    document.getElementById("page-buttons").innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(allUsersList.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = start + PAGE_SIZE;
  const pageUsers = allUsersList.slice(start, end);

  tbody.innerHTML = "";
  pageUsers.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td>${u.name || u.student_id || "—"}</td>
        <td style="text-transform:capitalize">${u.role}</td>
        <td>${u.sections?.name || "—"}</td>
        <td><span class="badge done">Active</span></td>
      </tr>
    `;
  });

  document.getElementById("page-info").textContent =
    `Showing ${start + 1}–${Math.min(end, allUsersList.length)} of ${allUsersList.length} users`;

  renderPager("page-buttons", totalPages, currentPage, (p) => {
    currentPage = p;
    renderUsersPage();
  });
}

// ══════════════════════════════════════════════════════════════
//  SHARED PAGINATION RENDERER
//  containerId = where buttons go, totalPages, current, onGo(page)
// ══════════════════════════════════════════════════════════════
function renderPager(containerId, totalPages, current, onGo) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (totalPages <= 1) return;

  // Prev
  const prev = document.createElement("button");
  prev.className   = "page-btn";
  prev.textContent = "‹ Prev";
  prev.disabled    = current === 1;
  prev.onclick     = () => onGo(current - 1);
  container.appendChild(prev);

  // Windowed page numbers: first, last, current ±2
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - 2 && i <= current + 2)) {
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
      btn.className   = "page-btn" + (p === current ? " active" : "");
      btn.textContent = p;
      btn.onclick     = () => onGo(p);
      container.appendChild(btn);
    }
  });

  // Next
  const next = document.createElement("button");
  next.className   = "page-btn";
  next.textContent = "Next ›";
  next.disabled    = current === totalPages;
  next.onclick     = () => onGo(current + 1);
  container.appendChild(next);
}

// ══════════════════════════════════════════════════════════════
//  GENERATE IFER REPORT — Annex C Format
//  Faculty-facing report shows aggregated scores + verified comments
//  with NO student identity. Admin/QA identity data stays in the
//  tracking table and is never included in the report.
// ══════════════════════════════════════════════════════════════
async function viewReport(teacherId, teacherName) {
  const reportContent = document.getElementById("report-content");
  reportContent.innerHTML = `<p style="text-align:center; color:#64748b;">Loading report...</p>`;
  document.getElementById("report-modal").classList.remove("hidden");

  // Stash current target so the Release button knows what to release
  window._reportTeacherId   = teacherId;
  window._reportTeacherName = teacherName;

  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).single();

  if (!semester) {
    reportContent.innerHTML = `<p>No active semester found.</p>`;
    return;
  }
  window._reportSemesterId = semester.id;

  // ── Check release stage ──
  const { data: release } = await supabase
    .from("report_releases")
    .select("released_at, released_by, stage")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .maybeSingle();

  window._reportStage    = release?.stage || "pending";
  window._reportReleased = release?.stage === "released";


  // Get teacher info
  const { data: teacher } = await supabase
    .from("users")
    .select("name, academic_rank, email")
    .eq("id", teacherId)
    .single();

  // Get faculty's department from first subject
  const { data: deptSubject } = await supabase
    .from("subjects")
    .select("sections(department)")
    .eq("teacher_id", teacherId)
    .limit(1)
    .single();

  const department = deptSubject?.sections?.department || "—";

  // Compute weighted SET
  const result = await computeWeightedSET(teacherId, semester.id);

  if (!result) {
    reportContent.innerHTML = `<p>No evaluation data found for this faculty.</p>`;
    return;
  }

  const { overallSET, classData, totalEnrolled, totalWeighted,
          avgA, avgB, avgC } = result;

  // Get SEF rating and supervisor comments from supervisor_remarks
  const { data: supRemarks } = await supabase
    .from("supervisor_remarks")
    .select("sef_score, comments, remarks")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sefRating      = supRemarks?.sef_score
    ? `${supRemarks.sef_score} / 100`
    : "—";
  const supComments    = supRemarks?.comments || "";
  const supRemarksTxt  = supRemarks?.remarks  || "";

  // Get FEDAF development plan (Annex D) — prints attached to IFER
  const { data: fedaf } = await supabase
    .from("fedaf")
    .select("areas_improvement, proposed_activities, action_plan, supervisor_signed")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .maybeSingle();

  // Fetch student comments from evaluation_comments for this teacher's subjects.
  // Comments are linked to subject_id only — not to a specific student.
  // This satisfies CMO §6.10 (student anonymity) — QAO sees the comment
  // but cannot identify the student who wrote it.
  const subjectIds = classData.map(c => c.subjectId).filter(Boolean);
  let studentComments = [];
  if (subjectIds.length > 0) {
    const { data: rawComments } = await supabase
      .from("evaluation_comments")
      .select("comment, subject_id")
      .in("subject_id", subjectIds)
      .eq("semester_id", semester.id);
    studentComments = (rawComments || [])
      .map(r => r.comment?.trim())
      .filter(Boolean);
  }

  // Store on window so the Restore button can access it without re-fetching
  window._studentComments = studentComments;

  // ── Build IFER HTML — Annex C Format ──
  const dateGenerated = new Date().toLocaleDateString("en-PH", {
    year: "numeric", month: "long", day: "numeric"
  });

  reportContent.innerHTML = `
    <div style="font-family: Arial, sans-serif; font-size: 12px; color: #000; line-height: 1.4;">

      ${(() => {
        const s = window._reportStage;
        if (s === 'released')
          return `<div class="no-print" style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#166534;">
            ✅ <b>RELEASED TO FACULTY</b> — This report has been finalized. Faculty can now view their results.
          </div>`;
        if (s === 'supervisor_done')
          return `<div class="no-print" style="background:#eff6ff; border:1px solid #93c5fd; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#1e40af;">
            📋 <b>SUPERVISOR REVIEWED</b> — Supervisor has submitted remarks. Ready for your final release.
          </div>`;
        if (s === 'forwarded_to_supervisor')
          return `<div class="no-print" style="background:#faf5ff; border:1px solid #c4b5fd; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#6d28d9;">
            ⏳ <b>AWAITING SUPERVISOR REVIEW</b> — Forwarded to supervisor. Waiting for their remarks.
          </div>`;
        return `<div class="no-print" style="background:#fef3c7; border:1px solid #fcd34d; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#92400e;">
          📝 <b>PREVIEW (QA ONLY)</b> — Not yet forwarded. Faculty cannot see this report yet.
        </div>`;
      })()}

      <!-- ══ ANNEX C HEADER ══ -->
      <p style="text-align:right; font-size:10px; color:#000; margin-bottom:8px;">
        ANNEX C – Individual Faculty Evaluation Report
      </p>

      <h3 style="text-align:center; font-size:13px; font-weight:bold; margin-bottom:16px; text-transform:uppercase; letter-spacing:.02em;">
        Individual Faculty Evaluation Report
      </h3>

      <!-- A. Faculty Information -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">A. Faculty Information</p>
      <table style="width:100%; font-size:12px; margin-bottom:16px; border-collapse:collapse;">
        <tr>
          <td style="width:42%; padding:3px 0; color:#000; border:none;">Name of Faculty Evaluated</td>
          <td style="padding:3px 0; font-weight:bold; color:#000; border:none;">: ${teacher?.name || teacherName}</td>
        </tr>
        <tr>
          <td style="padding:3px 0; color:#000; border:none;">Department/College</td>
          <td style="padding:3px 0; color:#000; border:none;">: ${department}</td>
        </tr>
        <tr>
          <td style="padding:3px 0; color:#000; border:none;">Current Faculty Rank</td>
          <td style="padding:3px 0; color:#000; border:none;">: ${teacher?.academic_rank || "—"}</td>
        </tr>
        <tr>
          <td style="padding:3px 0; color:#000; border:none;">Semester/Term &amp; Academic Year</td>
          <td style="padding:3px 0; color:#000; border:none;">: ${semester.label}</td>
        </tr>
      </table>

      <!-- B. Summary of Average SET Rating -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:4px;">B. Summary of Average SET Rating</p>
      <p style="font-size:11px; color:#000; margin-bottom:4px;">Computation:</p>
      <p style="font-size:11px; color:#000; margin-bottom:2px; padding-left:16px;">
        <b>Step 1</b>: Get the average SET rating for each class.
      </p>
      <p style="font-size:11px; color:#000; margin-bottom:2px; padding-left:16px;">
        <b>Step 2</b>: Multiply the number of students in each class with its average SET rating to get the Weighted SET Score per class.
      </p>
      <p style="font-size:11px; color:#000; margin-bottom:10px; padding-left:16px;">
        <b>Step 3</b>: Get the total number of students and the total weighted SET score
      </p>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:10px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Seq</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">(1)<br/>Course Code</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">(2)<br/>Year/Section</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">(3)<br/>No. of Students</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">(4)<br/>Average SET Rating</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">(3 x 4)<br/>Weighted SET Score</th>
          </tr>
        </thead>
        <tbody>
          ${classData.map((c, i) => `
            <tr>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${i + 1}</td>
              <td style="padding:7px 8px; border:1px solid #000; color:#000; font-style:italic;">${c.course}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.section}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.noStudents}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.avgSETRating}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.weightedScore}</td>
            </tr>
          `).join("")}
          <tr>
            <td colspan="3" style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold; color:#000;">TOTAL</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold; color:#000;">${totalEnrolled}</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold; color:#000;">TOTAL</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold; color:#000;">${totalWeighted.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <!-- C. SET and SEF Ratings -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">C. SET and SEF Ratings</p>
      <p style="font-size:11px; color:#000; margin-bottom:8px;">
        <b>Computation</b>: Calculate the Overall SET Rating by dividing the total Weighted SET Score by the total number of students.
        In the example above, the total weighted value is ${totalWeighted.toFixed(2)} while the total number of students is ${totalEnrolled}.
        Therefore, ${totalWeighted.toFixed(2)}÷${totalEnrolled} = <b>${overallSET}</b>
      </p>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; width:40%;"></th>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; text-align:center; font-weight:bold;">SET Rating</th>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; text-align:center; font-weight:bold;">*SEF Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px; border:1px solid #000; font-weight:bold; color:#000;">OVERALL RATING</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px; color:#000;">${overallSET}</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; color:#000;">${sefRating}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:10px; color:#000; margin-bottom:16px; font-style:italic;">
        *Note: rating given by the supervisor using the SEF instrument
      </p>

      <!-- Category Breakdown (FacultyPulse addition — not in CMO but useful for panel) -->
      <p style="font-size:11px; color:#000; font-weight:bold; margin-bottom:6px;">Category Breakdown</p>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:left; font-weight:bold;">Category</th>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Score (out of 100)</th>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">A. Management of Teaching and Learning</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgA}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${getRatingLabel(avgA)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">B. Content Knowledge, Pedagogy and Technology</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgB}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${getRatingLabel(avgB)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">C. Commitment and Transparency</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgC}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${getRatingLabel(avgC)}</td>
          </tr>
        </tbody>
      </table>

      <!-- D. Summary of Qualitative Comments and Suggestions -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">D. Summary of Qualitative Comments and Suggestions</p>

      <!-- Students comment table -->
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; width:40px; font-weight:bold;">Seq</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Comments and Suggestions from the Students</th>
            <th class="no-print" style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; width:36px; font-weight:bold;">✕</th>
          </tr>
        </thead>
        <tbody id="student-comments-tbody">
          ${(() => {
            // Show at least 5 rows; auto-expand if more comments
            const rows = studentComments.length > 0
              ? studentComments
              : [];
            const count = Math.max(rows.length, 5);
            const extra = rows.length - 5;
            let html = "";
            for (let i = 0; i < count; i++) {
              const text = rows[i] || "";
              html += `
                <tr>
                  <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${i+1}</td>
                  <td style="padding:14px 8px; border:1px solid #000; color:#000;" contenteditable="true">${escHtml(text)}</td>
                  <td class="no-print" style="padding:4px; border:1px solid #e2e8f0; text-align:center;">
                    <button onclick="removeSpecificCommentRow(this, 'student-comments-tbody')"
                      style="font-size:11px; padding:2px 8px; background:#fee2e2; color:#dc2626;
                        border:1px solid #fca5a5; border-radius:4px; cursor:pointer;">✕</button>
                  </td>
                </tr>`;
            }
            html += `
              <tr data-hint="1">
                <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#555;">…</td>
                <td style="padding:6px 8px; border:1px solid #000; color:#555; font-style:italic;">(add additional rows if necessary)</td>
                <td class="no-print" style="border:1px solid #e2e8f0;"></td>
              </tr>`;
            return html;
          })()}
        </tbody>
      </table>

      ${studentComments.length > 0 ? `
        <div class="no-print" style="background:#eff6ff; border:1px solid #93c5fd; border-radius:6px;
          padding:8px 14px; margin-bottom:8px; font-size:12px; color:#1e40af;
          display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span>💬 <b>${studentComments.length} student comment${studentComments.length !== 1 ? "s" : ""} loaded.</b>
          Use ✕ to remove any that are invalid, irrelevant, or inappropriate before printing.</span>
          <button onclick="restoreStudentComments()"
            style="font-size:11px; padding:3px 10px; background:white; color:#1e40af;
              border:1px solid #93c5fd; border-radius:4px; cursor:pointer; white-space:nowrap; flex-shrink:0;">
            ↩ Restore All
          </button>
        </div>
      ` : `
        <div class="no-print" style="background:#fef3c7; border:1px solid #fcd34d; border-radius:6px;
          padding:8px 14px; margin-bottom:8px; font-size:12px; color:#92400e;">
          📭 No student comments submitted for this faculty this semester.
          Rows are blank — fill by hand during the feedback meeting if needed.
        </div>
      `}

      <div class="no-print" style="display:flex; gap:8px; margin-bottom:16px;">
        <button onclick="addCommentRow('student-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#1a56db; border:1px solid #1a56db; border-radius:5px; cursor:pointer;">
          + Add Row
        </button>
        <button onclick="removeCommentRow('student-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#dc2626; border:1px solid #dc2626; border-radius:5px; cursor:pointer;">
          − Remove Last Row
        </button>
      </div>

      <!-- Supervisor comment table -->
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; width:40px; font-weight:bold;">Seq</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Comments and Suggestions from the Supervisor</th>
          </tr>
        </thead>
        <tbody id="supervisor-comments-tbody">
          ${(() => {
            const lines = supComments
              ? supComments.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
              : [];
            const rows = [...lines];
            while (rows.length < 5) rows.push("");
            return rows.map((line, i) => `
              <tr>
                <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${i+1}</td>
                <td style="padding:14px 8px; border:1px solid #000; color:#000;">${line || "&nbsp;"}</td>
              </tr>
            `).join("");
          })()}
          <tr data-hint="1">
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#555;">…</td>
            <td style="padding:6px 8px; border:1px solid #000; color:#555; font-style:italic;">(add additional rows if necessary)</td>
          </tr>
        </tbody>
      </table>
      <div class="no-print" style="display:flex; gap:8px; margin-bottom:16px;">
        <button onclick="addCommentRow('supervisor-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#1a56db; border:1px solid #1a56db; border-radius:5px; cursor:pointer;">
          + Add Row
        </button>
        <button onclick="removeCommentRow('supervisor-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#dc2626; border:1px solid #dc2626; border-radius:5px; cursor:pointer;">
          − Remove Row
        </button>
      </div>

      <!-- Prepared by / Reviewed by -->
      <div style="margin-top:28px; font-size:12px; max-width:500px;
                  page-break-inside:avoid; break-inside:avoid;">
        <div style="page-break-inside:avoid; break-inside:avoid; margin-bottom:22px;">
          <p style="margin-bottom:14px; color:#000;"><b>Prepared by:</b></p>
          <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
            <span style="width:230px; flex:none; font-weight:bold; color:#000;">Signature of Staff</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
          <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
            <span style="width:230px; flex:none; color:#000;">Name of Staff</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
          <div style="display:flex; align-items:flex-end;">
            <span style="width:230px; flex:none; color:#000;">Date</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
        </div>
        <div style="page-break-inside:avoid; break-inside:avoid;">
          <p style="margin-bottom:14px; color:#000;"><b>Reviewed by:</b></p>
          <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
            <span style="width:230px; flex:none; font-weight:bold; color:#000;">Signature of Authorized Official</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
          <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
            <span style="width:230px; flex:none; color:#000;">Name of Authorized Official</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
          <div style="display:flex; align-items:flex-end;">
            <span style="width:230px; flex:none; color:#000;">Date</span>
            <span style="margin:0 6px; color:#000;">:</span>
            <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════
           ANNEX D — FEDAF
           Prints on a new page. Fields blank for hand-fill per CMO §10.2.
           ══════════════════════════════════════════════════════════ -->
      <div id="annex-d-section" style="page-break-before:always; padding-top:8px;">

        <p style="text-align:right; font-size:10px; color:#000; margin-bottom:4px;">
          ANNEX D – Faculty Evaluation and Development Acknowledgment Form
        </p>

        <h3 style="text-align:center; font-size:12px; font-weight:bold; margin-bottom:16px; text-transform:uppercase; letter-spacing:.02em;">
          Faculty Evaluation and Development Acknowledgment Form
        </h3>

        <!-- A. Faculty Member Information -->
        <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">A. FACULTY MEMBER INFORMATION</p>
        <table style="width:100%; font-size:12px; margin-bottom:16px; border-collapse:collapse;">
          <tr>
            <td style="width:42%; padding:3px 0; color:#000; border:none;">Name of Faculty</td>
            <td style="padding:3px 0; font-weight:bold; color:#000; border:none;">: ${teacher?.name || teacherName}</td>
          </tr>
          <tr>
            <td style="padding:3px 0; color:#000; border:none;">Department/College</td>
            <td style="padding:3px 0; color:#000; border:none;">: ${department}</td>
          </tr>
          <tr>
            <td style="padding:3px 0; color:#000; border:none;">Current Faculty Rank</td>
            <td style="padding:3px 0; color:#000; border:none;">: ${teacher?.academic_rank || "—"}</td>
          </tr>
          <tr>
            <td style="padding:3px 0; color:#000; border:none;">Semester/Term &amp; Academic Year</td>
            <td style="padding:3px 0; color:#000; border:none;">: ${semester.label}</td>
          </tr>
        </table>

        <!-- B. Faculty Evaluation Summary -->
        <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">B. FACULTY EVALUATION SUMMARY</p>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px;">
          <thead>
            <tr>
              <th colspan="2" style="background:#fff; color:#000; padding:7px 10px; border:1px solid #000; text-align:center; font-weight:bold;">
                Overall Rating
              </th>
            </tr>
            <tr>
              <th style="background:#fff; color:#000; padding:7px 10px; border:1px solid #000; text-align:center; width:50%; font-weight:bold;">
                Student Evaluation of Teachers (SET)
              </th>
              <th style="background:#fff; color:#000; padding:7px 10px; border:1px solid #000; text-align:center; width:50%; font-weight:bold;">
                Supervisor's Evaluation of Faculty (SAF)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:14px 10px; border:1px solid #000; text-align:center; font-size:20px; font-weight:bold; color:#000;">
                ${overallSET}
              </td>
              <td style="padding:14px 10px; border:1px solid #000; text-align:center; font-size:20px; font-weight:bold; color:#000;">
                ${supRemarks?.sef_score || "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- C. Development Plan -->
        <p style="font-weight:bold; font-size:12px; margin-bottom:4px;">
          C. DEVELOPMENT PLAN
          <span style="font-weight:normal; font-size:11px; color:#000;">
            (to be jointly accomplished by the Supervisor and Faculty)
          </span>
        </p>

        ${fedaf?.supervisor_signed
          ? `<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; width:30%; vertical-align:top; font-weight:bold; color:#000;">
                   Areas for Improvement
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; min-height:60px; line-height:1.7; color:#000;">
                   ${escHtml(fedaf.areas_improvement || "")}
                 </td>
               </tr>
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold; color:#000;">
                   Proposed Learning and Development Activities
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; min-height:60px; line-height:1.7; color:#000;">
                   ${escHtml(fedaf.proposed_activities || "")}
                 </td>
               </tr>
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold; color:#000;">
                   Action Plan
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; min-height:60px; line-height:1.7; color:#000;">
                   ${escHtml(fedaf.action_plan || "")}
                 </td>
               </tr>
             </table>`
          : `<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; width:30%; vertical-align:top; font-weight:bold; color:#000;">
                   Areas for Improvement
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; height:70px; color:#000;"></td>
               </tr>
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold; color:#000;">
                   Proposed Learning and Development Activities
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; height:70px; color:#000;"></td>
               </tr>
               <tr>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold; color:#000;">
                   Action Plan
                 </td>
                 <td style="border:1px solid #000; padding:8px 10px; vertical-align:top; height:70px; color:#000;"></td>
               </tr>
             </table>`
        }

        <!-- Acknowledgment statement -->
        <p style="font-size:12px; line-height:1.8; margin-bottom:20px; text-align:justify; color:#000; font-weight:bold;">
          I acknowledge that I have received and reviewed the faculty evaluation conducted for
          the period mentioned above. I understand that my signature below does not necessarily
          indicate agreement with the evaluation but confirms that I have been given the
          opportunity to discuss it with my supervisor.
        </p>

        <!-- Signature blocks -->
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px;">
          <thead>
            <tr>
              <th colspan="2" style="background:#333; color:white; padding:7px 10px; border:1px solid #000; text-align:center; font-weight:bold;">
                SUPERVISOR
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; width:30%; color:#000;">Signature</td>
              <td style="border:1px solid #000; padding:6px 10px; height:36px; color:#000;"></td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;">Name</td>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;"></td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;">Date Signed</td>
              <td style="border:1px solid #000; padding:6px 10px; height:32px; color:#000;"></td>
            </tr>
          </tbody>
        </table>

        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr>
              <th colspan="2" style="background:#333; color:white; padding:7px 10px; border:1px solid #000; text-align:center; font-weight:bold;">
                FACULTY
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; width:30%; color:#000;">Signature</td>
              <td style="border:1px solid #000; padding:6px 10px; height:36px; color:#000;"></td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;">Name</td>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;"></td>
            </tr>
            <tr>
              <td style="border:1px solid #000; padding:6px 10px; color:#000;">Date Signed</td>
              <td style="border:1px solid #000; padding:6px 10px; height:32px; color:#000;"></td>
            </tr>
          </tbody>
        </table>

      </div><!-- /annex-d-section -->
    </div>
  `;
  // Show/hide the Release button based on release status
  updateReleaseButton();
}

// ══════════════════════════════════════════════════════════════
//  CHARTS
// ══════════════════════════════════════════════════════════════
function renderBarChart(ranked) {
  const ctx = document.getElementById("bar-chart").getContext("2d");
  if (barChart) barChart.destroy();

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  // Apply program filter to the working set first
  let scoped = progFilter ? ranked.filter(t => t.program === progFilter) : ranked;

  let labels, data, colors, chartTitle, tooltipSuffix;

  if (facFilter) {
    // ── Single faculty selected: show just their score as one bar ──
    const t = scoped.find(x => x.id === facFilter);
    labels        = t ? [t.name.split(",")[0]] : [];
    data          = t ? [t.overallSET] : [];
    colors        = t ? [getRatingColor(t.overallSET)] : [];
    tooltipSuffix = [""];
    chartTitle    = t ? `${t.name} — SET Rating` : "Faculty SET Rating";
  } else if (!progFilter) {
    // ── All Programs: show department-level averages ──
    const byProgram = new Map();
    ranked.forEach(t => {
      const prog = t.program || "—";
      if (!byProgram.has(prog)) byProgram.set(prog, []);
      byProgram.get(prog).push(t.overallSET);
    });

    const programAverages = [...byProgram.entries()].map(([prog, scores]) => ({
      program: prog,
      avg: parseFloat((scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(2)),
      count: scores.length,
    }));

    programAverages.sort((a, b) => b.avg - a.avg);

    labels        = programAverages.map(p => p.program);
    data          = programAverages.map(p => p.avg);
    colors        = programAverages.map(p => getRatingColor(p.avg));
    tooltipSuffix = programAverages.map(p => ` (${p.count} faculty)`);
    chartTitle    = "Program-Level SET Rating Comparison (out of 100)";
  } else {
    // ── Specific program selected, no faculty filter: show individual faculty ──
    labels        = scoped.map(t => t.name.split(",")[0]);
    data          = scoped.map(t => t.overallSET);
    colors        = scoped.map(t => getRatingColor(t.overallSET));
    tooltipSuffix = scoped.map(() => "");
    chartTitle    = `Faculty SET Rating Comparison — ${progFilter} (out of 100)`;
  }

  // Update chart card heading to reflect current scope
  const headingEl = document.querySelector("#bar-chart").closest(".chart-card")?.querySelector("h3");
  if (headingEl) headingEl.textContent = `📊 ${chartTitle}`;

  barChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Overall SET Rating",
        data,
        backgroundColor: colors,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx =>
              ` ${ctx.parsed.y} / 100 — ${getRatingLabel(ctx.parsed.y)}${tooltipSuffix[ctx.dataIndex] || ""}`
          }
        }
      },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 20 }, grid: { color: "#f0f0f0" } },
        x: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderDonutChart(ranked) {
  const ctx = document.getElementById("donut-chart").getContext("2d");
  if (donutChart) donutChart.destroy();

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  let scoped = progFilter ? ranked.filter(t => t.program === progFilter) : ranked;
  if (facFilter) scoped = scoped.filter(t => t.id === facFilter);

  const buckets = {
    "Outstanding":       { count: 0, color: "#10b981" },
    "Very Satisfactory": { count: 0, color: "#3b82f6" },
    "Satisfactory":      { count: 0, color: "#f59e0b" },
    "Needs Improvement": { count: 0, color: "#f97316" },
    "Poor":              { count: 0, color: "#ef4444" },
  };

  scoped.forEach(t => {
    const label = getRatingLabel(t.overallSET);
    if (buckets[label]) buckets[label].count++;
  });

  const labels = Object.keys(buckets).filter(k => buckets[k].count > 0);
  const data   = labels.map(k => buckets[k].count);
  const colors = labels.map(k => buckets[k].color);

  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: "#fff",
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, padding: 10 } },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} faculty` }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════════
function closeReportModal() {
  document.getElementById("report-modal").classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════
//  STAGE-AWARE RELEASE BUTTON
//  pending / no row      → Forward to Supervisor
//  forwarded_to_supervisor → disabled (waiting)
//  supervisor_done        → Final Release to Faculty
//  released               → hidden
// ══════════════════════════════════════════════════════════════
function updateReleaseButton() {
  const btn   = document.getElementById("release-btn");
  if (!btn) return;

  const stage = window._reportStage || "pending";

  btn.style.display = "inline-block";
  btn.disabled      = false;
  btn.onclick       = null;

  if (stage === "released") {
    btn.style.display = "none";
    return;
  }

  if (stage === "forwarded_to_supervisor") {
    btn.textContent      = "⏳ Awaiting Supervisor Review";
    btn.disabled         = true;
    btn.style.background = "#7c3aed";
    return;
  }

  if (stage === "supervisor_done") {
    btn.textContent      = "✅ Final Release to Faculty";
    btn.style.background = "#16a34a";
    btn.onclick          = finalRelease;
    return;
  }

  // pending or no row — forward to supervisor
  btn.textContent      = "📤 Forward to Supervisor";
  btn.style.background = "#1a56db";
  btn.onclick          = forwardToSupervisor;
}

// ── Navigate to Monitoring panel filtered by this teacher ──
function goToMonitoringFiltered(teacherId, teacherName) {
  // Close all open modals first
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));

  // Switch to monitoring panel (lazy-loads admin-monitoring.js if not yet loaded)
  if (typeof switchPanel === "function") {
    switchPanel("panel-monitoring");
  }

  // After panel is visible and JS has loaded, apply the filter
  // Poll briefly since the JS may still be injecting
  let attempts = 0;
  const apply = setInterval(() => {
    const input = document.getElementById("filter-faculty");
    if (input) {
      input.value = teacherName;
      // Dispatch input event so monitoring JS picks it up
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clearInterval(apply);
      sessionStorage.removeItem("mon_filter_faculty");
    }
    if (++attempts > 20) clearInterval(apply); // give up after 2s
  }, 100);
}

// ── Forward to Supervisor ──
async function forwardToSupervisor() {
  const teacherId   = window._reportTeacherId;
  const teacherName = window._reportTeacherName;
  const semesterId  = window._reportSemesterId;
  if (!teacherId || !semesterId) return;

  // Look up this teacher's assigned supervisor name
  const { data: teacherRow } = await supabase
    .from("users")
    .select("supervisor_id")
    .eq("id", teacherId)
    .maybeSingle();

  let supervisorName = "Immediate Supervisor";
  if (teacherRow?.supervisor_id) {
    const { data: supRow } = await supabase
      .from("users")
      .select("name")
      .eq("id", teacherRow.supervisor_id)
      .maybeSingle();
    if (supRow?.name) supervisorName = supRow.name;
  } else {
    // No supervisor_id set — fall back to the single supervisor account
    const { data: supRow } = await supabase
      .from("users")
      .select("name")
      .eq("role", "supervisor")
      .limit(1)
      .maybeSingle();
    if (supRow?.name) supervisorName = supRow.name;
  }

  // Get submission counts — use raw enrolled_count from subjects table,
  // NOT the clamped value from computeWeightedSET (which adjusts for math validity).
  const { data: subjectsForCount } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  let submissionLines = "";
  let totalRespondents = 0;
  let totalEnrolled = 0;

  if (subjectsForCount && subjectsForCount.length > 0) {
    for (const sub of subjectsForCount) {
      const { count } = await supabase
        .from("evaluation_tracking")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", sub.id)
        .eq("semester_id", semesterId);

      const respondents = count || 0;
      const enrolled    = sub.enrolled_count || 0;
      totalRespondents += respondents;
      totalEnrolled    += enrolled;
      submissionLines  += `\n  • ${sub.name} (${sub.sections?.name || "—"}): ${respondents}/${enrolled} submitted`;
    }
  }

  const submissionSummary = totalEnrolled > 0
    ? `\nSubmission Status: ${totalRespondents}/${totalEnrolled} students submitted${submissionLines}`
    : "";

  const confirmed = await fpConfirm(
    `Forward this report to the Supervisor for review?\n\n` +
    `Faculty: ${teacherName}\n` +
    `Supervisor: ${supervisorName}` +
    submissionSummary +
    `\n\n• Evaluation results will be sent for supervisor remarks\n` +
    `• You can do the Final Release after the supervisor submits`,
    {
      confirmLabel: "Forward",
      confirmStyle: "fp-btn-primary",
      extraButton: {
        label: "View in Monitoring →",
        action: () => goToMonitoringFiltered(teacherId, teacherName),
      },
    }
  );
  if (!confirmed) return;

  const btn = document.getElementById("release-btn");
  if (btn) { btn.textContent = "Forwarding..."; btn.disabled = true; }

  // Upsert: insert if no row, update stage if row exists
  const { data: existing } = await supabase
    .from("report_releases")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabase
      .from("report_releases")
      .update({ stage: "forwarded_to_supervisor" })
      .eq("teacher_id", teacherId)
      .eq("semester_id", semesterId));
  } else {
    ({ error } = await supabase
      .from("report_releases")
      .insert({
        teacher_id:  teacherId,
        semester_id: semesterId,
        released_by: sessionStorage.getItem("name") || "QA Admin",
        stage:       "forwarded_to_supervisor",
      }));
  }

  if (error) {
    await fpAlert("Failed to forward: " + error.message, "error");
    updateReleaseButton();
    return;
  }

  await fpAlert(`Report forwarded to Supervisor.\nThe supervisor can now review and submit remarks for ${teacherName}.`, "success");
  viewReport(teacherId, teacherName);
}

// ── Final Release to Faculty ──
async function finalRelease() {
  const teacherId   = window._reportTeacherId;
  const teacherName = window._reportTeacherName;
  const semesterId  = window._reportSemesterId;
  if (!teacherId || !semesterId) return;

  const confirmed = await fpConfirm(
    `Final Release: publish this report to ${teacherName}?\n\n` +
    `• Faculty will be able to view their scores and supervisor remarks\n` +
    `• This action cannot be undone`,
    { confirmLabel: "Release to Faculty", confirmStyle: "fp-btn-success" }
  );
  if (!confirmed) return;

  const btn = document.getElementById("release-btn");
  if (btn) { btn.textContent = "Releasing..."; btn.disabled = true; }

  const { error } = await supabase
    .from("report_releases")
    .update({ stage: "released" })
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  if (error) {
    await fpAlert("Failed to release: " + error.message, "error");
    updateReleaseButton();
    return;
  }

  await fpAlert(`Report released to ${teacherName}.\nThe faculty can now view their evaluation results.`, "success");
  viewReport(teacherId, teacherName);
}

// ── Expose to HTML (rankings table uses onclick) ──
window.viewReport = viewReport;

// ── Restore student comments to original loaded state ──
function restoreStudentComments() {
  const tbody   = document.getElementById("student-comments-tbody");
  const comments = window._studentComments || [];
  if (!tbody) return;

  tbody.innerHTML = "";
  const count = Math.max(comments.length, 5);

  for (let i = 0; i < count; i++) {
    const text = comments[i] || "";
    const tr   = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${i+1}</td>
      <td style="padding:14px 8px; border:1px solid #000; color:#000;" contenteditable="true">${escHtml(text)}</td>
      <td class="no-print" style="padding:4px; border:1px solid #e2e8f0; text-align:center;">
        <button onclick="removeSpecificCommentRow(this, 'student-comments-tbody')"
          style="font-size:11px; padding:2px 8px; background:#fee2e2; color:#dc2626;
            border:1px solid #fca5a5; border-radius:4px; cursor:pointer;">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Re-add hint row
  const hintRow = document.createElement("tr");
  hintRow.dataset.hint = "1";
  hintRow.innerHTML = `
    <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#555;">…</td>
    <td style="padding:6px 8px; border:1px solid #000; color:#555; font-style:italic;">(add additional rows if necessary)</td>
    <td class="no-print" style="border:1px solid #e2e8f0;"></td>
  `;
  tbody.appendChild(hintRow);
}

window.restoreStudentComments = restoreStudentComments;

// ── Add a blank row to a comment table ──
function addCommentRow(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  const newSeq   = dataRows.length + 1;
  const isStudent = tbodyId === "student-comments-tbody";
  const hintRow  = tbody.querySelector("tr[data-hint]");
  const tr       = document.createElement("tr");
  tr.innerHTML   = `
    <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${newSeq}</td>
    <td style="padding:14px 8px; border:1px solid #000; color:#000;" contenteditable="true">&nbsp;</td>
    ${isStudent ? `<td class="no-print" style="padding:4px; border:1px solid #e2e8f0; text-align:center;">
      <button onclick="removeSpecificCommentRow(this, '${tbodyId}')"
        style="font-size:11px; padding:2px 8px; background:#fee2e2; color:#dc2626;
          border:1px solid #fca5a5; border-radius:4px; cursor:pointer;">✕</button>
    </td>` : ""}
  `;
  if (hintRow) tbody.insertBefore(tr, hintRow);
  else tbody.appendChild(tr);
  renumberCommentRows(tbodyId);
}

// ── Remove the last data row ──
function removeCommentRow(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  if (dataRows.length <= 1) return;
  dataRows[dataRows.length - 1].remove();
  renumberCommentRows(tbodyId);
}

// ── Remove a specific row via its ✕ button ──
function removeSpecificCommentRow(btn, tbodyId) {
  const row = btn.closest("tr");
  if (!row) return;
  const tbody    = document.getElementById(tbodyId);
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  if (dataRows.length <= 1) return;
  row.remove();
  renumberCommentRows(tbodyId);
}

// ── Renumber seq after add/remove ──
function renumberCommentRows(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  Array.from(tbody.querySelectorAll("tr"))
    .filter(r => !r.dataset.hint)
    .forEach((row, i) => {
      const cell = row.querySelector("td:first-child");
      if (cell) cell.textContent = i + 1;
    });
}

window.addCommentRow            = addCommentRow;
window.removeCommentRow         = removeCommentRow;
window.removeSpecificCommentRow = removeSpecificCommentRow;

// ── Attach events ──
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

document.getElementById("generate-report-btn").addEventListener("click", () => {
  const select = document.getElementById("report-faculty");
  if (!select || !select.value || !select.value.includes("|")) {
    fpAlert("Please select a faculty member first.", "warning");
    return;
  }
  const [id, ...nameParts] = select.value.split("|");
  if (!id) return;
  viewReport(id, nameParts.join("|"));
});

// ── Print IFER only (Annex C) — hide Annex D before printing ──
// ── Print (full document — IFER + FEDAF on page 2) ──
document.getElementById("print-btn").addEventListener("click", () => {
  window.print();
});

// ── Save as PDF (full document — IFER + FEDAF) ──
document.getElementById("pdf-btn").addEventListener("click", async () => {
  const btn         = document.getElementById("pdf-btn");
  const teacherName = window._reportTeacherName || "IFER";
  const element     = document.getElementById("report-content");

  btn.textContent = "Generating...";
  btn.disabled    = true;

  // Hide all no-print elements (Add Row buttons, status banners)
  const noPrint = element.querySelectorAll(".no-print");
  noPrint.forEach(el => el.setAttribute("data-pdf-hidden", el.style.display));
  noPrint.forEach(el => el.style.display = "none");

  await html2pdf().set({
    margin:      [10, 10, 10, 10],
    filename:    `IFER_${teacherName.replace(/\s+/g, "_")}.pdf`,
    image:       { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak:   { mode: ["css", "legacy"] },
  }).from(element).save();

  // Restore no-print elements
  noPrint.forEach(el => el.style.display = el.getAttribute("data-pdf-hidden") || "");
  noPrint.forEach(el => el.removeAttribute("data-pdf-hidden"));

  btn.textContent = "💾 Save as PDF";
  btn.disabled    = false;
});

document.getElementById("close-report-btn").addEventListener("click", closeReportModal);


// ── Refresh button — reloads all dashboard data ──
function refreshDashboard() {
  const btn = document.getElementById("refresh-btn");
  if (btn) {
    btn.textContent = "🔄 Refreshing...";
    btn.disabled = true;
  }
  Promise.all([loadSummary(), loadRankings()]).finally(() => {
    if (btn) {
      btn.textContent = "🔄 Refresh";
      btn.disabled = false;
    }
  });
}
// ── Sync enrolled_count from actual students in each section ──
const syncEnrolledBtn = document.getElementById("sync-enrolled-btn");
if (syncEnrolledBtn) {
  syncEnrolledBtn.addEventListener("click", async () => {
    const confirmed = await fpConfirm(
      "Sync enrolled counts?\n\nThis will update the enrolled student count for all subjects based on the actual number of active students in each section.\n\nRun this before generating IFERs to ensure accurate numbers."
    );
    if (!confirmed) return;

    syncEnrolledBtn.textContent = "⏳ Syncing...";
    syncEnrolledBtn.disabled = true;

    const { data, error } = await supabase.rpc("sync_enrolled_counts");

    syncEnrolledBtn.textContent = "🔢 Sync Enrolled";
    syncEnrolledBtn.disabled = false;

    if (error) {
      await fpAlert("Sync failed: " + error.message, "error");
      return;
    }

    await fpAlert(
      `✅ Enrolled counts synced.\n${data.updated} subject(s) updated.\n\nYou can now generate IFERs with accurate student counts.`,
      "success"
    );

    // Reload rankings so the updated counts reflect immediately
    loadRankings();
  });
}
const dashProgramFilterEl = document.getElementById("dash-program-filter");
if (dashProgramFilterEl) {
  dashProgramFilterEl.addEventListener("change", () => {
    rankPage = 1;
    // Refresh faculty filter options to only show faculty in selected program
    populateDashFacultyFilter();
    document.getElementById("dash-faculty-filter").value = ""; // reset on program change
    renderRankingsPage();
    renderBarChart(allRanked);
    renderDonutChart(allRanked);
  });
}

const dashFacultyFilterEl = document.getElementById("dash-faculty-filter");
if (dashFacultyFilterEl) {
  dashFacultyFilterEl.addEventListener("change", () => {
    rankPage = 1;
    renderRankingsPage();
    renderBarChart(allRanked);
    renderDonutChart(allRanked);
  });
}

// ── Populate faculty filter dropdown, scoped to current program filter ──
function populateDashFacultyFilter() {
  const facultySel = document.getElementById("dash-faculty-filter");
  if (!facultySel) return;

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const pool = progFilter
    ? allRanked.filter(t => t.program === progFilter)
    : allRanked;

  facultySel.innerHTML = `<option value="">All Faculty</option>` +
    pool.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

// ══════════════════════════════════════════════════════════════
//  PRINT HISTORY — audit log of released reports
// ══════════════════════════════════════════════════════════════
let allHistory      = [];
let historyPage     = 1;
const HISTORY_PAGE_SIZE = 10;

async function loadPrintHistory() {
  const tbody = document.getElementById("history-tbody");
  if (!tbody) return; // panel not yet loaded
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("report_releases")
    .select("teacher_id, semester_id, released_at, released_by, stage, users(name), semesters(label)")
    .eq("stage", "released")
    .order("released_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error loading history: ${error.message}</td></tr>`;
    return;
  }

  allHistory = data || [];

  // Populate semester filter (once)
  const semFilter = document.getElementById("history-semester-filter");
  if (semFilter && semFilter.options.length <= 1) {
    const uniqueSemesters = [...new Map(
      allHistory.filter(h => h.semesters).map(h => [h.semester_id, h.semesters.label])
    )];
    uniqueSemesters.forEach(([id, label]) => {
      semFilter.innerHTML += `<option value="${id}">${label}</option>`;
    });
  }

  historyPage = 1;
  renderHistoryTable();
}

function renderHistoryTable() {
  const search   = (document.getElementById("history-search")?.value || "").toLowerCase();
  const semFilt  = document.getElementById("history-semester-filter")?.value || "";

  let filtered = allHistory.filter(h => {
    const name = (h.users?.name || "").toLowerCase();
    const matchSearch = !search || name.includes(search);
    const matchSem    = !semFilt || h.semester_id === semFilt;
    return matchSearch && matchSem;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  if (historyPage > totalPages) historyPage = totalPages;
  const startIdx = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + HISTORY_PAGE_SIZE);

  const countEl = document.getElementById("history-count");
  if (countEl) {
    countEl.textContent = filtered.length === 0
      ? "No records found."
      : `Showing ${startIdx+1}–${Math.min(startIdx+HISTORY_PAGE_SIZE, filtered.length)} of ${filtered.length}`;
  }

  const tbody = document.getElementById("history-tbody");
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">No reports have been released yet.</td></tr>`;
    renderHistoryPagination(0);
    return;
  }

  tbody.innerHTML = pageItems.map(h => {
    const releasedDate = h.released_at
      ? new Date(h.released_at).toLocaleDateString("en-PH", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
      : "—";
    const teacherName = h.users?.name || "Unknown";
    return `
      <tr>
        <td>${teacherName}</td>
        <td>${h.semesters?.label || "—"}</td>
        <td>${h.released_by || "—"}</td>
        <td>${releasedDate}</td>
        <td>
          <button style="font-size:12px; padding:5px 12px;"
            onclick="viewReport('${h.teacher_id}','${teacherName.replace(/'/g,"\\'")}')">
            View Report
          </button>
        </td>
      </tr>`;
  }).join("");

  renderHistoryPagination(totalPages);
}

function renderHistoryPagination(totalPages) {
  const container = document.getElementById("history-page-buttons");
  if (!container) return;
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const makeBtn = (label, page, opts = {}) => {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (opts.active ? " active" : "");
    btn.textContent = label;
    btn.disabled = !!opts.disabled;
    btn.onclick = () => { historyPage = page; renderHistoryTable(); };
    return btn;
  };

  container.appendChild(makeBtn("← Prev", historyPage - 1, { disabled: historyPage === 1 }));
  let start = Math.max(1, historyPage - 2);
  let end   = Math.min(totalPages, start + 4);
  start     = Math.max(1, end - 4);
  if (start > 1) {
    container.appendChild(makeBtn("1", 1));
    if (start > 2) container.appendChild(makeBtn("…", historyPage, { disabled:true }));
  }
  for (let p = start; p <= end; p++) {
    container.appendChild(makeBtn(String(p), p, { active: p === historyPage }));
  }
  if (end < totalPages) {
    if (end < totalPages - 1) container.appendChild(makeBtn("…", historyPage, { disabled:true }));
    container.appendChild(makeBtn(String(totalPages), totalPages));
  }
  container.appendChild(makeBtn("Next →", historyPage + 1, { disabled: historyPage === totalPages }));
}

// Attach history panel events (elements exist in initial admin.html, not lazy-loaded)
const historyRefreshBtn = document.getElementById("refresh-btn-history");
if (historyRefreshBtn) historyRefreshBtn.addEventListener("click", loadPrintHistory);

const historySearchEl = document.getElementById("history-search");
if (historySearchEl) historySearchEl.addEventListener("input", () => { historyPage = 1; renderHistoryTable(); });

const historySemFilterEl = document.getElementById("history-semester-filter");
if (historySemFilterEl) historySemFilterEl.addEventListener("change", () => { historyPage = 1; renderHistoryTable(); });

// Load history data on init too (panel is hidden but data ready when user clicks)
loadPrintHistory();

// ══════════════════════════════════════════════════════════════
//  EMAIL CHANGE REQUESTS PANEL
// ══════════════════════════════════════════════════════════════
let emailRequests = [];

async function loadEmailRequests() {
  const statusFilter = document.getElementById("email-req-filter")?.value;
  const tbody        = document.getElementById("email-req-tbody");
  const countEl      = document.getElementById("email-req-count");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">Loading...</td></tr>`;

  let query = supabase
    .from("email_change_requests")
    .select("id, student_id, current_email, requested_email, reason, status, created_at, reviewed_at, student:student_id(name, student_id, email)")
    .order("created_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#dc2626;">Failed to load: ${escHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No requests found.</td></tr>`;
    if (countEl) countEl.textContent = "0 requests";
    return;
  }

  emailRequests = data;
  if (countEl) countEl.textContent = `${data.length} request${data.length !== 1 ? "s" : ""}`;

  // Update pending badge
  const pending = data.filter(r => r.status === "pending").length;
  const badge   = document.getElementById("email-req-badge");
  if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? "inline-block" : "none"; }

  tbody.innerHTML = data.map(r => {
    const student   = r.student;
    const name      = student?.name       || "—";
    const studentNo = student?.student_id || "—";
    const date      = new Date(r.created_at).toLocaleDateString("en-PH");
    const statusBadge = {
      pending:  `<span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">⏳ Pending</span>`,
      approved: `<span style="background:#d1fae5; color:#065f46; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">✅ Approved</span>`,
      rejected: `<span style="background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">❌ Rejected</span>`,
    }[r.status] || r.status;

    const actions = r.status === "pending" ? `
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button onclick="approveEmailRequest('${r.id}', '${r.student_id}')"
          style="font-size:11px; padding:4px 10px; background:#16a34a;">✅ Approve</button>
        <button onclick="rejectEmailRequest('${r.id}')"
          style="font-size:11px; padding:4px 10px; background:#dc2626;">❌ Reject</button>
      </div>` : "—";

    return `<tr>
      <td><b>${escHtml(name)}</b><br/><span style="font-size:11px; color:#64748b;">${escHtml(studentNo)}</span></td>
      <td style="font-size:12px;">${escHtml(r.current_email || r.student?.email || "—")}</td>
      <td style="font-size:12px; font-weight:bold;">${escHtml(r.requested_email)}</td>
      <td style="font-size:12px; max-width:200px;">${escHtml(r.reason)}</td>
      <td style="font-size:12px; white-space:nowrap;">${date}</td>
      <td>${statusBadge}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
}


async function approveEmailRequest(requestId, studentUuid) {
  const req = emailRequests.find(r => r.id === requestId);
  if (!req) return;

  const confirmed = await fpConfirm(
    `Approve email change for this student?\n\nNew email: ${req.requested_email}\n\nThis will immediately update their email on record.`
  );
  if (!confirmed) return;

  // Use studentUuid passed directly — req.users?.id is unreliable from the join
  const { error: updateError } = await supabase
    .from("users")
    .update({ email: req.requested_email })
    .eq("id", studentUuid);

  if (updateError) { await fpAlert("Failed to update email: " + updateError.message, "error"); return; }

  const { error: reqError } = await supabase
    .from("email_change_requests")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (reqError) { await fpAlert("Email updated but failed to mark request approved.", "error"); return; }

  await fpAlert("Email change approved and updated successfully.", "success");
  loadEmailRequests();
}

async function rejectEmailRequest(requestId) {
  const confirmed = await fpConfirm("Reject this email change request?");
  if (!confirmed) return;

  const { error } = await supabase
    .from("email_change_requests")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) { await fpAlert("Failed to reject: " + error.message, "error"); return; }
  await fpAlert("Request rejected.", "success");
  loadEmailRequests();
}

window.approveEmailRequest = approveEmailRequest;
window.rejectEmailRequest  = rejectEmailRequest;

// Email requests panel events
document.getElementById("refresh-email-req-btn")?.addEventListener("click", loadEmailRequests);
document.getElementById("email-req-filter")?.addEventListener("change", loadEmailRequests);

// Load pending badge count on init
loadEmailRequests();

// ── Admin Reset Password (fires Supabase reset email for staff) ──


// ── Init ──
loadSummary();
loadRankings();