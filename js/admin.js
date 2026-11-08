// ============================================================
//  FacultyPulse — Admin Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula + IFER Report
// ============================================================

import { supabase } from "./supabase.js";
import "./password-toggle.js";
import { PROGRAM_TO_ORG_DEPARTMENT, ORG_DEPARTMENT_NAMES } from "./departments.js";
import { fpAlert, fpConfirm, fpLoading } from "./modal.js";

// ── Lazy panels: a panel's data loads the first time its sidebar tab is
//    opened (admin.html dispatches "fp:panel"), not all at page load. ──
const lazyLoaders = {};
const lazyDone    = new Set();
function lazyPanel(panelId, fn) { lazyLoaders[panelId] = fn; }
window.addEventListener("fp:panel", (e) => {
  const id = e.detail;
  if (lazyLoaders[id] && !lazyDone.has(id)) { lazyDone.add(id); lazyLoaders[id](); }
});

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "admin") {
  window.location.href = "../staff.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + (sessionStorage.getItem("name") && sessionStorage.getItem("name") !== "null" ? sessionStorage.getItem("name") : "Administrator");

let barChart   = null;
let donutChart = null;

// ══════════════════════════════════════════════════════════════
//  RATING HELPERS
// ══════════════════════════════════════════════════════════════
// CMO No. 19 s.2025 SEF rating bands (5 bands, not 4 — there is no "Poor"
// tier; "Needs Improvement" is the bottom band, 79.99 and below):
//   96.00–100.00  Outstanding
//   91.00– 95.99  Very Satisfactory
//   86.00– 90.99  Satisfactory
//   80.00– 85.99  Developing
//   79.99 & below Needs Improvement
function getRatingLabel(score) {
  if (score >= 96) return "Outstanding";
  if (score >= 91) return "Very Satisfactory";
  if (score >= 86) return "Satisfactory";
  if (score >= 80) return "Developing";
  return "Needs Improvement";
}

function getReportStageBadge(stage) {
  const map = {
    pending:                 { label: "Awaiting Supervisor", bg: "#fef3c7", color: "#92400e" },
    forwarded_to_supervisor: { label: "Awaiting Supervisor", bg: "#dbeafe", color: "#1e40af" },
    supervisor_done:         { label: "Supervisor Done",     bg: "#d1fae5", color: "#065f46" },
    released:                { label: "Released",            bg: "#ede9fe", color: "#5b21b6" },
  };
  const s = map[stage] || map.pending;
  return `<span style="background:${s.bg}; color:${s.color}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; white-space:nowrap;">${s.label}</span>`;
}

function getRatingColor(score) {
  if (score >= 96) return "#10b981"; // Outstanding
  if (score >= 91) return "#3b82f6"; // Very Satisfactory
  if (score >= 86) return "#f59e0b"; // Satisfactory
  if (score >= 80) return "#f97316"; // Developing
  return "#ef4444";                  // Needs Improvement
}

// ══════════════════════════════════════════════════════════════
//  WEIGHTED SET COMPUTATION — CMO No. 19 Annex C
// ══════════════════════════════════════════════════════════════
async function computeWeightedSET(teacherId, semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) return null;

  const catTotals = { A: 0, B: 0, C: 0 };
  const catCounts = { A: 0, B: 0, C: 0 };

  // Fetch each subject's raw evaluation_scores IN PARALLEL instead of one
  // await per subject in a sequential for-loop — with N subjects this cuts
  // the report's DB round-trips from N sequential waits to one parallel
  // batch. `submitted_at` is included/ordered here (previously only in a
  // separate, duplicate query in viewReport()'s raw-data panel) so callers
  // can reuse this same result instead of re-querying the same rows.
  const subjectResults = await Promise.all(
    subjects.map(subject =>
      supabase
        .from("evaluation_scores")
        .select("scores, submitted_at")
        .eq("subject_id", subject.id)
        .eq("semester_id", semesterId)
        .order("submitted_at", { ascending: true })
        .then(({ data }) => ({ subject, evals: data || [] }))
    )
  );

  const classData      = [];
  const rawScoresBySubject = {};
  let totalWeighted    = 0;
  let totalEnrolled    = 0;
  let totalRespondents = 0;

  for (const { subject, evals } of subjectResults) {
    rawScoresBySubject[subject.id] = evals;

    if (evals.length === 0) {
      classData.push({
        subjectId:     subject.id,
        course:        subject.name,
        section:       subject.sections?.name || "—",
        noStudents:    0, // 0 respondents, not enrolled_count — see fix note below
        enrolledCount: subject.enrolled_count || 0, // roster size, for display only
        avgSETRating:  0,
        weightedScore: 0,
        respondents:   0,
      });
      continue;
    }

    let sumRatings = 0;
    evals.forEach(e => {
      const totalScore = Object.values(e.scores).reduce((s, v) => s + v, 0);
      const rating     = (totalScore / 75) * 100;
      sumRatings      += rating;

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
    // Weight/divisor = number of students who actually RESPONDED, not
    // subject.enrolled_count (full class roster). Per QA, the hand-
    // computed version of this report has always divided by respondents —
    // enrolled_count stays as roster bookkeeping ("Sync Enrolled" etc.)
    // but no longer feeds this formula. `totalEnrolled`/`noStudents` keep
    // their old names below (so the report template and viewReport()'s
    // "No. of Students" column/explanation text don't need to change),
    // but the value they carry is now respondents, not enrolled_count.
    const weightedScore = parseFloat((respondents * avgSETRating).toFixed(2));

    classData.push({
      subjectId:     subject.id,
      course:        subject.name,
      section:       subject.sections?.name || "—",
      noStudents:    respondents,
      enrolledCount: subject.enrolled_count || 0, // roster size, for display only
      avgSETRating,
      weightedScore,
      respondents,
    });

    totalWeighted    += weightedScore;
    totalEnrolled    += respondents;
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
    rawScoresBySubject,
  };
}

// ══════════════════════════════════════════════════════════════
//  LOAD SUMMARY COUNTS
// ══════════════════════════════════════════════════════════════
async function loadSummary() {
  // Every card is scoped to the ACTIVE semester, so a freshly activated,
  // not-yet-imported semester correctly reads 0 / 0 / 0 (and the numbers
  // climb as you import — a quick sanity check on the import itself).
  const { data: activeSem } = await supabase
    .from("semesters").select("id").eq("is_active", true).maybeSingle();

  let facultyCount = 0, studentCount = 0, evalCount = 0;
  if (activeSem) {
    const [counts, evals] = await Promise.all([
      supabase.rpc("admin_semester_counts", { p_semester_id: activeSem.id }),
      supabase.from("evaluation_scores")
        .select("*", { count: "exact", head: true })
        .eq("semester_id", activeSem.id),
    ]);
    const row = Array.isArray(counts.data) ? counts.data[0] : counts.data;
    facultyCount = counts.error ? null : Number(row?.faculty ?? 0);
    studentCount = counts.error ? null : Number(row?.students ?? 0);
    evalCount    = evals.count ?? 0;
  }

  document.getElementById("count-faculty").textContent  = facultyCount  ?? "—";
  document.getElementById("count-students").textContent = studentCount  ?? "—";
  document.getElementById("count-evals").textContent    = evalCount     ?? "—";
}

// ══════════════════════════════════════════════════════════════
//  FACULTY RANKINGS — with pagination
// ══════════════════════════════════════════════════════════════
let allRanked    = [];
let rankPage     = 1;
const RANK_SIZE  = 8;

const EMPLOYMENT_GROUP_ORDER = { "Full-time": 0, "Part-time": 1 };
let rankGroupByEmployment = true;

// `opts.preserve === true` is passed by the auto-refresh timer below: it
// re-fetches and re-renders with fresh data WITHOUT resetting the page
// number or the faculty/program filter selections an admin may be mid-
// using. A manual click of "🔄 Refresh" (opts omitted) still resets to
// page 1 like before — that's an explicit action, not a background tick.
let rankingsLoadToken = 0;

// Wipe everything the dashboard derives from the ranked list, so an early
// exit (no active semester, no faculty) can't leave the PREVIOUS semester's
// table, bar chart or donut chart on screen.
function clearRankingsData(message) {
  allRanked = [];
  rankPage  = 1;
  renderRankingsPage();          // also redraws the bar chart (empty)
  renderDonutChart([]);
  populateDashFacultyFilter();
  populateReportFacultySelect([]);
  const tbody = document.getElementById("rankings-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="5">${message}</td></tr>`;
}

async function loadRankings(opts = {}) {
  const preserve = opts.preserve === true;
  const myLoad   = ++rankingsLoadToken;
  const tbody = document.getElementById("rankings-tbody");
  if (!preserve) tbody.innerHTML = `<tr><td colspan="5">Loading...</td></tr>`;

  const { data: semester } = await supabase
    .from("semesters").select("id").eq("is_active", true).maybeSingle();

  if (myLoad !== rankingsLoadToken) return;   // a newer load started

  if (!semester) {
    clearRankingsData("No active semester.");
    return;
  }

  // One database call returns the finished ranking rows (averages, response
  // counts, "12/36 students" progress, release stage). The calculation used to
  // run here by downloading every evaluation/enrollment row — slow, and
  // silently wrong once a table passed the API's 1,000-row cap.
  const { data: rankedData, error: rankErr } = await supabase
    .rpc("admin_rankings", { p_semester_id: semester.id });

  if (myLoad !== rankingsLoadToken) return;   // a newer load started

  if (rankErr) {
    console.warn("admin_rankings failed:", rankErr.message);
    if (!preserve) clearRankingsData("Couldn't load rankings. Check your connection and press Refresh.");
    return;   // on a background refresh, keep what is already on screen
  }

  const ranked = Array.isArray(rankedData) ? rankedData : [];


  // Drop this result if the active semester changed (or another refresh
  // started) while we were fetching — otherwise a slow auto-refresh for the
  // OLD semester could overwrite the new semester's dashboard.
  if (myLoad !== rankingsLoadToken) return;
  allRanked = ranked;

  // Rebuilt on every load (it used to be filled once, so programs from a
  // previous semester lingered). The current selection is kept only if it
  // still exists in this semester.
  const progFilter = document.getElementById("dash-program-filter");
  if (progFilter) {
    const cur = progFilter.value;
    const programs = [...new Set(ranked.map(t => t.program).filter(p => p && p !== "—"))].sort();
    progFilter.innerHTML = `<option value="">All Programs</option>` +
      programs.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join("");
    progFilter.value = programs.includes(cur) ? cur : "";
  }

  if (!preserve) rankPage = 1;
  // renderRankingsPage() already renders the bar chart (filtered by the
  // current program/faculty selection) — a second renderBarChart(ranked)
  // call right after it was pure redundant work, double-triggering the
  // chart's entrance animation on every load. Only the donut chart still
  // needs its own call since renderRankingsPage() doesn't touch it.
  renderRankingsPage(preserve);
  populateDashFacultyFilter();

  populateReportFacultySelect(ranked);

  renderDonutChart(ranked, { silent: preserve });
}

// "12/20 students" + a thin progress bar. done = students who evaluated all
// of this teacher's subjects they are enrolled in; expected = students taught.
function evalProgressHtml(p) {
  if (!p || p.expected <= 0) return `<span style="font-size:12px;color:#64748b;">—</span>`;
  const d = p.done, e = p.expected;
  const pct = Math.min(100, Math.round((d / e) * 100));
  const color = pct >= 75 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  return `
    <div style="min-width:120px;" title="${d} of ${e} students have finished evaluating this faculty (${pct}%)">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:3px;">
        <span>${d}/${e} students</span><span style="color:#64748b;font-weight:500;">${pct}%</span>
      </div>
      <div style="height:6px;border-radius:4px;background:#e5e7eb;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
    </div>`;
}

function renderRankingsPage(silent = false) {
  const tbody = document.getElementById("rankings-tbody");

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  let filtered = progFilter
    ? allRanked.filter(t => t.program === progFilter)
    : allRanked.slice();

  if (facFilter) {
    filtered = filtered.filter(t => t.id === facFilter);
  }

  if (rankGroupByEmployment) {
    filtered.sort((a, b) => {
      const groupA = EMPLOYMENT_GROUP_ORDER[a.employmentType] ?? 2;
      const groupB = EMPLOYMENT_GROUP_ORDER[b.employmentType] ?? 2;
      if (groupA !== groupB) return groupA - groupB;
      return b.overallSET - a.overallSET;
    });
  } else {
    filtered.sort((a, b) => b.overallSET - a.overallSET);
  }

  renderBarChart(filtered, { silent });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No evaluation data ${progFilter ? "for this program" : "yet"}.</td></tr>`;
    document.getElementById("rank-page-info").textContent = "";
    document.getElementById("rank-page-buttons").innerHTML = "";
    return;
  }

  const groupRankCounters = {};
  filtered.forEach(t => {
    const key = rankGroupByEmployment ? t.employmentType : "__all__";
    groupRankCounters[key] = (groupRankCounters[key] || 0) + 1;
    t._displayRank = groupRankCounters[key];
  });

  const totalPages = Math.ceil(filtered.length / RANK_SIZE);
  if (rankPage > totalPages) rankPage = totalPages;

  const start = (rankPage - 1) * RANK_SIZE;
  const end   = start + RANK_SIZE;
  const pageRows = filtered.slice(start, end);

  tbody.innerHTML = "";

  let prevGroup = rankGroupByEmployment
    ? (start > 0 ? filtered[start - 1].employmentType : null)
    : undefined;

  pageRows.forEach((t) => {
    if (rankGroupByEmployment) {
      if (prevGroup !== null && t.employmentType !== prevGroup) {
        tbody.innerHTML += `
          <tr>
            <td colspan="5" style="padding:6px 8px; background:#f1f5f9; text-align:center;
              font-size:10px; font-weight:700; color:#64748b; letter-spacing:.03em;">
              ${escHtml(t.employmentType)}
            </td>
          </tr>
        `;
      } else if (prevGroup === null) {
        tbody.innerHTML += `
          <tr>
            <td colspan="5" style="padding:6px 8px; background:#f1f5f9; text-align:center;
              font-size:10px; font-weight:700; color:#64748b; letter-spacing:.03em;">
              ${escHtml(t.employmentType)}
            </td>
          </tr>
        `;
      }
    }

    tbody.innerHTML += `
      <tr>
        <td>${t._displayRank}</td>
        <td>${t.name}</td>
        <td>${evalProgressHtml(t.progress)}</td>
        <td>${getReportStageBadge(t.stage)}</td>
        <td>
          <button onclick="viewReport('${t.id}','${t.name.replace(/'/g,"\\'")}')">
            View Report
          </button>
        </td>
      </tr>
    `;

    prevGroup = t.employmentType;
  });

  document.getElementById("rank-page-info").textContent =
    `Showing ${start + 1}–${Math.min(end, filtered.length)} of ${filtered.length} faculty`;

  renderPager("rank-page-buttons", totalPages, rankPage, (p) => {
    rankPage = p;
    renderRankingsPage();
  });
}

// ══════════════════════════════════════════════════════════════
//  SHARED PAGINATION RENDERER
// ══════════════════════════════════════════════════════════════
function renderPager(containerId, totalPages, current, onGo) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.className   = "page-btn";
  prev.textContent = "‹ Prev";
  prev.disabled    = current === 1;
  prev.onclick     = () => onGo(current - 1);
  container.appendChild(prev);

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

  const next = document.createElement("button");
  next.className   = "page-btn";
  next.textContent = "Next ›";
  next.disabled    = current === totalPages;
  next.onclick     = () => onGo(current + 1);
  container.appendChild(next);
}

// ══════════════════════════════════════════════════════════════
//  GENERATE IFER REPORT — Annex C Format
// ══════════════════════════════════════════════════════════════
async function viewReport(teacherId, teacherName) {
  const reportContent = document.getElementById("report-content");
  reportContent.innerHTML = `<p style="text-align:center; color:#64748b;">Loading report...</p>`;
  document.getElementById("report-modal").classList.remove("hidden");

  window._reportTeacherId   = teacherId;
  window._reportTeacherName = teacherName;

  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).maybeSingle();

  if (!semester) {
    reportContent.innerHTML = `<p>No active semester found.</p>`;
    return;
  }
  window._reportSemesterId = semester.id;

  // All five of these queries are independent of one another (none needs
  // another's result), so they run in parallel instead of one await after
  // another — this alone turns 5 sequential round-trips into 1.
  const [
    { data: release },
    { data: teacher },
    { data: deptSubject },
    result,
    { data: supRemarksRows },
    { data: fedaf },
  ] = await Promise.all([
    supabase
      .from("report_releases")
      .select("released_at, released_by, stage")
      .eq("teacher_id", teacherId)
      .eq("semester_id", semester.id)
      .maybeSingle(),
    supabase
      .from("users")
      .select("name, academic_rank, email")
      .eq("id", teacherId)
      .single(),
    supabase
      .from("subjects")
      .select("sections(department)")
      .eq("teacher_id", teacherId)
      .limit(1)
      .maybeSingle(),
    computeWeightedSET(teacherId, semester.id),
    supabase
      .from("supervisor_remarks")
      // ALL rows, not just the latest — a faculty member can have 2+
      // assigned supervisors (supervisor_assignments) each submitting
      // their own row; averaged below instead of showing whichever one
      // happened to be submitted most recently.
      .select("sef_score, comments, remarks, submitted_at, supervisor_id")
      .eq("teacher_id", teacherId)
      .eq("semester_id", semester.id)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("fedaf")
      .select("areas_improvement, proposed_activities, action_plan, supervisor_signed")
      .eq("teacher_id", teacherId)
      .eq("semester_id", semester.id)
      .maybeSingle(),
  ]);

  window._reportStage    = release?.stage || "pending";
  window._reportReleased = release?.stage === "released";

  const department = deptSubject?.sections?.department || "—";

  if (!result) {
    reportContent.innerHTML = `<p>No evaluation data found for this faculty.</p>`;
    return;
  }

  const { overallSET, classData, totalEnrolled, totalWeighted,
          avgA, avgB, avgC, rawScoresBySubject } = result;

  // With 2+ assigned supervisors, each one submits their own
  // supervisor_remarks row — the faculty's SEF rating is the AVERAGE of
  // every submitted score, not whichever row happened to be most recent.
  // Comments/remarks from multiple supervisors are concatenated (labeled
  // when there's more than one) rather than only showing the latest.
  const scoredRows = (supRemarksRows || []).filter(r => r.sef_score != null);
  const sefRating  = scoredRows.length > 0
    ? (scoredRows.reduce((sum, r) => sum + Number(r.sef_score), 0) / scoredRows.length).toFixed(2)
    : "—";
  const multipleSupervisors = (supRemarksRows || []).length > 1;
  const supComments   = (supRemarksRows || [])
    .filter(r => r.comments)
    .map(r => multipleSupervisors ? `• ${r.comments}` : r.comments)
    .join("\n");
  const supRemarksTxt = (supRemarksRows || [])
    .filter(r => r.remarks)
    .map(r => multipleSupervisors ? `• ${r.remarks}` : r.remarks)
    .join("\n");

  // rawScoresBySubject now comes straight from computeWeightedSET(), which
  // already fetched each subject's evaluation_scores (with submitted_at) —
  // no need to re-query the same rows again here.

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

  window._studentComments = studentComments;

  const SET_QUESTIONS_SHORT = [
    "Comes to class on time.",
    "Explains learning outcomes, expectations, grading system, and requirements.",
    "Maximizes allocated time/learning hours effectively.",
    "Facilitates critical and creative thinking via appropriate activities.",
    "Guides independent learning and decision-making.",
    "Communicates constructive feedback for academic growth.",
    "Demonstrates extensive knowledge of the subject/course.",
    "Simplifies complex ideas for ease of understanding.",
    "Relates subject matter to contemporary issues and daily life.",
    "Promotes active learning using ICT tools and platforms.",
    "Uses appropriate assessments aligned with learning outcomes.",
    "Recognizes and values unique diversity among students.",
    "Assists students during consultation hours.",
    "Provides immediate feedback on outputs and performance.",
    "Provides transparent and clear criteria in rating performance.",
  ];

  function buildRawDataPanel() {
    const panelId = "raw-data-panel-" + teacherId;

    let html = `
      <div class="no-print" style="margin-bottom:20px; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
        <div onclick="document.getElementById('${panelId}').classList.toggle('hidden')"
          style="background:#f1f5f9; padding:12px 16px; cursor:pointer; display:flex;
            align-items:center; justify-content:space-between; user-select:none;">
          <span style="font-weight:600; font-size:13px; color:#1e293b;">
            📊 Raw Evaluation Data (QA View Only — Not Printed)
          </span>
          <span style="font-size:11px; color:#64748b;">Click to expand/collapse</span>
        </div>
        <div id="${panelId}" class="hidden" style="padding:16px;">
          <p style="font-weight:700; font-size:13px; color:#1e293b; margin:0 0 12px;">
            Student Evaluation of Teachers (SET) — Individual Submissions
          </p>`;

    for (const c of classData) {
      const evals = rawScoresBySubject[c.subjectId] || [];
      html += `
          <p style="font-weight:600; font-size:12px; color:#334155; margin:0 0 6px;">
            ${escHtml(c.course)} (${escHtml(c.section)})
            — ${evals.length} respondent${evals.length !== 1 ? "s" : ""}
            out of ${c.enrolledCount} enrolled
            | Avg SET: <b>${c.avgSETRating.toFixed(2)}</b>
            | Weighted: <b>${c.weightedScore.toFixed(2)}</b>
          </p>`;

      if (evals.length === 0) {
        html += `<p style="font-size:11px; color:#94a3b8; margin:0 0 14px; padding-left:8px;">No submissions yet.</p>`;
        continue;
      }

      // Per-respondent columns (R1, R2, …) are deliberately NOT rendered here —
      // even without a name attached, a row of individual answers is exactly
      // the kind of granular data that's easy to re-identify in a small
      // class (e.g. "the one student who gave all 1s"). Only the per-question
      // AVERAGE across respondents is shown, consistent with how the rest of
      // this report (and the Executive dashboard) already only ever shows
      // aggregates — never an individual submission.
      html += `
          <div style="overflow-x:auto; margin-bottom:16px;">
            <table style="border-collapse:collapse; font-size:11px; min-width:100%;">
              <thead>
                <tr>
                  <th style="border:1px solid #cbd5e1; padding:6px 8px; background:#f8fafc;
                    text-align:left; min-width:260px; color:#334155;">Question</th>
                  <th style="border:1px solid #cbd5e1; padding:6px 8px; background:#eff6ff;
                    text-align:center; color:#1e40af; min-width:70px;">Avg (/5)</th>
                </tr>
              </thead>
              <tbody>`;

      ["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10","q11","q12","q13","q14","q15"]
        .forEach((qid, qi) => {
          if (qi === 0)
            html += `<tr><td colspan="2"
              style="background:#f1f5f9; padding:5px 8px; font-size:10px;
                font-weight:600; color:#475569; border:1px solid #cbd5e1;">
              A. Management of Teaching and Learning</td></tr>`;
          if (qi === 6)
            html += `<tr><td colspan="2"
              style="background:#f1f5f9; padding:5px 8px; font-size:10px;
                font-weight:600; color:#475569; border:1px solid #cbd5e1;">
              B. Content Knowledge, Pedagogy and Technology</td></tr>`;
          if (qi === 11)
            html += `<tr><td colspan="2"
              style="background:#f1f5f9; padding:5px 8px; font-size:10px;
                font-weight:600; color:#475569; border:1px solid #cbd5e1;">
              C. Commitment and Transparency</td></tr>`;

          const vals = evals.map(e => e.scores?.[qid] ?? "—");
          const numVals = vals.filter(v => typeof v === "number");
          const avg = numVals.length
            ? (numVals.reduce((a,b) => a+b, 0) / numVals.length).toFixed(2)
            : "—";

          html += `<tr>
            <td style="border:1px solid #cbd5e1; padding:5px 8px; color:#334155;">
              <b>${qi + 1}.</b> ${escHtml(SET_QUESTIONS_SHORT[qi])}
            </td>
            <td style="border:1px solid #cbd5e1; padding:5px 8px;
              text-align:center; font-weight:600; color:#1e40af; background:#eff6ff;">${avg}</td>
          </tr>`;
        });

      html += `<tr style="background:#eff6ff;">
        <td style="border:1px solid #cbd5e1; padding:6px 8px; font-weight:700; color:#1e40af;">
          Computed SET Rating (class average)
        </td>
        <td style="border:1px solid #cbd5e1; padding:6px 8px;
          text-align:center; font-weight:700; color:#1e40af;">${c.avgSETRating.toFixed(2)}</td>
      </tr>`;

      html += `</tbody></table></div>`;
    }

    html += `
          <div style="border-top:2px solid #e2e8f0; margin-top:4px; padding-top:16px;">
            <p style="font-weight:700; font-size:13px; color:#1e293b; margin:0 0 12px;">
              Supervisor's Evaluation of Faculty (SEF) — Summary
            </p>`;

    if ((supRemarksRows || []).length > 0) {
      html += `
            <table style="border-collapse:collapse; font-size:12px; width:100%; max-width:420px; margin-bottom:12px;">
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155;">Overall SEF Rating${multipleSupervisors ? ` (avg. of ${scoredRows.length})` : ""}</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; text-align:center;
                  font-weight:700; font-size:15px; color:#1e40af;">${sefRating}</td>
              </tr>
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155; vertical-align:top;">Supervisor Comments</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; color:#334155;
                  font-size:11px; line-height:1.6; white-space:pre-line;">
                  ${supComments ? escHtml(supComments) : "<em style='color:#94a3b8;'>No comments submitted.</em>"}
                </td>
              </tr>
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155; vertical-align:top;">Supervisor Remarks</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; color:#334155;
                  font-size:11px; line-height:1.6; white-space:pre-line;">
                  ${supRemarksTxt ? escHtml(supRemarksTxt) : "<em style='color:#94a3b8;'>No remarks submitted.</em>"}
                </td>
              </tr>
            </table>
            <p style="font-size:10px; color:#94a3b8; margin:0;">
              Note: Per-question SEF scores are not stored individually — only the computed overall SEF rating is recorded.
            </p>`;
    } else {
      html += `<p style="font-size:12px; color:#94a3b8; font-style:italic;">
        No supervisor evaluation submitted for this faculty this semester.
      </p>`;
    }

    html += `</div></div></div>`;
    return html;
  }

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
        return `<div class="no-print" style="background:#faf5ff; border:1px solid #c4b5fd; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#6d28d9;">
          ⏳ <b>AWAITING SUPERVISOR SEF</b> — Waiting for the supervisor's evaluation. Faculty cannot see this report yet.
        </div>`;
      })()}

      ${buildRawDataPanel()}

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
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.avgSETRating.toFixed(2)}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center; color:#000;">${c.weightedScore.toFixed(2)}</td>
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
        Therefore, ${totalWeighted.toFixed(2)}÷${totalEnrolled} = <b>${overallSET.toFixed(2)}</b>
      </p>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; width:40%;"></th>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; text-align:center; font-weight:bold;">SET Rating</th>
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; text-align:center; font-weight:bold;">SEF Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px; border:1px solid #000; font-weight:bold; color:#000;">OVERALL RATING</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px; color:#000;">${overallSET.toFixed(2)}</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px; color:#000;">${sefRating}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:10px; color:#000; margin-bottom:16px; font-style:italic;">
        *Note: rating given by the supervisor using the SEF instrument
      </p>

      <!-- Category Breakdown — extra (not in CMO Annex C): hidden on print / PDF -->
      <div class="no-print">
      <p style="font-size:11px; color:#000; font-weight:bold; margin-bottom:6px;">Category Breakdown</p>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:left; font-weight:bold;">Category</th>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Score</th>
            <th style="background:#fff; color:#000; padding:6px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">A. Management of Teaching and Learning</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgA.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgA)}; font-weight:600;">${getRatingLabel(avgA)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">B. Content Knowledge, Pedagogy and Technology</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgB.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgB)}; font-weight:600;">${getRatingLabel(avgB)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000; color:#000;">C. Commitment and Transparency</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:#000;">${avgC.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgC)}; font-weight:600;">${getRatingLabel(avgC)}</td>
          </tr>
        </tbody>
      </table>
      </div>

      <!-- D. Summary of Qualitative Comments and Suggestions -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:4px;">D. Summary of Qualitative Comments and Suggestions</p>
      <p style="font-size:10px; color:#000; font-style:italic; margin-bottom:8px;">
        Comments shown exactly as submitted, without student identity, per CMO §6.10.
      </p>

      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; width:40px; font-weight:bold;">Seq</th>
            <th style="background:#fff; color:#000; padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">Comments and Suggestions from the Students</th>
          </tr>
        </thead>
        <tbody>
          ${studentComments.length > 0
            ? studentComments.map((c, i) => `
              <tr>
                <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${i + 1}</td>
                <td style="padding:14px 8px; border:1px solid #000; color:#000;">${escHtml(c)}</td>
              </tr>
            `).join("")
            : `
              <tr>
                <td colspan="2" style="padding:14px 8px; border:1px solid #000; text-align:center; font-style:italic; color:#000;">
                  No student comments submitted for this faculty this semester.
                </td>
              </tr>
            `}
        </tbody>
      </table>

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
          style="font-size:12px; padding:5px 12px; background:white; color:#475569; border:1px solid #475569; border-radius:5px; cursor:pointer;">
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

      <!-- ANNEX D — FEDAF -->
      <div id="annex-d-section" style="page-break-before:always; padding-top:8px;">

        <h3 style="text-align:center; font-size:12px; font-weight:bold; margin-bottom:16px; text-transform:uppercase; letter-spacing:.02em;">
          Faculty Evaluation and Development Acknowledgment Form
        </h3>

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
                ${overallSET.toFixed(2)}
              </td>
              <td style="padding:14px 10px; border:1px solid #000; text-align:center; font-size:20px; font-weight:bold; color:#000;">
                ${sefRating}
              </td>
            </tr>
          </tbody>
        </table>

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

        <p style="font-size:12px; line-height:1.8; margin-bottom:20px; text-align:justify; color:#000; font-weight:bold;">
          I acknowledge that I have received and reviewed the faculty evaluation conducted for
          the period mentioned above. I understand that my signature below does not necessarily
          indicate agreement with the evaluation but confirms that I have been given the
          opportunity to discuss it with my supervisor.
        </p>

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
  updateReleaseButton();
}

// ══════════════════════════════════════════════════════════════
//  CHARTS
// ══════════════════════════════════════════════════════════════
// `silent` is set by the 30s background auto-refresh: it updates the
// existing chart's data in place and applies it with no animation,
// instead of destroy()-ing and creating a new Chart every tick (which
// forces Chart.js to replay its full entrance animation each time —
// that's the "loading" flicker replaying every 30s). Manual refresh and
// filter changes are user-initiated, so they keep the normal animation.
function renderBarChart(ranked, { silent = false } = {}) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("bar-chart").getContext("2d");

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  let scoped = progFilter ? ranked.filter(t => t.program === progFilter) : ranked;

  let labels, data, colors, chartTitle, tooltipSuffix;

  if (facFilter) {
    const t = scoped.find(x => x.id === facFilter);
    labels        = t ? [t.name.split(",")[0]] : [];
    data          = t ? [t.overallSET] : [];
    colors        = t ? [getRatingColor(t.overallSET)] : [];
    tooltipSuffix = [""];
    chartTitle    = t ? `${t.name} — SET Rating` : "Faculty SET Rating";
  } else if (!progFilter) {
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
    chartTitle    = "Program-Level SET Rating Comparison";
  } else {
    labels        = scoped.map(t => t.name.split(",")[0]);
    data          = scoped.map(t => t.overallSET);
    colors        = scoped.map(t => getRatingColor(t.overallSET));
    tooltipSuffix = scoped.map(() => "");
    chartTitle    = `Faculty SET Rating Comparison — ${progFilter}`;
  }

  const headingEl = document.querySelector("#bar-chart").closest(".chart-card")?.querySelector("h3");
  if (headingEl) headingEl.textContent = `📊 ${chartTitle}`;

  // tooltipSuffix varies per dataset shape (per-program vs per-faculty), so
  // it's stashed on the chart instance itself for the tooltip callback below
  // to read — that callback is defined once at creation time either way.
  if (silent && barChart) {
    barChart.data.labels            = labels;
    barChart.data.datasets[0].data  = data;
    barChart.data.datasets[0].backgroundColor = colors;
    barChart._tooltipSuffix = tooltipSuffix;
    barChart.update("none"); // no animation — this is a background data refresh
    return;
  }

  if (barChart) barChart.destroy();

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
              ` ${ctx.parsed.y.toFixed(2)} — ${getRatingLabel(ctx.parsed.y)}${(barChart._tooltipSuffix || [])[ctx.dataIndex] || ""}`
          }
        }
      },
      scales: {
        y: { min: 0, max: 100, ticks: { stepSize: 20 }, grid: { color: "#f0f0f0" } },
        x: { ticks: { font: { size: 11 } } }
      }
    }
  });
  barChart._tooltipSuffix = tooltipSuffix;
}

function renderDonutChart(ranked, { silent = false } = {}) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("donut-chart").getContext("2d");

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const facFilter  = document.getElementById("dash-faculty-filter")?.value || "";

  let scoped = progFilter ? ranked.filter(t => t.program === progFilter) : ranked;
  if (facFilter) scoped = scoped.filter(t => t.id === facFilter);

  const buckets = {
    "Outstanding":       { count: 0, color: "#10b981" },
    "Very Satisfactory": { count: 0, color: "#3b82f6" },
    "Satisfactory":      { count: 0, color: "#f59e0b" },
    "Developing":        { count: 0, color: "#f97316" },
    "Needs Improvement": { count: 0, color: "#ef4444" },
  };

  scoped.forEach(t => {
    const label = getRatingLabel(t.overallSET);
    if (buckets[label]) buckets[label].count++;
  });

  const labels = Object.keys(buckets).filter(k => buckets[k].count > 0);
  const data   = labels.map(k => buckets[k].count);
  const colors = labels.map(k => buckets[k].color);

  if (silent && donutChart) {
    donutChart.data.labels                     = labels;
    donutChart.data.datasets[0].data           = data;
    donutChart.data.datasets[0].backgroundColor = colors;
    donutChart.update("none"); // no animation — background data refresh
    return;
  }

  if (donutChart) donutChart.destroy();

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

  if (stage === "supervisor_done") {
    btn.textContent      = "✅ Final Release to Faculty";
    btn.style.background = "#16a34a";
    btn.onclick          = finalRelease;
    return;
  }

  // "pending" (or legacy "forwarded_to_supervisor"): the supervisor can already
  // submit their SEF — there is no forward step any more. Release unlocks the
  // moment the SEF is submitted (database trigger → "supervisor_done").
  btn.textContent      = "⏳ Awaiting Supervisor SEF";
  btn.disabled         = true;
  btn.style.background = "#7c3aed";
}

function releasedByName() {
  const n = sessionStorage.getItem("name");
  return n && n !== "null" ? n : "Administrator";
}

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

  const { data: relRows, error } = await supabase
    .from("report_releases")
    .update({ stage: "released", released_at: new Date().toISOString(), released_by: releasedByName() })
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId)
    .eq("stage", "supervisor_done")
    .select("id");

  if (error || !relRows || relRows.length === 0) {
    await fpAlert("Failed to release: " + (error ? error.message : "the report is not in the 'Supervisor Done' stage (refresh and try again)."), "error");
    updateReleaseButton();
    return;
  }

  await fpAlert(`Report released to ${teacherName}.\nThe faculty can now view their evaluation results.`, "success");
  viewReport(teacherId, teacherName);
}

// ══════════════════════════════════════════════════════════════
//  BULK ACTIONS — Release All
//
//  Same per-teacher logic as finalRelease() above, looped over every
//  teacher in `allRanked` that's currently eligible. Each teacher is
//  written one at a time so one failure doesn't silently affect the
//  others, and the admin gets a real per-teacher success/fail count.
//  (The old "Forward All" step was removed 2026-11-05 — supervisors can
//  submit their SEF at any time now.)
// ══════════════════════════════════════════════════════════════
async function bulkFinalRelease() {
  const { data: semester } = await supabase
    .from("semesters").select("id").eq("is_active", true).maybeSingle();
  if (!semester) { await fpAlert("No active semester.", "warning"); return; }
  const semesterId = semester.id;

  // Eligible = supervisor has submitted remarks (stage "supervisor_done")
  // but not yet released — same gate as the single Release button.
  const targets = allRanked.filter(t => t.stage === "supervisor_done");

  if (targets.length === 0) {
    await fpAlert("No faculty reports are ready for release — a report only qualifies after its supervisor has submitted remarks.", "info");
    return;
  }

  const confirmed = await fpConfirm(
    `Release ${targets.length} report(s) to faculty?\n\n` +
    `This publishes every report whose supervisor has already submitted ` +
    `remarks. Faculty will immediately be able to view their results.\n\n` +
    `This action cannot be undone.`,
    { confirmLabel: `Release ${targets.length}`, confirmStyle: "fp-btn-success" }
  );
  if (!confirmed) return;

  const btn = document.getElementById("bulk-release-btn");
  if (btn) { btn.textContent = "Releasing..."; btn.disabled = true; }

  let okCount = 0, failCount = 0;
  const failedNames = [];

  for (const t of targets) {
    try {
      const { data: relRows, error } = await supabase
        .from("report_releases")
        .update({ stage: "released", released_at: new Date().toISOString(), released_by: releasedByName() })
        .eq("teacher_id", t.id)
        .eq("semester_id", semesterId)
        .eq("stage", "supervisor_done")
        .select("id");
      if (error) throw error;
      if (!relRows || relRows.length === 0) throw new Error("not in supervisor_done stage");
      okCount++;
    } catch (err) {
      failCount++;
      failedNames.push(t.name);
      console.error("Bulk release failed for", t.name, err);
    }
  }

  if (btn) { btn.textContent = "✅ Release All"; btn.disabled = false; }

  await fpAlert(
    failCount > 0
      ? `Released ${okCount} report(s).\n${failCount} failed: ${failedNames.join(", ")}`
      : `Released ${okCount} report(s) to faculty.`,
    failCount > 0 ? "error" : "success"
  );

  await loadRankings({ preserve: true });
}

document.getElementById("bulk-release-btn")?.addEventListener("click", bulkFinalRelease);

window.viewReport = viewReport;

function addCommentRow(tbodyId) {
  if (tbodyId === "student-comments-tbody") return;
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  const newSeq   = dataRows.length + 1;
  const hintRow  = tbody.querySelector("tr[data-hint]");
  const tr       = document.createElement("tr");
  tr.innerHTML   = `
    <td style="padding:14px 8px; border:1px solid #000; text-align:center; color:#000;">${newSeq}</td>
    <td style="padding:14px 8px; border:1px solid #000; color:#000;" contenteditable="true">&nbsp;</td>
  `;
  if (hintRow) tbody.insertBefore(tr, hintRow);
  else tbody.appendChild(tr);
  renumberCommentRows(tbodyId);
}

function removeCommentRow(tbodyId) {
  if (tbodyId === "student-comments-tbody") return;
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  if (dataRows.length <= 1) return;
  dataRows[dataRows.length - 1].remove();
  renumberCommentRows(tbodyId);
}

function removeSpecificCommentRow(btn, tbodyId) {
  if (tbodyId === "student-comments-tbody") return;
  const row = btn.closest("tr");
  if (!row) return;
  const tbody    = document.getElementById(tbodyId);
  const dataRows = Array.from(tbody.querySelectorAll("tr")).filter(r => !r.dataset.hint);
  if (dataRows.length <= 1) return;
  row.remove();
  renumberCommentRows(tbodyId);
}

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

// ══════════════════════════════════════════════════════════════
//  MY ACCOUNT — change own password / login email
//  Password: verified against the current one, then updated through Supabase Auth.
//  Email: done by /api/admin-change-email, which changes the Auth email AND
//  users.email together (changing only one would lock the admin out).
// ══════════════════════════════════════════════════════════════
(function initAccountModal() {
  const $ = (id) => document.getElementById(id);
  const modal = $("account-modal");
  if (!modal) return;
  const say = (el, text, bad) => { el.textContent = text; el.style.color = bad ? "#a4342a" : "#15803d"; };

  $("account-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const { data } = await supabase.auth.getSession();
    $("acct-current-email").textContent = data?.session?.user?.email || "—";
    ["acct-pw-current","acct-pw-new","acct-pw-confirm","acct-em-new","acct-em-confirm","acct-em-pw"].forEach(i => $(i).value = "");
    $("acct-pw-msg").textContent = ""; $("acct-em-msg").textContent = "";
    modal.classList.remove("hidden");
  });
  $("acct-close")?.addEventListener("click", () => modal.classList.add("hidden"));

  $("acct-pw-save")?.addEventListener("click", async () => {
    const msg = $("acct-pw-msg"), btn = $("acct-pw-save");
    const cur = $("acct-pw-current").value, nw = $("acct-pw-new").value, cf = $("acct-pw-confirm").value;
    if (!cur) return say(msg, "Enter your current password.", true);
    if (nw.length < 8) return say(msg, "New password must be at least 8 characters.", true);
    if (nw !== cf) return say(msg, "The new passwords do not match.", true);
    if (nw === cur) return say(msg, "Choose a password different from the current one.", true);
    btn.disabled = true; btn.textContent = "Updating…";
    try {
      const { data: s } = await supabase.auth.getSession();
      const email = s?.session?.user?.email;
      if (!email) return say(msg, "Session expired — please log in again.", true);
      // Re-check the current password on a throwaway basis (same client, same user).
      const { error: reErr } = await supabase.auth.signInWithPassword({ email, password: cur });
      if (reErr) return say(msg, "Current password is incorrect.", true);
      const { error } = await supabase.auth.updateUser({ password: nw });
      if (error) return say(msg, "Couldn't update: " + error.message, true);
      say(msg, "Password updated.", false);
      ["acct-pw-current","acct-pw-new","acct-pw-confirm"].forEach(i => $(i).value = "");
    } finally { btn.disabled = false; btn.textContent = "Update Password"; }
  });

  $("acct-em-save")?.addEventListener("click", async () => {
    const msg = $("acct-em-msg"), btn = $("acct-em-save");
    const em = $("acct-em-new").value.trim().toLowerCase(), cf = $("acct-em-confirm").value.trim().toLowerCase();
    const pw = $("acct-em-pw").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say(msg, "Enter a valid email address.", true);
    if (em !== cf) return say(msg, "The two email entries do not match.", true);
    if (!pw) return say(msg, "Enter your current password.", true);
    if (!(await fpConfirm(`Change your login email to ${em}?\n\nYou will be logged out and must sign in with this address. Make sure you can open its inbox.`, { confirmLabel: "Change email" }))) return;
    btn.disabled = true; btn.textContent = "Changing…";
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch("/api/admin-change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s?.session?.access_token || "") },
        body: JSON.stringify({ newEmail: em, currentPassword: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return say(msg, j.error || "Couldn't change the email.", true);
      await fpAlert("Email changed. Please log in again with " + em + ".", "success");
      await supabase.auth.signOut();
      sessionStorage.clear();
      window.location.href = "../staff.html";
    } finally { btn.disabled = false; btn.textContent = "Change Email"; }
  });
})();

document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../staff.html";
});

function populateReportFacultySelect(list) {
  const select = document.getElementById("report-faculty");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = `<option value="">— select faculty —</option>` +
    list.map(t => `<option value="${t.id}|${t.name}">${t.name}</option>`).join("");
  if ([...select.options].some(o => o.value === currentValue)) {
    select.value = currentValue;
  }
}

const reportFacultyFilterEl = document.getElementById("report-faculty-filter");
if (reportFacultyFilterEl) {
  reportFacultyFilterEl.addEventListener("input", () => {
    const q = reportFacultyFilterEl.value.trim().toLowerCase();
    const filtered = q ? allRanked.filter(t => t.name.toLowerCase().includes(q)) : allRanked;
    populateReportFacultySelect(filtered);
  });
}

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

document.getElementById("print-both-btn")?.addEventListener("click", () => {
  document.getElementById("annex-d-section").style.display = "block";
  window.print();
});

document.getElementById("print-annexc-btn")?.addEventListener("click", () => {
  const annexD = document.getElementById("annex-d-section");
  annexD.style.display = "none";
  window.print();
  annexD.style.display = "block";
});

document.getElementById("print-annexd-btn")?.addEventListener("click", () => {
  const content = document.getElementById("report-content");
  Array.from(content.children).forEach(el => {
    if (el.id !== "annex-d-section") el.setAttribute("data-hidden-print", el.style.display);
    if (el.id !== "annex-d-section") el.style.display = "none";
  });
  document.getElementById("annex-d-section").style.removeProperty("page-break-before");
  window.print();
  Array.from(content.children).forEach(el => {
    if (el.hasAttribute("data-hidden-print")) {
      el.style.display = el.getAttribute("data-hidden-print") || "";
      el.removeAttribute("data-hidden-print");
    }
  });
  document.getElementById("annex-d-section").style.pageBreakBefore = "always";
});

document.getElementById("pdf-btn").addEventListener("click", async () => {
  const btn         = document.getElementById("pdf-btn");
  const teacherName = window._reportTeacherName || "IFER";
  const element     = document.getElementById("report-content");

  btn.textContent = "Generating...";
  btn.disabled    = true;

  try {
    await window.fpLoadScript("../js/vendor/html2pdf.bundle.min.js");
  } catch (err) {
    btn.textContent = "💾 Save as PDF";
    btn.disabled    = false;
    await fpAlert("Couldn't load the PDF tool. Check your connection and try again.", "error");
    return;
  }

  const noPrint = element.querySelectorAll(".no-print");
  noPrint.forEach(el => el.setAttribute("data-pdf-hidden", el.style.display));
  noPrint.forEach(el => el.style.display = "none");

  await html2pdf().set({
    margin:      [10, 10, 10, 10],
    filename:    `IFER_${teacherName.replace(/\s+/g, "_")}.pdf`,
    image:       { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak:   { mode: ["css", "legacy"], avoid: ["tr"] },
  }).from(element).save();

  noPrint.forEach(el => el.style.display = el.getAttribute("data-pdf-hidden") || "");
  noPrint.forEach(el => el.removeAttribute("data-pdf-hidden"));

  btn.textContent = "💾 Save as PDF";
  btn.disabled    = false;
});

document.getElementById("close-report-btn").addEventListener("click", closeReportModal);

function refreshDashboard() {
  const btn = document.getElementById("refresh-btn");
  if (btn) {
    btn.textContent = "🔄 Refreshing...";
    btn.disabled = true;
  }
  const loading = fpLoading("Refreshing dashboard...");
  Promise.all([loadSummary(), loadRankings()]).finally(() => {
    loading.close();
    if (btn) {
      btn.textContent = "🔄 Refresh";
      btn.disabled = false;
    }
  });
}
const refreshBtnEl = document.getElementById("refresh-btn");
if (refreshBtnEl) refreshBtnEl.addEventListener("click", refreshDashboard);

const dashProgramFilterEl = document.getElementById("dash-program-filter");
if (dashProgramFilterEl) {
  dashProgramFilterEl.addEventListener("change", () => {
    rankPage = 1;
    populateDashFacultyFilter();
    document.getElementById("dash-faculty-filter").value = "";
    renderRankingsPage(); // already re-renders the bar chart — no need to call it again
    renderDonutChart(allRanked);
  });
}

const dashFacultyFilterEl = document.getElementById("dash-faculty-filter");
if (dashFacultyFilterEl) {
  dashFacultyFilterEl.addEventListener("change", () => {
    rankPage = 1;
    renderRankingsPage(); // already re-renders the bar chart — no need to call it again
    renderDonutChart(allRanked);
  });
}

const rankGroupToggleEl = document.getElementById("rank-group-toggle");
if (rankGroupToggleEl) {
  rankGroupByEmployment = rankGroupToggleEl.checked;
  rankGroupToggleEl.addEventListener("change", () => {
    rankGroupByEmployment = rankGroupToggleEl.checked;
    rankPage = 1;
    renderRankingsPage();
  });
}

// Preserves the current selection across re-population — needed now that
// loadRankings() can be called silently by the auto-refresh timer below.
// Without this, every auto-refresh tick would reset an admin's active
// "filter by faculty" choice back to "All Faculty" out from under them.
function populateDashFacultyFilter() {
  const facultySel = document.getElementById("dash-faculty-filter");
  if (!facultySel) return;

  const currentValue = facultySel.value;

  const progFilter = document.getElementById("dash-program-filter")?.value || "";
  const pool = progFilter
    ? allRanked.filter(t => t.program === progFilter)
    : allRanked;

  facultySel.innerHTML = `<option value="">All Faculty</option>` +
    pool.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

  if ([...facultySel.options].some(o => o.value === currentValue)) {
    facultySel.value = currentValue;
  }
}

// ══════════════════════════════════════════════════════════════
//  SYNC ENROLLED COUNTS — client-side, no DB function required.
//
//  This used to call a `sync_enrolled_counts` Postgres RPC. That RPC
//  is not defined anywhere in this codebase — no migration file for
//  it exists — which means it was either never actually created in
//  Supabase, or was dropped at some point; either way `supabase.rpc()`
//  fails against a function that doesn't exist on the server, which is
//  exactly the "Sync Enrolled doesn't work" symptom. Since there's no
//  live DB access here to inspect or recreate that function safely,
//  this replaces it with the same computation done in JS instead:
//  count each subject's real student_subjects rows directly, and
//  write back only the subjects whose enrolled_count is wrong.
// ══════════════════════════════════════════════════════════════
// Supabase/PostgREST caps an unpaginated select at 1000 rows by default.
// With 800+ students per semester, student_subjects (and potentially
// subjects itself, across semesters) can easily exceed that — an
// unpaginated fetch silently truncates instead of erroring, so this
// pages through with .range() until a page comes back short, rather
// than trusting a single select() to return everything.
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

async function syncEnrolledCounts() {
  const { data: links, error: linksError } = await fetchAllRows("student_subjects", "subject_id");
  if (linksError) return { error: linksError };

  const counts = new Map();
  (links || []).forEach(r => {
    counts.set(r.subject_id, (counts.get(r.subject_id) || 0) + 1);
  });

  const { data: subjects, error: subjError } = await fetchAllRows("subjects", "id, enrolled_count");
  if (subjError) return { error: subjError };

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

  if (errors.length > 0) {
    return { data: { updated }, error: { message: errors.slice(0, 3).join("; ") + (errors.length > 3 ? ` (+${errors.length - 3} more)` : "") } };
  }
  return { data: { updated } };
}

// ══════════════════════════════════════════════════════════════
//  AUTO-REFRESH
//
//  - Dashboard numbers (loadSummary + loadRankings) refresh every 30s.
//    Read-only, cheap (4 bulk queries, no per-row round trips), and safe
//    to run in the background — see loadRankings(opts.preserve) above,
//    which keeps the admin's current page/filter selections intact
//    instead of yanking them back to page 1 / "All Faculty" every tick.
//
//  - "Sync Enrolled" is NOT run on the same 30s cadence. That RPC does a
//    write (UPDATE) across every subject row, and enrolled counts only
//    change when students are added/dropped — something that happens
//    rarely, not every 30 seconds. Auto-running a bulk write that often
//    is just DB load with no benefit, and risks racing with an admin who
//    is mid-edit on the Subject Assignment panel. It's synced instead on
//    a much longer 5-minute cadence, silently, and only refreshes the
//    rankings table afterward if rows actually changed.
//
//  Both timers only fire while the Dashboard panel is the visible one
//  and the browser tab itself is visible (document.hidden) — no point
//  hitting Supabase every 30s for a tab the admin isn't looking at.
// ══════════════════════════════════════════════════════════════
const AUTO_REFRESH_MS       = 2 * 60 * 1000;   // dashboard numbers (was 30 s — each refresh is heavy; the Refresh button is instant)
const AUTO_SYNC_ENROLLED_MS = 5  * 60 * 1000;  // enrolled-count sync (write RPC — see note above)

let autoRefreshTimer = null;
let autoSyncTimer     = null;

function isDashboardPanelActive() {
  return document.getElementById("panel-dashboard")?.classList.contains("active");
}

async function silentDashboardRefresh() {
  if (document.hidden || !isDashboardPanelActive()) return;
  try {
    await Promise.all([loadSummary(), loadRankings({ preserve: true })]);
  } catch (err) {
    console.error("Auto-refresh failed:", err);
  }
}

async function silentEnrolledSync() {
  if (document.hidden || !isDashboardPanelActive()) return;
  try {
    const { data, error } = await syncEnrolledCounts();
    if (error) { console.error("Auto-sync enrolled counts failed:", error.message); return; }
    if (data?.updated > 0) {
      // Something actually changed — refresh the numbers derived from it.
      await loadRankings({ preserve: true });
      if (typeof loadSubjectsForAssignment === "function") loadSubjectsForAssignment();
    }
  } catch (err) {
    console.error("Auto-sync enrolled counts failed:", err);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(silentDashboardRefresh, AUTO_REFRESH_MS);
  autoSyncTimer     = setInterval(silentEnrolledSync, AUTO_SYNC_ENROLLED_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (autoSyncTimer)     clearInterval(autoSyncTimer);
  autoRefreshTimer = null;
  autoSyncTimer     = null;
}

startAutoRefresh();
window.addEventListener("beforeunload", stopAutoRefresh);

// ══════════════════════════════════════════════════════════════
//  PRINT HISTORY
// ══════════════════════════════════════════════════════════════
let allHistory      = [];
let historyPage     = 1;
const HISTORY_PAGE_SIZE = 10;

async function loadPrintHistory() {
  const tbody = document.getElementById("history-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("report_releases")
    .select("teacher_id, semester_id, released_at, released_by, stage, users(name), semesters(label)")
    .eq("stage", "released")
    .order("released_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error loading history: ${error.message}</td></tr>`;
    return;
  }

  allHistory = data || [];

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
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#94a3b8;">No reports have been released yet.</td></tr>`;
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

const historyRefreshBtn = document.getElementById("refresh-btn-history");
if (historyRefreshBtn) historyRefreshBtn.addEventListener("click", loadPrintHistory);

const historySearchEl = document.getElementById("history-search");
if (historySearchEl) historySearchEl.addEventListener("input", () => { historyPage = 1; renderHistoryTable(); });

const historySemFilterEl = document.getElementById("history-semester-filter");
if (historySemFilterEl) historySemFilterEl.addEventListener("change", () => { historyPage = 1; renderHistoryTable(); });

lazyPanel("panel-history", loadPrintHistory);

// ══════════════════════════════════════════════════════════════
//  SYNC ENROLLED COUNTS (manual button — unchanged; auto-sync above
//  is a separate, lower-frequency path that reuses this same RPC)
// ══════════════════════════════════════════════════════════════
const syncEnrolledBtn = document.getElementById("sync-enrolled-btn");
if (syncEnrolledBtn) {
  syncEnrolledBtn.addEventListener("click", async () => {
    const confirmed = await fpConfirm(
      "Sync enrolled counts?\n\nThis will update the enrolled student count for all courses based on the actual number of active students in each section.\n\nRun this before generating IFERs to ensure accurate numbers."
    );
    if (!confirmed) return;

    syncEnrolledBtn.textContent = "Syncing...";
    syncEnrolledBtn.disabled = true;

    const { data, error } = await syncEnrolledCounts();

    syncEnrolledBtn.textContent = "Sync Enrolled";
    syncEnrolledBtn.disabled = false;

    if (error) {
      await fpAlert("Sync failed: " + error.message, "error");
      return;
    }

    await fpAlert(
      `Enrolled counts synced.\n${data.updated} course(s) updated.\n\nYou can now generate IFERs with accurate student counts.`,
      "success"
    );
    loadRankings();
    // Subject Assignment caches its own list in allSubjectsForAssignment and
    // only refetches on panel-load or filter change — not on its own, so a
    // sync run from the Dashboard tab was leaving it showing pre-sync
    // numbers until the admin happened to reload the page. Refresh it here
    // too, whether or not that panel is the one currently visible — the
    // query itself is cheap, and it means the numbers are correct the next
    // time the admin switches to that tab instead of looking stale again.
    if (typeof loadSubjectsForAssignment === "function") loadSubjectsForAssignment();
  });
}

// ══════════════════════════════════════════════════════════════
//  SEMESTER MANAGEMENT
// ══════════════════════════════════════════════════════════════
const YEAR_FORMAT = /^\d{4}-\d{4}$/;

async function loadSemesters() {
  const tbody = document.getElementById("semesters-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from("semesters")
    .select("id, label, is_active, is_paused")
    .order("label", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No semesters found.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(s => {
    const statusBadge = s.is_active && s.is_paused
      ? `<span style="background:#fef3c7; color:#92400e; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:700;">⏸ Paused</span>`
      : s.is_active
        ? `<span style="background:#d1fae5; color:#065f46; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:700;">Active</span>`
        : `<span style="background:#f1f5f9; color:#475569; padding:2px 10px; border-radius:10px; font-size:11px; font-weight:700;">Inactive</span>`;

    let action;
    if (s.is_active && s.is_paused) {
      action = `<button onclick="resumeSemester('${s.id}', '${s.label.replace(/'/g, "\\'")}')"
          style="font-size:11px; padding:4px 10px; background:#16a34a; color:white; border:none; border-radius:4px; cursor:pointer;">
          ▶ Resume Submissions
        </button>`;
    } else if (s.is_active) {
      action = `<button onclick="pauseSemester('${s.id}', '${s.label.replace(/'/g, "\\'")}')"
          style="font-size:11px; padding:4px 10px; background:#d97706; color:white; border:none; border-radius:4px; cursor:pointer;">
          ⏸ Pause Submissions
        </button>`;
    } else {
      action = `<div style="display:flex; gap:6px;">
          <button onclick="activateSemester('${s.id}', '${s.label.replace(/'/g, "\\'")}')"
            style="font-size:11px; padding:4px 10px; background:#671408; color:white; border:none; border-radius:4px; cursor:pointer;">
            Set as Active
          </button>
          <button onclick="deleteSemester('${s.id}', '${s.label.replace(/'/g, "\\'")}')"
            style="font-size:11px; padding:3px 8px; background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; border-radius:4px; cursor:pointer;">
            Delete
          </button>
        </div>`;
    }

    return `<tr>
      <td><b>${s.label}</b></td>
      <td>${statusBadge}</td>
      <td>${action}</td>
    </tr>`;
  }).join("");
}

async function activateSemester(semesterId, semesterLabel) {
  const confirmed = await fpConfirm(
    `Activate "${semesterLabel}"?\n\n` +
    `• This will become the active evaluation semester\n` +
    `• The current active semester will be set to inactive (its data is preserved, not locked — you can still reactivate it later)\n` +
    `• Students will only be able to submit evaluations for courses in this semester\n\n` +
    `Proceed?`,
    { confirmLabel: "Activate", confirmStyle: "fp-btn-primary" }
  );
  if (!confirmed) return;

  const { data: current } = await supabase
    .from("semesters").select("id").eq("is_active", true).maybeSingle();

  if (current) {
    const { error: deactivateError } = await supabase
      .from("semesters")
      .update({ is_active: false, is_paused: false })
      .eq("id", current.id);
    if (deactivateError) {
      await fpAlert("Failed to deactivate current semester: " + deactivateError.message, "error");
      return;
    }
  }

  const { error: activateError } = await supabase
    .from("semesters")
    .update({ is_active: true, is_paused: false })
    .eq("id", semesterId);

  if (activateError) {
    await fpAlert("Failed to activate semester: " + activateError.message, "error");
    return;
  }

  await fpAlert(`"${semesterLabel}" is now the active semester.`, "success");
  loadSemesters();
  loadSummary();
  loadRankings();
}

async function pauseSemester(semesterId, semesterLabel) {
  const confirmed = await fpConfirm(
    `Pause submissions for "${semesterLabel}"?\n\n` +
    `• Students will NOT be able to submit new evaluations while paused\n` +
    `• Already-submitted evaluations are unaffected\n` +
    `• The semester stays active — resume it at any time\n\n` +
    `Proceed?`,
    { confirmLabel: "Pause", confirmStyle: "fp-btn-primary" }
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("semesters")
    .update({ is_paused: true })
    .eq("id", semesterId);

  if (error) {
    await fpAlert("Failed to pause: " + error.message, "error");
    return;
  }

  await fpAlert(`"${semesterLabel}" submissions paused.`, "success");
  loadSemesters();
}

async function resumeSemester(semesterId, semesterLabel) {
  const confirmed = await fpConfirm(
    `Resume submissions for "${semesterLabel}"?\n\nStudents will be able to submit evaluations again immediately.`,
    { confirmLabel: "Resume", confirmStyle: "fp-btn-success" }
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("semesters")
    .update({ is_paused: false })
    .eq("id", semesterId);

  if (error) {
    await fpAlert("Failed to resume: " + error.message, "error");
    return;
  }

  await fpAlert(`"${semesterLabel}" submissions resumed.`, "success");
  loadSemesters();
}

async function deleteSemester(semesterId, semesterLabel) {
  const confirmed = await fpConfirm(
    `Delete "${semesterLabel}"?\n\n` +
    `This permanently removes the semester record.\n` +
    `Only delete semesters with no evaluation data attached.\n\n` +
    `If evaluations exist for this semester, deletion will fail to protect data integrity.`,
    { confirmLabel: "Delete", confirmStyle: "fp-btn-danger" }
  );
  if (!confirmed) return;

  const { error } = await supabase
    .from("semesters").delete().eq("id", semesterId);

  if (error) {
    await fpAlert(
      error.code === "23503"
        ? `Cannot delete "${semesterLabel}" — it has evaluation data attached.`
        : "Delete failed: " + error.message,
      "error"
    );
    return;
  }

  await fpAlert(`"${semesterLabel}" deleted.`, "success");
  loadSemesters();
}

async function createSemester() {
  const term      = document.getElementById("new-sem-term").value;
  const year      = document.getElementById("new-sem-year").value.trim();
  const errorEl   = document.getElementById("sem-create-error");
  const createBtn = document.getElementById("create-semester-btn");
  errorEl.textContent = "";

  if (!year) { errorEl.textContent = "Academic year is required."; return; }
  if (!YEAR_FORMAT.test(year)) {
    errorEl.textContent = "Format must be YYYY-YYYY (e.g. 2025-2026)"; return;
  }

  const [startYear, endYear] = year.split("-").map(Number);
  if (endYear !== startYear + 1) {
    errorEl.textContent = "Years must be consecutive (e.g. 2025-2026)."; return;
  }

  const label = `${term} ${year}`;

  const { data: existing } = await supabase
    .from("semesters").select("id").eq("label", label).maybeSingle();

  if (existing) { errorEl.textContent = `"${label}" already exists.`; return; }

  createBtn.textContent = "Creating...";
  createBtn.disabled = true;

  const { error } = await supabase
    .from("semesters").insert({ label, is_active: false, is_paused: false });

  createBtn.textContent = "Create Semester";
  createBtn.disabled = false;

  if (error) { errorEl.textContent = "Failed to create: " + error.message; return; }

  await fpAlert(`"${label}" created.\n\nSet it as active when ready to start the next evaluation period.`, "success");
  document.getElementById("new-sem-year").value = "";
  document.getElementById("new-sem-preview").textContent = "—";
  loadSemesters();
}

window.activateSemester = activateSemester;
window.pauseSemester    = pauseSemester;
window.resumeSemester   = resumeSemester;
window.deleteSemester   = deleteSemester;

document.getElementById("new-sem-term")?.addEventListener("change", updateSemPreview);
document.getElementById("new-sem-year")?.addEventListener("input", updateSemPreview);

function updateSemPreview() {
  const term = document.getElementById("new-sem-term")?.value || "";
  const year = document.getElementById("new-sem-year")?.value.trim() || "";
  const preview = document.getElementById("new-sem-preview");
  if (preview) preview.textContent = term && year ? `${term} ${year}` : "—";
}

document.getElementById("create-semester-btn")?.addEventListener("click", createSemester);
document.getElementById("refresh-btn-semesters")?.addEventListener("click", loadSemesters);

lazyPanel("panel-semesters", loadSemesters);

// ══════════════════════════════════════════════════════════════
//  SUBJECT → TEACHER ASSIGNMENT
//
//  Redesigned around Department as the primary filter:
//    1. Admin picks a Department first.
//    2. Only THEN do the Teacher dropdown and the subject table
//       populate — both scoped to that department.
//    3. Nothing renders in the container until a department is
//       picked, instead of showing an unfiltered "everything" list
//       that scrolls forever across every program in the school.
//
//  This requires users.department (set on teacher/supervisor
//  accounts in User Management) — see admin-users.js. Without a
//  stored department, "which teachers belong to this department"
//  has no answer until subjects already exist, which is a chicken/
//  egg problem for the exact step that assigns those subjects.
// ══════════════════════════════════════════════════════════════
let allSubjectsForAssignment = [];
let subjectAssignPage        = 1;
const SUBJECT_ASSIGN_PAGE_SIZE = 20;
let selectedSubjectIds       = new Set();
let teachersForAssignment    = [];
let subjectAssignDepartment  = "";
let subjectAssignYearLevel   = "";
let currentFilteredSubjectIds = [];   // every row matching the filters, across all pages

// Filters are remembered between visits (this browser only, filters only).
const CA_FILTER_KEY = "fp_course_assign_filters_v1";
let pendingCAYearLevel = "";      // restored once the year-level options exist
let pendingCASemester  = null;    // null = nothing saved; "" = "All Semesters"
function readCAFilters() {
  try {
    const v = JSON.parse(localStorage.getItem(CA_FILTER_KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function saveCAFilters() {
  try {
    localStorage.setItem(CA_FILTER_KEY, JSON.stringify({
      dept:       subjectAssignDepartment,
      year:       subjectAssignYearLevel,
      sem:        document.getElementById("subject-assign-semester-filter")?.value ?? "",
      search:     document.getElementById("subject-assign-search")?.value || "",
      faculty:    document.getElementById("subject-assign-faculty-search")?.value || "",
      unassigned: !!document.getElementById("subject-assign-unassigned-only")?.checked,
    }));
  } catch { /* storage blocked — filters just won't be remembered */ }
}

// Section names follow {Department}-{RomanYearLevel}-{AcademicYear}
// (e.g. "BSInfoTech-III-2026-2027") — pull the Roman numeral segment
// out of that instead of storing year level anywhere separately.
function extractYearLevelFromSection(sectionName) {
  const match = String(sectionName || "").match(/-([IVX]+)-\d{4}-\d{4}$/);
  return match ? match[1] : "";
}

function populateYearLevelOptions() {
  const sel = document.getElementById("subject-assign-yearlevel");
  if (!sel) return;
  const current = sel.value;

  // "All Departments" (empty string) scopes year-level options to every
  // subject currently loaded, not zero — this dropdown is a real filter
  // now, not gated behind picking a department first.
  const deptSubjects = subjectAssignDepartment
    ? allSubjectsForAssignment.filter(s => s.sections?.department === subjectAssignDepartment)
    : allSubjectsForAssignment;
  const levels = [...new Set(
    deptSubjects.map(s => extractYearLevelFromSection(s.sections?.name)).filter(Boolean)
  )];
  // Sort by Roman-numeral value, not alphabetically (IV would otherwise sort before II)
  const ROMAN_ORDER = { I:1, II:2, III:3, IV:4, V:5, VI:6 };
  levels.sort((a, b) => (ROMAN_ORDER[a] || 99) - (ROMAN_ORDER[b] || 99));

  sel.innerHTML = `<option value="">All Year Levels</option>` +
    levels.map(l => `<option value="${l}">${l}</option>`).join("");
  if (levels.includes(current)) sel.value = current;
  else subjectAssignYearLevel = "";
  if (pendingCAYearLevel && levels.includes(pendingCAYearLevel)) {
    sel.value = pendingCAYearLevel;
    subjectAssignYearLevel = pendingCAYearLevel;
  }
  pendingCAYearLevel = "";
}

// sections.department holds a DEGREE PROGRAM code (BEED, BSA, BSED, BSHM,
// BSIT, BSInfoTech, BSTM, PEU — what the Subject Assignment filter shows),
// but users.department holds an ORG DEPARTMENT code (Agri, HTM, ICT, IT,
// TEd — a department can cover more than one program). They are NOT the
// same vocabulary, so filtering teachers with .eq("department", <program
// code>) against users.department always returned zero rows for any
// specific selection — confirmed against the real Faculty Profile import
// file's own "*Reference" column, which already recorded this exact
// mapping. PEU (general ed/PE) has no single owning department, so it's
// intentionally left unmapped — picking it in the filter shows ALL
// teachers rather than guessing one department to blame it on.
// (PROGRAM_TO_ORG_DEPARTMENT now lives in ./departments.js, shared with
// admin-users.js so the two can never drift apart.)

async function loadDepartmentsForAssignment() {
  const sel = document.getElementById("subject-assign-department");
  if (!sel) return;
  const { data, error } = await supabase.from("sections").select("department");
  if (error) { console.error("Failed to load departments:", error); return; }
  const depts = [...new Set((data || []).map(r => r.department).filter(Boolean))];
  // Show the real department name next to the program code. The option
  // VALUE stays the program code — filtering/teacher-mapping depend on it.
  const labelOf = (code) => {
    const org = PROGRAM_TO_ORG_DEPARTMENT[code];
    return org && ORG_DEPARTMENT_NAMES[org]
      ? `${ORG_DEPARTMENT_NAMES[org]} (${code})`
      : `General Education / PE (${code})`;
  };
  const opts = depts.map(d => ({ value: d, label: labelOf(d) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  sel.innerHTML = `<option value="">All Departments</option>` +
    opts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join("");
}

async function loadTeachersForAssignment(department) {
  const sel = document.getElementById("subject-assign-teacher");
  if (!sel) return;

  // "department" here is actually a PROGRAM code (see
  // PROGRAM_TO_ORG_DEPARTMENT above) — translate it before filtering
  // users.department, which speaks a different vocabulary entirely.
  const orgDepartment = department ? (PROGRAM_TO_ORG_DEPARTMENT[department] || null) : null;

  // "All Departments" (or an unmapped program like PEU) now loads every
  // active teacher, not a disabled placeholder — assigning across
  // departments in one batch is a valid (if less common) workflow, so
  // the teacher list should support it.
  let query = supabase
    .from("users")
    .select("id, name")
    .eq("role", "teacher")
    .neq("is_active", false)
    .order("name");
  if (orgDepartment) query = query.eq("department", orgDepartment);

  const { data } = await query;
  teachersForAssignment = data || [];
  sel.disabled = false;
  renderTeacherOptions(false, department);
}

// Rebuilds the teacher dropdown, narrowed by the "Find teacher" box (every
// word typed must appear in the name, any order, ignoring case/accents).
// The currently picked teacher always stays in the list. When the typing
// narrows it to exactly one teacher, that teacher is picked for you.
function renderTeacherOptions(autoPick = false, department = subjectAssignDepartment) {
  const sel = document.getElementById("subject-assign-teacher");
  if (!sel) return;
  const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = norm(document.getElementById("subject-assign-teacher-filter")?.value)
    .split(/[\s,]+/).filter(Boolean);
  const keep = sel.value;
  const shown = teachersForAssignment.filter(t =>
    t.id === keep || words.every(w => norm(t.name).includes(w)));
  if (!teachersForAssignment.length) {
    sel.innerHTML = `<option value="">No teachers found${department ? " in this department" : ""}</option>`;
    return;
  }
  if (!shown.length) {
    sel.innerHTML = `<option value="">No teacher matches</option>`;
    return;
  }
  sel.innerHTML = `<option value="">— select teacher —</option>` +
    shown.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("");
  if (keep && shown.some(t => t.id === keep)) sel.value = keep;
  else if (autoPick && words.length && shown.length === 1) sel.value = shown[0].id;
}

async function loadSubjectsForAssignment() {
  const semSel = document.getElementById("subject-assign-semester-filter");
  if (semSel && semSel.options.length <= 1) {
    const { data: sems } = await supabase
      .from("semesters").select("id, label, is_active").order("label", { ascending: false });
    (sems || []).forEach(s => {
      semSel.innerHTML += `<option value="${s.id}">${escHtml(s.label)}${s.is_active ? " (active)" : ""}</option>`;
    });
    const activeSem = (sems || []).find(s => s.is_active);
    if (activeSem) semSel.value = activeSem.id;
    // A remembered semester choice (including "All Semesters") wins over the default.
    if (pendingCASemester !== null && [...semSel.options].some(o => o.value === pendingCASemester)) {
      semSel.value = pendingCASemester;
    }
    pendingCASemester = null;
  }

  let query = supabase
    .from("subjects")
    .select("id, name, title, enrolled_count, teacher_id, section_id, semester_id, sections(name, department), teacher:users(name)");

  const semFilter = semSel?.value || "";
  if (semFilter) query = query.eq("semester_id", semFilter);

  const { data, error } = await query;
  if (error) {
    const tbody = document.getElementById("subjects-assign-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">Error loading courses: ${escHtml(error.message)}</td></tr>`;
    return;
  }

  allSubjectsForAssignment = data || [];
  populateYearLevelOptions();
  subjectAssignPage = 1;
  selectedSubjectIds.clear();
  updateSubjectAssignSelectionBar();
  renderSubjectAssignPage();
}

// ── Edit a class's course title (display-only text; the code in `name` is what matching uses) ──
async function saveSubjectTitle(subj, raw) {
  const title = String(raw || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  if ((title || null) === (subj.title || null)) { renderSubjectAssignPage(); return; }
  const { error } = await supabase.from("subjects").update({ title }).eq("id", subj.id);
  if (error) { fpAlert("Could not save the title: " + error.message, "error"); return; }
  subj.title = title;

  // Same code in other classes of the same semester with a different title?
  const others = allSubjectsForAssignment.filter(x => x.id !== subj.id && x.name === subj.name
    && x.semester_id === subj.semester_id && (x.title || null) !== title);
  if (others.length) {
    const yes = await fpConfirm(
      `Saved. ${others.length} other class${others.length === 1 ? "" : "es"} coded "${subj.name}" ha${others.length === 1 ? "s" : "ve"} a different title. Use this title for ${others.length === 1 ? "it" : "them"} too?`,
      { confirmLabel: `Yes, update ${others.length}`, cancelLabel: "No, only this class" });
    if (yes) {
      const { error: e2 } = await supabase.from("subjects").update({ title }).in("id", others.map(x => x.id));
      if (e2) fpAlert("Could not update the other classes: " + e2.message, "error");
      else others.forEach(x => { x.title = title; });
    }
  }
  renderSubjectAssignPage();
}

function renderSubjectAssignPage() {
  const tbody = document.getElementById("subjects-assign-tbody");
  if (!tbody) return;

  document.getElementById("subject-assign-select-all").disabled = false;

  const search             = (document.getElementById("subject-assign-search")?.value || "").toLowerCase();
  const showUnassignedOnly = document.getElementById("subject-assign-unassigned-only")?.checked;
  // Faculty search: every word typed must appear in the teacher's name, in any
  // order ("telmo lucille" and "Telmo, Lucille V." both find the same person),
  // ignoring case and accents. Only compared, never inserted into the page.
  const normFaculty = (v) => String(v || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const facultyWords = normFaculty(document.getElementById("subject-assign-faculty-search")?.value)
    .split(/[\s,]+/).filter(Boolean);

  let filtered = allSubjectsForAssignment.filter(s => {
    const matchDept        = !subjectAssignDepartment || s.sections?.department === subjectAssignDepartment;
    const matchYearLevel   = !subjectAssignYearLevel
      || extractYearLevelFromSection(s.sections?.name) === subjectAssignYearLevel;
    const matchSearch      = !search
      || s.name.toLowerCase().includes(search)
      || (s.title || "").toLowerCase().includes(search)
      || (s.sections?.name || "").toLowerCase().includes(search);
    const matchUnassigned  = !showUnassignedOnly || !s.teacher_id;
    const matchFaculty     = facultyWords.length === 0 || (s.teacher?.name
      && facultyWords.every(w => normFaculty(s.teacher.name).includes(w)));
    return matchDept && matchYearLevel && matchSearch && matchUnassigned && matchFaculty;
  });

  filtered.sort((a, b) =>
    a.name.localeCompare(b.name) || (a.sections?.name || "").localeCompare(b.sections?.name || "")
  );

  currentFilteredSubjectIds = filtered.map(s => s.id);
  const matchBtn = document.getElementById("subject-assign-select-matching");
  if (matchBtn) {
    matchBtn.textContent = `Select all matching (${filtered.length})`;
    matchBtn.disabled = filtered.length === 0;
  }

  const deptSubjects    = subjectAssignDepartment
    ? allSubjectsForAssignment.filter(s => s.sections?.department === subjectAssignDepartment)
    : allSubjectsForAssignment;
  const totalUnassigned = deptSubjects.filter(s => !s.teacher_id).length;
  const deptLabel  = subjectAssignDepartment || "All Departments";
  const scopeLabel = subjectAssignYearLevel
    ? `${deptLabel} — Year ${subjectAssignYearLevel}`
    : deptLabel;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No courses match in ${escHtml(scopeLabel)}.</td></tr>`;
    document.getElementById("subject-assign-count").textContent =
      `No courses found in ${scopeLabel}. (${totalUnassigned} unassigned in ${deptLabel})`;
    renderPager("subject-assign-page-buttons", 0, 1, () => {});
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / SUBJECT_ASSIGN_PAGE_SIZE));
  if (subjectAssignPage > totalPages) subjectAssignPage = totalPages;
  const start      = (subjectAssignPage - 1) * SUBJECT_ASSIGN_PAGE_SIZE;
  const pageItems  = filtered.slice(start, start + SUBJECT_ASSIGN_PAGE_SIZE);

  document.getElementById("subject-assign-count").textContent =
    `Showing ${start + 1}–${Math.min(start + SUBJECT_ASSIGN_PAGE_SIZE, filtered.length)} of ${filtered.length} in ${scopeLabel} ` +
    `(${totalUnassigned} unassigned in ${deptLabel})`;

  tbody.innerHTML = pageItems.map(s => `
    <tr class="subject-assign-row" data-id="${s.id}" style="cursor:pointer;">
      <td><input type="checkbox" class="subject-assign-checkbox" data-id="${s.id}" ${selectedSubjectIds.has(s.id) ? "checked" : ""} /></td>
      <td><b>${escHtml(s.name)}</b><div class="subject-title-cell" style="font-size:11.5px; color:#6b7280; margin-top:2px;">${s.title ? escHtml(s.title) : `<i style="color:#9ca3af;">no title</i>`} <button type="button" class="subject-title-edit-btn" data-id="${s.id}" title="Edit this course's title" aria-label="Edit title" style="border:0; background:none; color:#2563eb; cursor:pointer; font-size:12px; padding:0 3px;">✎</button></div></td>
      <td>${escHtml(s.sections?.name || "—")}</td>
      <td style="text-align:center;">${s.enrolled_count ?? 0}</td>
      <td>${s.teacher?.name
        ? `${escHtml(s.teacher.name)} <button type="button" class="subject-unassign-row-btn" data-id="${s.id}" title="Remove this teacher from this class only" aria-label="Remove teacher" style="border:0; background:none; color:#b91c1c; cursor:pointer; font-size:13px; padding:0 4px;">✕</button>`
        : `<span style="color:#d97706; font-weight:600;">Unassigned</span>`}</td>
      <td style="text-align:center;"><button type="button" class="btn-secondary subject-students-btn" data-id="${s.id}" title="Show the students in this class" style="font-size:12px; padding:3px 8px;">👥</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".subject-unassign-row-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();   // don't also tick the row
      const subj = allSubjectsForAssignment.find(x => x.id === btn.dataset.id);
      if (!subj) return;
      await clearTeacherFrom([subj.id], `${subj.name} (${subj.sections?.name || ""}) — currently ${subj.teacher?.name || "unassigned"}`);
    });
  });

  tbody.querySelectorAll(".subject-title-edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();   // don't also tick the row
      const subj = allSubjectsForAssignment.find(x => x.id === btn.dataset.id);
      if (!subj) return;
      const cell = btn.closest(".subject-title-cell");
      cell.innerHTML = `<span class="subject-title-editor" style="display:flex; gap:4px; align-items:center;">
        <input type="text" maxlength="200" style="flex:1; min-width:140px; font-size:12px; padding:3px 6px;" aria-label="Course title" />
        <button type="button" class="subject-title-save" style="font-size:11px; padding:3px 8px;">Save</button>
        <button type="button" class="btn-secondary subject-title-cancel" style="font-size:11px; padding:3px 8px;">Cancel</button>
      </span>`;
      const input = cell.querySelector("input");
      input.value = subj.title || "";
      input.focus();
      cell.querySelector(".subject-title-cancel").addEventListener("click", (ev) => { ev.stopPropagation(); renderSubjectAssignPage(); });
      const save = async (ev) => { ev?.stopPropagation(); await saveSubjectTitle(subj, input.value); };
      cell.querySelector(".subject-title-save").addEventListener("click", save);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") save(ev);
        if (ev.key === "Escape") renderSubjectAssignPage();
      });
    });
  });

  tbody.querySelectorAll(".subject-students-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();   // don't also tick the row
      openSubjectStudentsDrawer(btn.dataset.id);
    });
  });

  tbody.querySelectorAll(".subject-assign-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) selectedSubjectIds.add(id); else selectedSubjectIds.delete(id);
      updateSubjectAssignSelectionBar();
      updateSubjectAssignSelectAllCheckbox(pageItems);
    });
  });

  // Clicking anywhere on the row toggles its checkbox, not just the tiny
  // checkbox itself. Guarded so clicking the checkbox directly doesn't
  // toggle it twice (once from the native click, once from this handler).
  tbody.querySelectorAll(".subject-assign-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.matches(".subject-assign-checkbox") || e.target.closest(".subject-students-btn") || e.target.closest(".subject-unassign-row-btn") || e.target.closest(".subject-title-edit-btn") || e.target.closest(".subject-title-editor")) return;
      const cb = row.querySelector(".subject-assign-checkbox");
      if (cb) cb.click();
    });
  });

  renderPager("subject-assign-page-buttons", totalPages, subjectAssignPage, (p) => {
    subjectAssignPage = p;
    renderSubjectAssignPage();
  });

  updateSubjectAssignSelectAllCheckbox(pageItems);
}

// ── Side drawer: students enrolled in a class ──
let subjectStudentsToken = 0;
let subjectStudentsRows  = [];
let subjectStudentsSubjectId = null;
let subjectStudentsCanEdit   = false;
let subjectStudentsAddTimer  = null;
function renderSubjectStudentsList() {
  const box = document.getElementById("subject-students-list");
  if (!box) return;
  const q = String(document.getElementById("subject-students-filter")?.value || "").toLowerCase().trim();
  const rows = subjectStudentsRows.filter(r =>
    !q || String(r.name || "").toLowerCase().includes(q) || String(r.student_id || "").toLowerCase().includes(q));
  box.innerHTML = rows.length
    ? `<ol style="margin:0; padding-left:22px;">` + rows.map(r =>
        `<li style="padding:5px 0; border-bottom:1px solid #f1f5f9;">` +
        (subjectStudentsCanEdit ? `<button type="button" class="subject-students-remove" data-student="${escHtml(r.student_id || "")}" title="Remove from this class" aria-label="Remove student" style="float:right; border:0; background:none; color:#b91c1c; cursor:pointer; font-size:14px;">✕</button>` : "") +
        `<b>${escHtml(r.name || "(no name)")}</b>` +
        `<div style="font-size:11px; color:#6b7280;">${escHtml(r.student_id || "")} · ${escHtml(r.section || "no section")}</div></li>`).join("") + `</ol>`
    : `<div style="color:#6b7280; padding:12px 0;">${subjectStudentsRows.length ? "No student matches." : "No students enrolled."}</div>`;
}
function closeSubjectStudentsDrawer() {
  const d = document.getElementById("subject-students-drawer");
  if (!d) return;
  d.style.transform = "translateX(105%)";
  d.setAttribute("aria-hidden", "true");
}
async function openSubjectStudentsDrawer(subjectId) {
  const d = document.getElementById("subject-students-drawer");
  if (!d) return;
  const subj = allSubjectsForAssignment.find(x => x.id === subjectId);
  const token = ++subjectStudentsToken;
  subjectStudentsSubjectId = subjectId;
  subjectStudentsCanEdit   = false;
  const addBox = document.getElementById("subject-students-add");
  if (addBox) addBox.style.display = "none";
  const addIn = document.getElementById("subject-students-add-input");
  if (addIn) addIn.value = "";
  const addRes = document.getElementById("subject-students-add-results");
  if (addRes) addRes.innerHTML = "";
  document.getElementById("subject-students-title").textContent = subj ? `${subj.name} — ${subj.sections?.name || ""}` : "Students";
  document.getElementById("subject-students-sub").textContent =
    subj ? `Teacher: ${subj.teacher?.name || "Unassigned"}` : "";
  const filterEl = document.getElementById("subject-students-filter");
  if (filterEl) filterEl.value = "";
  subjectStudentsRows = [];
  document.getElementById("subject-students-list").innerHTML = `<div style="color:#6b7280; padding:12px 0;">Loading…</div>`;
  d.style.transform = "translateX(0)";
  d.setAttribute("aria-hidden", "false");

  const { data: links, error } = await supabase
    .from("student_subjects").select("student_id").eq("subject_id", subjectId).limit(1000);
  if (token !== subjectStudentsToken) return;   // a newer click replaced this one
  if (error) {
    document.getElementById("subject-students-list").innerHTML = `<div style="color:#b91c1c; padding:12px 0;">Couldn't load students.</div>`;
    return;
  }
  const ids = [...new Set((links || []).map(l => l.student_id).filter(Boolean))];
  let users = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from("users")
      .select("student_id, name, sections(name)").eq("role", "student").in("student_id", ids.slice(i, i + 100));
    users = users.concat(data || []);
  }
  if (token !== subjectStudentsToken) return;
  subjectStudentsRows = users.map(u => ({ student_id: u.student_id, name: u.name, section: u.sections?.name || "" }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Editing is only allowed for the ACTIVE, unlocked semester — never history.
  let editNote = "";
  if (subj?.semester_id) {
    const { data: sem } = await supabase.from("semesters")
      .select("is_active, is_locked").eq("id", subj.semester_id).maybeSingle();
    if (token !== subjectStudentsToken) return;
    subjectStudentsCanEdit = !!(sem && sem.is_active && !sem.is_locked);
    if (!subjectStudentsCanEdit) editNote = " · view only (not the active semester)";
  }
  if (addBox) addBox.style.display = subjectStudentsCanEdit ? "block" : "none";
  document.getElementById("subject-students-sub").textContent =
    `Teacher: ${subj?.teacher?.name || "Unassigned"} · ${subjectStudentsRows.length} student(s)${editNote}`;
  renderSubjectStudentsList();
}

// Re-read the real enrollment list, write the true count back to
// subjects.enrolled_count (nothing in the database keeps it in sync), and
// refresh both the panel and the table behind it.
async function refreshSubjectStudents(subjectId) {
  const { count } = await supabase.from("student_subjects")
    .select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
  if (typeof count === "number") {
    await supabase.from("subjects").update({ enrolled_count: count }).eq("id", subjectId);
    const subj = allSubjectsForAssignment.find(x => x.id === subjectId);
    if (subj) subj.enrolled_count = count;
    renderSubjectAssignPage();
  }
  if (subjectStudentsSubjectId === subjectId) await openSubjectStudentsDrawer(subjectId);
}

async function searchStudentsToAdd() {
  const box = document.getElementById("subject-students-add-results");
  const raw = String(document.getElementById("subject-students-add-input")?.value || "");
  // strip characters that have meaning inside a PostgREST filter
  const q = raw.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
  if (!box) return;
  if (q.length < 2) { box.innerHTML = ""; return; }
  const subjectId = subjectStudentsSubjectId;
  const { data, error } = await supabase.from("users")
    .select("student_id, name, sections(name)").eq("role", "student")
    .or(`name.ilike.%${q}%,student_id.ilike.%${q}%`).order("name").limit(8);
  if (subjectId !== subjectStudentsSubjectId) return;
  if (error) { box.innerHTML = `<div style="color:#b91c1c;">Search failed.</div>`; return; }
  const already = new Set(subjectStudentsRows.map(r => r.student_id));
  const rows = (data || []).filter(u => u.student_id);
  box.innerHTML = rows.length ? rows.map(u => `
    <div style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #f1f5f9;">
      <div style="flex:1; min-width:0;"><b>${escHtml(u.name)}</b>
        <div style="font-size:11px; color:#6b7280;">${escHtml(u.student_id)} · ${escHtml(u.sections?.name || "no section")}</div></div>
      ${already.has(u.student_id)
        ? `<span style="font-size:11px; color:#6b7280;">already in class</span>`
        : `<button type="button" class="btn-secondary subject-students-add-btn" data-student="${escHtml(u.student_id)}" data-name="${escHtml(u.name)}" style="font-size:12px; padding:3px 10px;">Add</button>`}
    </div>`).join("") : `<div style="color:#6b7280;">No student found.</div>`;
}

document.getElementById("subject-students-add-input")?.addEventListener("input", () => {
  clearTimeout(subjectStudentsAddTimer);
  subjectStudentsAddTimer = setTimeout(searchStudentsToAdd, 300);
});

document.getElementById("subject-students-add-results")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".subject-students-add-btn");
  if (!btn || !subjectStudentsCanEdit) return;
  const subj = allSubjectsForAssignment.find(x => x.id === subjectStudentsSubjectId);
  if (!subj) return;
  const studentId = btn.dataset.student, name = btn.dataset.name || studentId;
  const ok = await fpConfirm(`Add ${name} to ${subj.name} (${subj.sections?.name || ""})?`,
    { confirmLabel: "Add", confirmStyle: "fp-btn-primary" });
  if (!ok) return;
  btn.disabled = true;
  const { error } = await supabase.from("student_subjects")
    .insert({ student_id: studentId, subject_id: subj.id, semester_id: subj.semester_id });
  if (error && error.code !== "23505") { await fpAlert("Failed to add: " + error.message, "error"); btn.disabled = false; return; }
  document.getElementById("subject-students-add-input").value = "";
  document.getElementById("subject-students-add-results").innerHTML = "";
  await refreshSubjectStudents(subj.id);
});

document.getElementById("subject-students-list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".subject-students-remove");
  if (!btn || !subjectStudentsCanEdit) return;
  const subj = allSubjectsForAssignment.find(x => x.id === subjectStudentsSubjectId);
  const studentId = btn.dataset.student;
  const row = subjectStudentsRows.find(r => r.student_id === studentId);
  if (!subj || !row) return;
  let warn = "";
  try {
    const { count } = await supabase.from("evaluation_tracking")
      .select("id", { count: "exact", head: true }).eq("subject_id", subj.id).eq("student_id", studentId);
    if (count > 0) warn = " WARNING: this student already submitted an evaluation for this class. The evaluation stays, but they will no longer see the class.";
  } catch { /* count is only a courtesy warning */ }
  const ok = await fpConfirm(`Remove ${row.name} from ${subj.name} (${subj.sections?.name || ""})?` + warn,
    { confirmLabel: "Remove", confirmStyle: "fp-btn-danger" });
  if (!ok) return;
  const { error } = await supabase.from("student_subjects").delete()
    .eq("subject_id", subj.id).eq("student_id", studentId);
  if (error) { await fpAlert("Failed to remove: " + error.message, "error"); return; }
  await refreshSubjectStudents(subj.id);
});
document.getElementById("subject-students-close")?.addEventListener("click", closeSubjectStudentsDrawer);
document.getElementById("subject-students-filter")?.addEventListener("input", renderSubjectStudentsList);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSubjectStudentsDrawer(); });
window.addEventListener("fp:panel", closeSubjectStudentsDrawer);

// Always visible — an admin has no way to know "select teacher" even
// exists if the whole bar only appears after checking a subject first.
// Assign/Clear just disable at 0 selected instead of the bar vanishing.
function updateSubjectAssignSelectionBar() {
  const bar        = document.getElementById("subject-assign-bulkbar");
  const countEl    = document.getElementById("subject-assign-selected-count");
  const assignBtn  = document.getElementById("subject-assign-btn");
  const clearBtn   = document.getElementById("subject-unassign-btn");
  if (!bar) return;

  bar.style.display = "flex";
  if (countEl) countEl.textContent = selectedSubjectIds.size;

  const hasSelection = selectedSubjectIds.size > 0;
  if (assignBtn) assignBtn.disabled = !hasSelection;
  if (clearBtn)  clearBtn.disabled  = !hasSelection;
}

function updateSubjectAssignSelectAllCheckbox(pageItems) {
  const selectAll = document.getElementById("subject-assign-select-all");
  if (!selectAll) return;
  selectAll.checked = pageItems.length > 0 && pageItems.every(s => selectedSubjectIds.has(s.id));
}

document.getElementById("subject-assign-department")?.addEventListener("change", async (e) => {
  subjectAssignDepartment = e.target.value;
  subjectAssignYearLevel  = "";
  saveCAFilters();
  populateYearLevelOptions();
  selectedSubjectIds.clear();
  updateSubjectAssignSelectionBar();
  document.getElementById("subject-assign-teacher").value = "";
  await loadTeachersForAssignment(subjectAssignDepartment);
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});

document.getElementById("subject-assign-yearlevel")?.addEventListener("change", (e) => {
  subjectAssignYearLevel = e.target.value;
  saveCAFilters();
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});

document.getElementById("subject-assign-select-all")?.addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll(".subject-assign-checkbox").forEach(cb => {
    cb.checked = checked;
    const id = cb.dataset.id;
    if (checked) selectedSubjectIds.add(id); else selectedSubjectIds.delete(id);
  });
  updateSubjectAssignSelectionBar();
});

document.getElementById("subject-assign-search")?.addEventListener("input", () => {
  saveCAFilters();
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});
document.getElementById("subject-assign-faculty-search")?.addEventListener("input", () => {
  saveCAFilters();
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});
document.getElementById("subject-assign-unassigned-only")?.addEventListener("change", () => {
  saveCAFilters();
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});
document.getElementById("subject-assign-semester-filter")?.addEventListener("change", () => {
  saveCAFilters();
  loadSubjectsForAssignment();
});

// ── Quality-of-life actions ──
document.getElementById("subject-assign-teacher-filter")?.addEventListener("input", () => renderTeacherOptions(true));

document.getElementById("subject-assign-select-matching")?.addEventListener("click", () => {
  currentFilteredSubjectIds.forEach(id => selectedSubjectIds.add(id));
  updateSubjectAssignSelectionBar();
  renderSubjectAssignPage();
});

document.getElementById("subject-assign-deselect")?.addEventListener("click", () => {
  selectedSubjectIds.clear();
  updateSubjectAssignSelectionBar();
  renderSubjectAssignPage();
});

// For every ticked course, also tick the same course name in the other year
// levels of the SAME program and semester (e.g. ELEC 1 under BSED-I and
// BSED-III). Deliberately NOT across programs: a course like "GE 01" exists
// in every program and ticking all of them is how one teacher ended up on
// everyone's GE 1.
document.getElementById("subject-assign-select-samecourse")?.addEventListener("click", async () => {
  if (selectedSubjectIds.size === 0) {
    await fpAlert("Tick at least one course first.", "info");
    return;
  }
  const key = (s) => `${String(s.name || "").trim().toLowerCase()}|${s.sections?.department || ""}|${s.semester_id || ""}`;
  const wanted = new Set(
    allSubjectsForAssignment.filter(s => selectedSubjectIds.has(s.id)).map(key)
  );
  let added = 0;
  allSubjectsForAssignment.forEach(s => {
    if (wanted.has(key(s)) && !selectedSubjectIds.has(s.id)) { selectedSubjectIds.add(s.id); added++; }
  });
  updateSubjectAssignSelectionBar();
  renderSubjectAssignPage();
  await fpAlert(
    added
      ? `Ticked ${added} more row(s): the same course in other year levels of the same program. ` +
        `They may be on other pages or hidden by a filter.`
      : "No other year levels have the same course in the same program.",
    added ? "success" : "info"
  );
});

document.getElementById("subject-assign-reset-filters")?.addEventListener("click", async () => {
  subjectAssignDepartment = "";
  subjectAssignYearLevel  = "";
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("subject-assign-department", "");
  set("subject-assign-search", "");
  set("subject-assign-faculty-search", "");
  set("subject-assign-teacher-filter", "");
  const un = document.getElementById("subject-assign-unassigned-only");
  if (un) un.checked = false;
  const semSel = document.getElementById("subject-assign-semester-filter");
  const activeOpt = semSel && [...semSel.options].find(o => o.textContent.includes("(active)"));
  if (semSel) semSel.value = activeOpt ? activeOpt.value : "";
  try { localStorage.removeItem(CA_FILTER_KEY); } catch {}
  selectedSubjectIds.clear();
  updateSubjectAssignSelectionBar();
  await loadTeachersForAssignment("");
  await loadSubjectsForAssignment();
});
document.getElementById("refresh-btn-subjects")?.addEventListener("click", async () => {
  await loadSubjectsForAssignment();
  await loadTeachersForAssignment(subjectAssignDepartment);
});

// Evaluations hang off the CLASS (subject), and the teacher is read from the
// class — so changing or clearing a class's teacher after students have
// already evaluated it moves those evaluations to the new teacher (or to
// nobody). Count them so the admin can see that before confirming.
async function submittedEvaluationsFor(ids) {
  try {
    const { count, error } = await supabase
      .from("evaluation_tracking").select("id", { count: "exact", head: true }).in("subject_id", ids);
    return error ? 0 : (count || 0);
  } catch { return 0; }
}
function evalWarning(n) {
  return n > 0
    ? ` WARNING: ${n} student evaluation(s) were already submitted for ${n === 1 ? "this class" : "these classes"}; ` +
      `they follow the class, so they will no longer belong to the current teacher.`
    : "";
}

async function clearTeacherFrom(ids, label) {
  const n = await submittedEvaluationsFor(ids);
  const confirmed = await fpConfirm(
    `Clear the teacher from ${label}?` + evalWarning(n),
    { confirmLabel: "Clear", confirmStyle: "fp-btn-danger" }
  );
  if (!confirmed) return false;
  const { error } = await supabase.from("subjects").update({ teacher_id: null }).in("id", ids);
  if (error) { await fpAlert("Failed: " + error.message, "error"); return false; }
  await fpAlert(`Cleared ${ids.length} course(s).`, "success");
  await loadSubjectsForAssignment();
  return true;
}

document.getElementById("subject-assign-btn")?.addEventListener("click", async () => {
  const teacherId = document.getElementById("subject-assign-teacher")?.value;
  if (!teacherId) { await fpAlert("Pick a teacher first.", "warning"); return; }
  if (selectedSubjectIds.size === 0) return;

  const teacherName = teachersForAssignment.find(t => t.id === teacherId)?.name || "this teacher";
  const ids = [...selectedSubjectIds];

  // Only classes that already have a DIFFERENT teacher are being taken over.
  const takenOver = allSubjectsForAssignment
    .filter(x => ids.includes(x.id) && x.teacher_id && x.teacher_id !== teacherId).map(x => x.id);
  const nEval = takenOver.length ? await submittedEvaluationsFor(takenOver) : 0;
  const confirmed = await fpConfirm(
    `Assign ${ids.length} course(s) to ${teacherName}?` + evalWarning(nEval),
    { confirmLabel: "Assign", confirmStyle: "fp-btn-primary" }
  );
  if (!confirmed) return;

  const btn = document.getElementById("subject-assign-btn");
  btn.textContent = "Assigning..."; btn.disabled = true;

  const { error } = await supabase.from("subjects").update({ teacher_id: teacherId }).in("id", ids);

  btn.textContent = "Assign to Selected"; btn.disabled = false;

  if (error) { await fpAlert("Failed to assign: " + error.message, "error"); return; }

  await fpAlert(`Assigned ${ids.length} course(s) to ${teacherName}.`, "success");
  await loadSubjectsForAssignment();
});

document.getElementById("subject-unassign-btn")?.addEventListener("click", async () => {
  if (selectedSubjectIds.size === 0) return;
  const ids = [...selectedSubjectIds];

  await clearTeacherFrom(ids, `${ids.length} course(s)`);
});

// ══════════════════════════════════════════════════════════════
//  BULK ASSIGN FROM FACULTY TEACHING-LOAD FILE
//
//  Matches each row of a faculty xlsx (one row per course section
//  taught, faculty identity only on that person's first row — merged
//  cells in the original, so it has to be forward-filled) against the
//  subjects already in the selected semester, then proposes — never
//  silently applies — a teacher assignment. Only rows the admin
//  reviews and confirms in the preview actually get written.
// ══════════════════════════════════════════════════════════════

const YEARLEVEL_WORD = { "FIRST YEAR": 1, "SECOND YEAR": 2, "THIRD YEAR": 3, "FOURTH YEAR": 4 };

// Accepts either the raw faculty file's wording ("FIRST YEAR") or the
// manual template's "1-A"/"1" style (leading digit, optional section
// letter the system doesn't track per-section anyway).
function extractYearLevel(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (YEARLEVEL_WORD[s] !== undefined) return YEARLEVEL_WORD[s];
  const m = s.match(/^(\d)/);
  return m ? parseInt(m[1], 10) : undefined;
}

// A code alias fixes a genuine spelling difference between the two files
// (confirmed by hand, not guessed) — distinct from normalizeCourseCode's
// mechanical spacing/hyphen/leading-zero/roman-numeral cleanup below.
const COURSE_CODE_ALIASES = { "ELEC4": "ELECTIVE4" };

// Token → degree program(s). A compound suffix like "AGRI&ARCHI" is
// split on non-alphanumerics and each piece resolved independently, so
// this table only needs single concepts, not every combination anyone
// might write. A token not in this table (e.g. "ARCHI", "INDTECH") is
// reported as unmapped rather than silently dropped — see matchFacultyRow.
const SUFFIX_TOKEN_MAP = {
  TM: ["BSTM"], HM: ["BSHM"], HTM: ["BSHM", "BSTM"],
  AGRI: ["BSA"], AUTO: ["BSIT"], ELEC: ["BSIT"], ELECT: ["BSIT"],
  INFOTECH: ["BSIT", "BSInfoTech"], TED: ["BEED", "BSED"],
  // Industrial Technology = the BSIT program (same program AUTO / ELEC already
  // point to). Confirmed against the registrar file: "GE 1 (INDTECH)" has 50
  // students and BSIT first year has 51. Without this line the row matched
  // EVERY program (an unrecognised suffix used to mean "no filter").
  INDTECH: ["BSIT"],
  CYBERSECURITY: ["BSInfoTech"], CYBERTRACK: ["BSInfoTech"],
  MULTIMEDIA: ["BSInfoTech"], TRACK: [], LEC: ["BSHM"], O: ["BSA"], N: ["BSA"],
  // Some rows in the real faculty file spell the suffix out as the literal
  // program code instead of a department-style token (e.g. "FS 1 (BEEd)",
  // "FS 2 (BSED)") — map those directly to themselves. Confirmed real
  // programs in the system (enrolled-students export): BEED, BSA, BSED,
  // BSHM, BSIT, BSInfoTech, BSTM, PEU.
  BEED: ["BEED"], BSED: ["BSED"],
};

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

function normalizeCourseCode(raw) {
  let s = raw.trim();
  // Trailing standalone roman numeral ("SSC I" -> "SSC 1") — must happen
  // before spaces are stripped, while "I"/"II"/etc is still its own word.
  s = s.replace(/\s+(I|II|III|IV|V)$/i, (_, r) => " " + ROMAN[r.toUpperCase()]);
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, "");      // drop spaces/hyphens/punctuation
  s = s.replace(/(?<=[A-Z])0+(?=\d)/, "");            // EDUC05 -> EDUC5
  return COURSE_CODE_ALIASES[s] || s;
}

function parseSuffix(rawCode) {
  const m = rawCode.trim().match(/^(.*?)\s*\(([A-Za-z0-9 &/]+)\)\s*$/);
  if (!m) return { base: rawCode.trim(), tokens: [] };
  return { base: m[1].trim(), tokens: m[2].toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean) };
}

// Parses a subject's section.name, which the student importer builds as
// `${program}-${yearLevel}-${academicYear}` (admin-users.js). academicYear
// itself contains a hyphen ("2026-2027"), so this must NOT just split on
// "-" positionally — program and yearLevel are the first two segments,
// whatever remains is the academic year.
// Roman -> Arabic, matching admin-users.js's ROMAN_YEAR_LEVELS mapping
// exactly (the one that actually builds these section names: "BSA-I-
// 2026-2027", not "BSA-1-2026-2027"). parseInt("I", 10) is NaN, so this
// was silently dropping EVERY section from the Subject Assignment match
// map — 100% of rows failed with "course code not found" regardless of
// what the roster file said, because the lookup table behind it was
// empty, not because any course code was actually wrong.
const ROMAN_TO_ARABIC_YEAR = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6 };

function parseSectionName(name) {
  const parts = (name || "").split("-");
  if (parts.length < 2) return null;
  const raw = String(parts[1]).trim().toUpperCase();
  const yl = ROMAN_TO_ARABIC_YEAR[raw] ?? parseInt(raw, 10);
  if (!Number.isFinite(yl)) return null;
  return { program: parts[0], yearLevel: yl };
}

// Reads the blank "Faculty Profile Import Template" (headers-only file
// the admin fills in by hand): one row per faculty member, with Name /
// Employment Status / Current Faculty Rank / Name of Immediate Supervisor
// then repeating "Course CodeN" / "Year Level and SectionN" column pairs —
// however many pairs actually exist in the sheet, not a fixed count (same
// "detect however many are there" approach as the student template's
// Course1..CourseN columns in admin-users.js).
async function parseManualTemplateWorkbook(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  if (rows.length === 0) return [];

  const header = rows[0].map(h => String(h || "").trim());
  const nameIdx = header.findIndex(h => h.toLowerCase() === "name");
  if (nameIdx === -1) {
    throw new Error('Expected a "Name" column — is this the Faculty Profile Import Template?');
  }

  // Optional "Email" column: when filled in, it identifies the teacher
  // (far safer than a name, which can be misspelled or shared).
  const emailIdx = header.findIndex(h => h.toLowerCase() === "email");

  // Collect Course CodeN / Year Level and SectionN / Program SuffixN sets
  // by their shared numeric suffix, not by position — so columns can be
  // reordered or extended (Course Code11, ...) without breaking this.
  const pairsByNum = new Map();
  header.forEach((h, idx) => {
    const codeMatch = h.match(/^Course Code(\d+)$/i);
    const ylMatch = h.match(/^Year Level and Section(\d+)$/i);
    const suffixMatch = h.match(/^Program Suffix(\d+)$/i);
    if (codeMatch) {
      const n = codeMatch[1];
      pairsByNum.set(n, { ...(pairsByNum.get(n) || {}), codeIdx: idx });
    } else if (ylMatch) {
      const n = ylMatch[1];
      pairsByNum.set(n, { ...(pairsByNum.get(n) || {}), ylIdx: idx });
    } else if (suffixMatch) {
      const n = suffixMatch[1];
      pairsByNum.set(n, { ...(pairsByNum.get(n) || {}), suffixIdx: idx });
    }
  });
  const pairs = [...pairsByNum.values()].filter(p => p.codeIdx !== undefined && p.ylIdx !== undefined);

  const out = [];
  for (let i = 1; i < rows.length; i++) { // skip header row
    const row = rows[i];
    const faculty = String(row[nameIdx] || "").trim();
    const email = emailIdx === -1 ? "" : String(row[emailIdx] || "").trim().toLowerCase();
    if (!faculty && !email) continue; // blank row — including the shipped example row once it's left in place with no name
    for (const { codeIdx, ylIdx, suffixIdx } of pairs) {
      let code = String(row[codeIdx] || "").trim();
      if (!code) continue; // unused set for this faculty member
      const suffix = suffixIdx !== undefined ? String(row[suffixIdx] || "").trim() : "";
      // A warning, not a silent "fix": a suffix hand-typed into the code
      // itself ("TCH 2-TM") is caught here so it can't quietly fail to
      // match later — see parseSuffix, which only understands "(TM)".
      const hyphenSuffixGuess = code.match(/^(.*\S)\s*-\s*([A-Za-z]{1,6})$/);
      if (!suffix && hyphenSuffixGuess) {
        out.push({
          faculty, email, dept: "", courseTitle: "", courseCode: code,
          yearLevelRaw: String(row[ylIdx] || "").trim(),
          templateWarning: `"${code}" looks like it has a program suffix written into the course code ` +
            `(the "-${hyphenSuffixGuess[2]}" part). That's not recognized — put the course code alone here ` +
            `and move "${hyphenSuffixGuess[2]}" into this row's Program Suffix column instead.`,
        });
        continue;
      }
      if (suffix) code = `${code} (${suffix})`; // reuse parseSuffix's existing parenthetical parsing
      out.push({
        faculty,
        email,
        dept: "",
        courseTitle: "",
        courseCode: code,
        yearLevelRaw: String(row[ylIdx] || "").trim(),
      });
    }
  }
  return out;
}

// Matches one faculty teaching-load row against the subjects already
// loaded for the selected semester (allSubjectsForAssignment). Returns
// { status: "matched", subjectIds: [...] } or { status: "unmatched", reason }.
// Never guesses past what the data actually supports — ties that can't
// be resolved come back unmatched with a reason, not a best-effort pick.
function matchFacultyRow(row, subjectsByCourse) {
  const { base, tokens } = parseSuffix(row.courseCode);
  const norm = normalizeCourseCode(base);
  const candidates = subjectsByCourse.get(norm);
  if (!candidates || candidates.length === 0) {
    return { status: "unmatched", reason: `Course code "${row.courseCode}" not found in this semester's courses.` };
  }

  const ylNum = extractYearLevel(row.yearLevelRaw);

  let suffixPrograms = null, unmappedTokens = [];
  if (tokens.length > 0) {
    const mapped = new Set();
    tokens.forEach(t => {
      const progs = SUFFIX_TOKEN_MAP[t];
      if (progs && progs.length > 0) progs.forEach(p => mapped.add(p));
      else if (!(t in SUFFIX_TOKEN_MAP)) unmappedTokens.push(t);
    });
    if (mapped.size > 0) suffixPrograms = mapped;
    // A suffix was given but NONE of it is a program we know (e.g. "ARCHI",
    // "CWTS"). Matching every program here is what made one teacher take the
    // same course in every department — so refuse and send it to review.
    if (mapped.size === 0 && unmappedTokens.length > 0) {
      return {
        status: "unmatched",
        reason: `Program Suffix "(${unmappedTokens.join(" ")})" isn't a program in the system, so this row was NOT applied ` +
                `(it would have matched every program). Fix the spelling, or assign this course by hand in Course Assignment.`,
      };
    }
  }

  let filtered = candidates.filter(c =>
    (!ylNum || c.yearLevel === ylNum) &&
    (!suffixPrograms || suffixPrograms.has(c.program))
  );

  if (filtered.length === 0) {
    const note = unmappedTokens.length > 0
      ? ` — "(${unmappedTokens.join(" ")})" isn't a program currently in the system; it may not be imported yet.`
      : "";
    return { status: "unmatched", reason: `"${row.courseCode}" exists, but not for ${row.yearLevelRaw || "an unspecified year level"} in a matching program.${note}` };
  }

  const distinctPrograms = [...new Set(filtered.map(c => c.program))];
  let warn = unmappedTokens.length > 0
    ? ` (note: "(${unmappedTokens.join(" ")})" wasn't recognized — only assigned to ${distinctPrograms.join(", ")})`
    : "";
  if (tokens.length === 0 && distinctPrograms.length > 1) {
    warn += ` No Program Suffix, so this applies to ALL ${distinctPrograms.length} programs that have it: ${distinctPrograms.join(", ")}.`;
  }
  return { status: "matched", subjectIds: filtered.map(c => c.id), programs: distinctPrograms, warn };
}

function buildSubjectsByCourse(subjects) {
  const map = new Map();
  subjects.forEach(s => {
    const parsed = parseSectionName(s.sections?.name);
    if (!parsed) return;
    const norm = normalizeCourseCode(s.name);
    if (!map.has(norm)) map.set(norm, []);
    map.get(norm).push({ id: s.id, program: parsed.program, yearLevel: parsed.yearLevel, courseName: s.name, teacherId: s.teacher_id });
  });
  return map;
}

let facultyImportResults = []; // rows with resolved teacherId + match result, for the preview/apply step

async function runFacultyImportMatch(file, parseFn = parseManualTemplateWorkbook) {
  const statusEl = document.getElementById("faculty-import-status");
  const previewEl = document.getElementById("faculty-import-preview");
  statusEl.textContent = "Loading SheetJS…";

  try {
    await window.fpLoadScript("../js/vendor/xlsx.full.min.js");
  } catch (err) {
    statusEl.textContent = "Failed to load the spreadsheet library: " + err.message;
    return;
  }

  statusEl.textContent = "Reading file…";
  let rows;
  try {
    rows = await parseFn(file);
  } catch (err) {
    statusEl.textContent = "Failed to read the file: " + err.message;
    return;
  }
  if (rows.length === 0) {
    statusEl.textContent = "That file has no data rows.";
    return;
  }

  statusEl.textContent = "Matching against this semester's courses…";

  // Always match against the CURRENT semester filter, re-loaded fresh so
  // a stale in-memory list can't cause a wrong assignment.
  await loadSubjectsForAssignment();
  const subjectsByCourse = buildSubjectsByCourse(allSubjectsForAssignment);

  const { data: teachers } = await supabase.from("users").select("id, name, email").eq("role", "teacher");
  const teacherByEmail = new Map();
  const teacherByName = new Map();   // name -> id, or null when two teachers share the name
  for (const t of teachers || []) {
    if (t.email) teacherByEmail.set(t.email.trim().toLowerCase(), t.id);
    const key = (t.name || "").trim().toLowerCase();
    if (!key) continue;
    teacherByName.set(key, teacherByName.has(key) ? null : t.id);
  }

  facultyImportResults = rows.map(row => {
    // A hyphen-suffix typo caught during parsing — never guess a match
    // off an ambiguous code, surface it as a fix-this-row item instead.
    if (row.templateWarning) {
      return { ...row, status: "unmatched", reason: row.templateWarning };
    }
    // Email (when given) is authoritative and never falls back to the
    // name — a wrong email must not silently land on a same-named person.
    let teacherId;
    if (row.email) {
      teacherId = teacherByEmail.get(row.email);
      if (!teacherId) {
        return { ...row, status: "unmatched", reason: `No teacher account found with the email "${row.email}" — check the spelling or add them first in User Management.` };
      }
    } else {
      const key = (row.faculty || "").trim().toLowerCase();
      if (teacherByName.get(key) === null) {
        return { ...row, status: "unmatched", reason: `More than one teacher is named "${row.faculty}" — add their Email in the template to tell them apart.` };
      }
      teacherId = teacherByName.get(key);
      if (!teacherId) {
        return { ...row, status: "unmatched", reason: `No teacher account found with the name "${row.faculty}" — add them first in User Management, or fill in the Email column.` };
      }
    }
    const match = matchFacultyRow(row, subjectsByCourse);
    return { ...row, teacherId, ...match };
  });

  // Two different teachers claiming the SAME course section in one file used to
  // be resolved silently (the last row simply overwrote the first). Treat that
  // as a conflict instead: neither row is applied, both go to manual review.
  {
    const claims = new Map();   // subjectId -> Map(teacherId -> teacher label)
    facultyImportResults.forEach(r => {
      if (r.status !== "matched") return;
      r.subjectIds.forEach(id => {
        if (!claims.has(id)) claims.set(id, new Map());
        claims.get(id).set(r.teacherId, r.faculty || r.email || "?");
      });
    });
    facultyImportResults = facultyImportResults.map(r => {
      if (r.status !== "matched") return r;
      const rivals = new Set();
      r.subjectIds.forEach(id => {
        const c = claims.get(id);
        if (c && c.size > 1) c.forEach((label, tid) => { if (tid !== r.teacherId) rivals.add(label); });
      });
      if (rivals.size === 0) return r;
      return {
        ...r, status: "unmatched",
        reason: `Conflict: ${[...rivals].join(", ")} also claim${rivals.size === 1 ? "s" : ""} the same course section(s) in this file, so nothing was applied for this row. ` +
                `Check the Program Suffix on both rows, or assign by hand in Course Assignment.`,
      };
    });
  }

  statusEl.textContent = "";
  renderFacultyImportPreview();
}

function renderFacultyImportPreview() {
  const previewEl = document.getElementById("faculty-import-preview");
  const matched = facultyImportResults.filter(r => r.status === "matched");
  const unmatched = facultyImportResults.filter(r => r.status === "unmatched");

  previewEl.style.display = "block";
  previewEl.innerHTML = `
    <div style="background:var(--gold-bg); border:1px solid #f1d9a6; border-radius:10px; padding:12px 14px; margin-bottom:14px;">
      <b>${matched.length}</b> row(s) matched and ready to apply · <b>${unmatched.length}</b> need manual review in the table below.
      Nothing is written to the database until you click "Apply Matched Assignments."
    </div>
    ${matched.length > 0 ? `
      <details style="margin-bottom:14px;" ${matched.some(r => r.warn) ? "open" : ""}>
        <summary style="cursor:pointer; font-size:13px; font-weight:600; margin-bottom:8px;">
          Check what will be assigned (${matched.length} row${matched.length === 1 ? "" : "s"})${matched.some(r => r.warn) ? " — some rows need a look" : ""}
        </summary>
        <table>
          <thead><tr><th>Faculty</th><th>Course</th><th>Year</th><th>Applies to</th><th>Note</th></tr></thead>
          <tbody>
            ${matched.map(r => `
              <tr>
                <td style="font-size:12px;">${escHtml(r.faculty || r.email || "")}</td>
                <td style="font-size:12px;">${escHtml(r.courseCode)}</td>
                <td style="font-size:12px;">${escHtml(r.yearLevelRaw)}</td>
                <td style="font-size:12px;">${escHtml((r.programs || []).join(", "))} · ${r.subjectIds.length} section${r.subjectIds.length === 1 ? "" : "s"}</td>
                <td style="font-size:12px; color:#92400e;">${escHtml((r.warn || "").trim())}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </details>
      <button id="faculty-import-apply-btn" style="margin-bottom:14px;">✅ Apply ${matched.length} Matched Assignment(s)</button>
    ` : ""}
    ${unmatched.length > 0 ? `
      <h4 style="font-size:13px; margin:0 0 8px;">Needs manual review (${unmatched.length})</h4>
      <table>
        <thead><tr><th>Faculty</th><th>Course</th><th>Year Level</th><th>Reason</th></tr></thead>
        <tbody>
          ${unmatched.map(r => `
            <tr>
              <td style="font-size:12px;">${escHtml(r.faculty || r.email || "")}</td>
              <td style="font-size:12px;">${escHtml(r.courseCode)}</td>
              <td style="font-size:12px;">${escHtml(r.yearLevelRaw)}</td>
              <td style="font-size:12px; color:#991b1b;">${escHtml(r.reason)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}
  `;

  document.getElementById("faculty-import-apply-btn")?.addEventListener("click", applyFacultyImportMatches);
}

async function applyFacultyImportMatches() {
  const matched = facultyImportResults.filter(r => r.status === "matched");
  if (matched.length === 0) return;

  const confirmed = await fpConfirm(
    `Apply ${matched.length} teacher assignment(s) from this file?\n\n` +
    `This updates the "teacher" field on each matched course. Courses that already have a ` +
    `different teacher assigned will be overwritten.`,
    { confirmLabel: "Apply", confirmStyle: "fp-btn-primary" }
  );
  if (!confirmed) return;

  const btn = document.getElementById("faculty-import-apply-btn");
  if (btn) { btn.textContent = "Applying..."; btn.disabled = true; }

  let applied = 0;
  const failures = [];
  for (const row of matched) {
    const { error } = await supabase.from("subjects").update({ teacher_id: row.teacherId }).in("id", row.subjectIds);
    if (error) failures.push(`${row.faculty || row.email} / ${row.courseCode}: ${error.message}`);
    else applied += row.subjectIds.length;
  }

  if (failures.length > 0) {
    await fpAlert(`Applied ${applied} course assignment(s), but ${failures.length} failed:\n\n${failures.join("\n")}`, "error");
  } else {
    await fpAlert(`Applied ${applied} course assignment(s) across ${matched.length} teaching-load row(s).`, "success");
  }

  document.getElementById("faculty-import-preview").style.display = "none";
  facultyImportResults = [];
  await loadSubjectsForAssignment();
}

document.getElementById("faculty-template-import-btn")?.addEventListener("click", () => {
  document.getElementById("faculty-template-import-file-input")?.click();
});
document.getElementById("faculty-template-import-file-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  await runFacultyImportMatch(file, parseManualTemplateWorkbook);
});

lazyPanel("panel-subjects", async () => {
  // Sequential on purpose: the remembered department has to be applied before
  // the teacher list and the course list are loaded.
  const saved = readCAFilters();
  await loadDepartmentsForAssignment();
  const deptSel = document.getElementById("subject-assign-department");
  if (typeof saved.dept === "string" && saved.dept && deptSel
      && [...deptSel.options].some(o => o.value === saved.dept)) {
    deptSel.value = saved.dept;
    subjectAssignDepartment = saved.dept;
  }
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v || "").slice(0, 100); };
  setText("subject-assign-search", saved.search);
  setText("subject-assign-faculty-search", saved.faculty);
  const un = document.getElementById("subject-assign-unassigned-only");
  if (un) un.checked = saved.unassigned === true;
  pendingCAYearLevel = typeof saved.year === "string" ? saved.year : "";
  pendingCASemester  = typeof saved.sem === "string" ? saved.sem : null;
  await loadTeachersForAssignment(subjectAssignDepartment); // "" = All Departments
  await loadSubjectsForAssignment();
});

// ══════════════════════════════════════════════════════════════
//  FACULTY TRENDS — a faculty's Overall SET Rating across every past
//  semester with data, not just the active one. Reuses
//  computeWeightedSET() unchanged (it already takes any semesterId).
// ══════════════════════════════════════════════════════════════
let trendChart = null;

// Semester labels are free text like "1st Semester 2025-2026", "Summer
// 2026-2027" — not sortable alphabetically (Summer < 1st Semester, and
// year isn't the leading token). Parse out a real sort key instead.
const TREND_TERM_ORDER = { "1st Semester": 0, "2nd Semester": 1, "Summer": 2 };
function parseSemesterSortKey(label) {
  const yearMatch = String(label || "").match(/(\d{4})-\d{4}/);
  const startYear = yearMatch ? parseInt(yearMatch[1], 10) : 0;
  let termOrder = 3; // unrecognized terms sort last within their year
  for (const [term, order] of Object.entries(TREND_TERM_ORDER)) {
    if (label.startsWith(term)) { termOrder = order; break; }
  }
  return startYear * 10 + termOrder;
}

async function loadTrendFacultyOptions() {
  const sel = document.getElementById("trend-faculty-select");
  if (!sel) return;

  // Same exclusion as Faculty Rankings: COS faculty don't appear in any
  // faculty-facing analytics view in this system.
  const { data, error } = await supabase
    .from("users")
    .select("id, name, employment_type")
    .eq("role", "teacher")
    .neq("is_active", false)
    .order("name");

  if (error) {
    sel.innerHTML = `<option value="">Failed to load faculty</option>`;
    return;
  }

  const teachers = (data || []).filter(t => t.employment_type !== "COS");
  sel.innerHTML = `<option value="">— select faculty —</option>` +
    teachers.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("");
}

async function loadFacultyTrend(teacherId, teacherName) {
  const emptyState = document.getElementById("trend-empty-state");
  const content     = document.getElementById("trend-content");
  const tbody       = document.getElementById("trend-tbody");

  if (!teacherId) {
    emptyState.style.display = "block";
    content.style.display    = "none";
    return;
  }

  emptyState.style.display = "none";
  content.style.display    = "block";
  tbody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
  document.getElementById("trend-chart-title").textContent =
    `📊 Overall SET Rating by Semester — ${teacherName}`;

  const { data: semesters, error } = await supabase
    .from("semesters")
    .select("id, label");

  if (error || !semesters || semesters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No semesters found.</td></tr>`;
    return;
  }

  semesters.sort((a, b) => parseSemesterSortKey(a.label) - parseSemesterSortKey(b.label));

  // Cap to the last 5 academic years — older history isn't dropped from
  // the database, just excluded from this view. Keeps the chart readable
  // and avoids an ever-growing chain of computeWeightedSET() calls (one
  // Supabase round trip per semester) as more semesters accumulate.
  const currentYear = new Date().getFullYear();
  const recentSemesters = semesters.filter(s => {
    const match = String(s.label || "").match(/(\d{4})-\d{4}/);
    if (!match) return true; // unparseable label — don't silently drop it
    return currentYear - parseInt(match[1], 10) <= 5;
  });

  // computeWeightedSET() already exists for the IFER report — it takes
  // any semesterId, not just the active one, so it's reused as-is here.
  // Semesters with zero respondents for this faculty return null and
  // are skipped, rather than plotted as a misleading 0.
  const points = [];
  for (const sem of recentSemesters) {
    const result = await computeWeightedSET(teacherId, sem.id);
    if (!result || result.totalRespondents === 0) continue;
    points.push({
      label:       sem.label,
      overallSET:  result.overallSET,
      avgA:        result.avgA,
      avgB:        result.avgB,
      avgC:        result.avgC,
      respondents: result.totalRespondents,
    });
  }

  if (points.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No evaluation data found for this faculty in any semester.</td></tr>`;
    renderTrendChart([]);
    return;
  }

  tbody.innerHTML = points.map((p, i) => {
    const prev = i > 0 ? points[i - 1].overallSET : null;
    let change = `<span style="color:#94a3b8;">—</span>`;
    if (prev !== null) {
      const diff = parseFloat((p.overallSET - prev).toFixed(2));
      if (diff > 0)      change = `<span style="color:#16a34a; font-weight:600;">▲ +${diff}</span>`;
      else if (diff < 0) change = `<span style="color:#dc2626; font-weight:600;">▼ ${diff}</span>`;
      else               change = `<span style="color:#64748b;">— 0.00</span>`;
    }
    return `
      <tr>
        <td><b>${escHtml(p.label)}</b></td>
        <td style="color:${getRatingColor(p.overallSET)}; font-weight:700;">${p.overallSET.toFixed(2)}</td>
        <td>${p.avgA.toFixed(2)}</td>
        <td>${p.avgB.toFixed(2)}</td>
        <td>${p.avgC.toFixed(2)}</td>
        <td>${p.respondents}</td>
        <td>${change}</td>
      </tr>`;
  }).join("");

  renderTrendChart(points);
}

function renderTrendChart(points) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("trend-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map(p => p.label),
      datasets: [{
        label: "Overall SET Rating",
        data: points.map(p => p.overallSET),
        borderColor: "#671408",
        backgroundColor: "rgba(103,20,8,0.08)",
        pointBackgroundColor: points.map(p => getRatingColor(p.overallSET)),
        pointRadius: 5,
        tension: 0.2,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(2)} — ${getRatingLabel(ctx.parsed.y)}`
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

document.getElementById("trend-faculty-select")?.addEventListener("change", (e) => {
  const sel  = e.target;
  const name = sel.options[sel.selectedIndex]?.textContent || "";
  loadFacultyTrend(sel.value, name);
});

document.getElementById("refresh-btn-trends")?.addEventListener("click", async () => {
  await loadTrendFacultyOptions();
  const sel = document.getElementById("trend-faculty-select");
  if (sel?.value) {
    const name = sel.options[sel.selectedIndex]?.textContent || "";
    await loadFacultyTrend(sel.value, name);
  }
});

lazyPanel("panel-trends", loadTrendFacultyOptions);

// ══════════════════════════════════════════════════════════════
//  SYSTEM BACKUP PANEL
//  Runs server-side (api/backup.js, service_role key) because this
//  exports the whole database — every student's scores and personal
//  info. That must never run with just the public anon key in the
//  browser. Only exists on Vercel; local dev shows a clear message
//  instead of silently doing nothing.
// ══════════════════════════════════════════════════════════════
const isLocalDevForBackup = ["127.0.0.1", "localhost"].includes(window.location.hostname);

function formatBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function backupApiCall(method, params = {}, body = null, endpoint = "/api/backup") {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not logged in via Supabase Auth — please log out and back in.");

  const qs  = new URLSearchParams(params).toString();
  const url = endpoint + (qs ? `?${qs}` : "");

  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || `Request failed (${resp.status})`);
  return result;
}

async function loadBackupList() {
  const tbody = document.getElementById("backup-list-tbody");
  if (!tbody) return;

  if (isLocalDevForBackup) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">Backups only run on the deployed (Vercel) site, not local dev.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">Loading...</td></tr>`;

  try {
    const { backups } = await backupApiCall("GET");
    if (!backups || backups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No backups yet. Click "Backup Now" above.</td></tr>`;
      return;
    }
    tbody.innerHTML = backups.map(b => `
      <tr>
        <td style="font-size:12px;">${escHtml(b.name)}</td>
        <td style="font-size:12px; white-space:nowrap;">${new Date(b.createdAt).toLocaleString("en-PH")}</td>
        <td style="font-size:12px;">${formatBytes(b.sizeBytes)}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="downloadStoredBackup('${escHtml(b.name)}')">⬇ Download</button>
          <button style="font-size:11px; padding:4px 10px; background:#dc2626;" onclick="restoreFromStoredBackup('${escHtml(b.name)}')">♻ Restore</button>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#dc2626;">Failed to load: ${escHtml(err.message)}</td></tr>`;
  }
}

async function downloadStoredBackup(name) {
  try {
    const { url } = await backupApiCall("GET", { download: name });
    window.open(url, "_blank");
  } catch (err) {
    await fpAlert("Could not get download link: " + err.message, "error");
  }
}
window.downloadStoredBackup = downloadStoredBackup;

function triggerJsonDownload(obj, fileName) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const runBackupBtn = document.getElementById("run-backup-btn");
if (runBackupBtn) {
  runBackupBtn.addEventListener("click", async () => {
    const statusEl = document.getElementById("backup-status");

    if (isLocalDevForBackup) {
      await fpAlert(
        "System Backup only runs on the deployed (Vercel) site — it needs the server-side " +
        "function and Storage bucket, neither of which exist under local dev.",
        "error"
      );
      return;
    }

    runBackupBtn.disabled = true;
    runBackupBtn.textContent = "Backing up...";
    if (statusEl) statusEl.textContent = "Fetching all tables server-side...";

    try {
      const result = await backupApiCall("POST");

      triggerJsonDownload(result.content, result.fileName);

      if (result.storageWarning) {
        if (statusEl) statusEl.textContent = "⚠️ Downloaded, but not saved to Storage.";
        await fpAlert(result.storageWarning, "error");
      } else {
        if (statusEl) statusEl.textContent = `✅ Backup complete — ${result.fileName} (${formatBytes(result.sizeBytes)})`;
      }

      loadBackupList();
    } catch (err) {
      if (statusEl) statusEl.textContent = "";
      await fpAlert("Backup failed: " + err.message, "error");
    } finally {
      runBackupBtn.disabled = false;
      runBackupBtn.textContent = "💾 Backup Now";
    }
  });
}

// ── Restore (disaster recovery) ──
// api/restore.js refuses to run unless the target database is empty, so
// the worst this can do from a misclick is a 409 error — it can't
// overwrite or duplicate live data. Still confirmed here because it's a
// whole-database write and the error message alone won't stop someone
// from clicking it reflexively.
async function runRestore(body, confirmMessage) {
  if (isLocalDevForBackup) {
    await fpAlert("Restore only runs on the deployed (Vercel) site — it needs the server-side function.", "error");
    return;
  }

  const confirmed = await fpConfirm(confirmMessage, {
    confirmLabel: "Restore",
    confirmStyle: "fp-btn-danger",
  });
  if (!confirmed) return;

  const statusEl = document.getElementById("restore-status");
  if (statusEl) statusEl.textContent = "Restoring...";

  try {
    const result = await backupApiCall("POST", {}, body, "/api/restore");
    const summary = Object.entries(result.restored)
      .map(([t, n]) => `${t}: ${n}`)
      .join(", ");
    if (statusEl) statusEl.textContent = "";
    await fpAlert(`Restore complete.\n\n${summary}`, "success");
    loadBackupList();
  } catch (err) {
    if (statusEl) statusEl.textContent = "";
    await fpAlert("Restore failed: " + err.message, "error");
  }
}

async function restoreFromStoredBackup(name) {
  await runRestore(
    { fileName: name },
    `Restore "${name}" into the database?\n\nThis only works if the database is currently empty — ` +
    `it will refuse (and change nothing) if there's already data. Use this for disaster recovery or ` +
    `setting up a fresh project, not for merging into a running system.`
  );
}
window.restoreFromStoredBackup = restoreFromStoredBackup;

const restoreUploadBtn   = document.getElementById("restore-upload-btn");
const restoreFileInput   = document.getElementById("restore-file-input");
if (restoreUploadBtn && restoreFileInput) {
  restoreUploadBtn.addEventListener("click", () => restoreFileInput.click());
  restoreFileInput.addEventListener("change", async () => {
    const file = restoreFileInput.files?.[0];
    restoreFileInput.value = "";
    if (!file) return;

    let content;
    try {
      content = JSON.parse(await file.text());
    } catch {
      await fpAlert("That file isn't valid JSON — make sure it's an unmodified backup file.", "error");
      return;
    }

    await runRestore(
      { content },
      `Restore "${file.name}" into the database?\n\nThis only works if the database is currently empty — ` +
      `it will refuse (and change nothing) if there's already data. Use this for disaster recovery or ` +
      `setting up a fresh project, not for merging into a running system.`
    );
  });
}

lazyPanel("panel-backup", loadBackupList);

// ── Init ──
// Shows the loading popup for the very first thing the admin sees —
// the default Dashboard panel's data (summary counts + rankings/charts).
// The other panels' own init calls below this (semesters, subjects,
// etc.) run independently and don't block this popup,
// since their panels aren't visible until the admin clicks their tab.
{
  const initialLoad = fpLoading("Loading dashboard...");
  Promise.all([loadSummary(), loadRankings()]).finally(() => initialLoad.close());
}