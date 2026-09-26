// ============================================================
//  FacultyPulse — Admin Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula + IFER Report
// ============================================================

import { supabase } from "./supabase.js";
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
  window.location.href = "../index.html";
}

document.getElementById("nav-user").textContent = "Logged in as: " + sessionStorage.getItem("name");

let barChart   = null;
let donutChart = null;

// ══════════════════════════════════════════════════════════════
//  RATING HELPERS
// ══════════════════════════════════════════════════════════════
function getRatingLabel(score) {
  if (score >= 90) return "Outstanding";
  if (score >= 75) return "Very Satisfactory";
  if (score >= 60) return "Satisfactory";
  if (score >= 45) return "Needs Improvement";
  return "Poor";
}

function getReportStageBadge(stage) {
  const map = {
    pending:                 { label: "Pending Review",      bg: "#fef3c7", color: "#92400e" },
    forwarded_to_supervisor: { label: "Awaiting Supervisor", bg: "#dbeafe", color: "#1e40af" },
    supervisor_done:         { label: "Supervisor Done",     bg: "#d1fae5", color: "#065f46" },
    released:                { label: "Released",            bg: "#ede9fe", color: "#5b21b6" },
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

  const catTotals = { A: 0, B: 0, C: 0 };
  const catCounts = { A: 0, B: 0, C: 0 };

  for (const subject of subjects) {
    const { data: evals } = await supabase
      .from("evaluation_scores")
      .select("scores")
      .eq("subject_id", subject.id)
      .eq("semester_id", semesterId);

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
//  FACULTY RANKINGS — with pagination
// ══════════════════════════════════════════════════════════════
let allRanked    = [];
let rankPage     = 1;
const RANK_SIZE  = 8;

const EMPLOYMENT_GROUP_ORDER = { "Full-time": 0, "Part-time": 1 };
let rankGroupByEmployment = true;

async function loadRankings() {
  const tbody = document.getElementById("rankings-tbody");
  tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;

  const { data: semester } = await supabase
    .from("semesters").select("id").eq("is_active", true).maybeSingle();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="4">No active semester.</td></tr>`;
    return;
  }

  const { data: allTeachers } = await supabase
    .from("users").select("id, name, academic_rank, employment_type").eq("role", "teacher");

  const teachers = (allTeachers || []).filter(t => t.employment_type !== "COS");

  if (!teachers || teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No faculty found.</td></tr>`;
    return;
  }

  const { data: allSubjects } = await supabase
    .from("subjects")
    .select("id, name, teacher_id, enrolled_count, sections(name, department)")
    .eq("semester_id", semester.id);

  const { data: allEvals } = await supabase
    .from("evaluation_scores")
    .select("subject_id, scores")
    .eq("semester_id", semester.id);

  const { data: allReleases } = await supabase
    .from("report_releases")
    .select("teacher_id, stage")
    .eq("semester_id", semester.id);

  const releaseStageByTeacher = {};
  (allReleases || []).forEach(r => {
    releaseStageByTeacher[r.teacher_id] = r.stage;
  });

  const evalsBySubject = {};
  (allEvals || []).forEach(e => {
    if (!evalsBySubject[e.subject_id]) evalsBySubject[e.subject_id] = [];
    evalsBySubject[e.subject_id].push(e);
  });

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
      id:             teacher.id,
      name:           teacher.name,
      rank:           teacher.academic_rank || "—",
      overallSET,
      respondents:    totalRespondents,
      program,
      employmentType: teacher.employment_type || "—",
      stage:          releaseStageByTeacher[teacher.id] || "pending",
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

  populateReportFacultySelect(ranked);

  renderBarChart(ranked);
  renderDonutChart(ranked);
}

function renderRankingsPage() {
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

  renderBarChart(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No evaluation data ${progFilter ? "for this program" : "yet"}.</td></tr>`;
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
            <td colspan="4" style="padding:6px 8px; background:#f1f5f9; text-align:center;
              font-size:10px; font-weight:700; color:#64748b; letter-spacing:.03em;">
              ${escHtml(t.employmentType)}
            </td>
          </tr>
        `;
      } else if (prevGroup === null) {
        tbody.innerHTML += `
          <tr>
            <td colspan="4" style="padding:6px 8px; background:#f1f5f9; text-align:center;
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

  const { data: release } = await supabase
    .from("report_releases")
    .select("released_at, released_by, stage")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .maybeSingle();

  window._reportStage    = release?.stage || "pending";
  window._reportReleased = release?.stage === "released";

  const { data: teacher } = await supabase
    .from("users")
    .select("name, academic_rank, email")
    .eq("id", teacherId)
    .single();

  const { data: deptSubject } = await supabase
    .from("subjects")
    .select("sections(department)")
    .eq("teacher_id", teacherId)
    .limit(1)
    .maybeSingle();

  const department = deptSubject?.sections?.department || "—";

  const result = await computeWeightedSET(teacherId, semester.id);

  if (!result) {
    reportContent.innerHTML = `<p>No evaluation data found for this faculty.</p>`;
    return;
  }

  const { overallSET, classData, totalEnrolled, totalWeighted,
          avgA, avgB, avgC } = result;

  const { data: supRemarks } = await supabase
    .from("supervisor_remarks")
    .select("sef_score, comments, remarks")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sefRating      = supRemarks?.sef_score != null
    ? Number(supRemarks.sef_score).toFixed(2)
    : "—";
  const supComments    = supRemarks?.comments || "";
  const supRemarksTxt  = supRemarks?.remarks  || "";

  const { data: fedaf } = await supabase
    .from("fedaf")
    .select("areas_improvement, proposed_activities, action_plan, supervisor_signed")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .maybeSingle();

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

  const rawScoresBySubject = {};
  for (const c of classData) {
    const { data: rawEvals } = await supabase
      .from("evaluation_scores")
      .select("scores, submitted_at")
      .eq("subject_id", c.subjectId)
      .eq("semester_id", semester.id)
      .order("submitted_at", { ascending: true });
    rawScoresBySubject[c.subjectId] = rawEvals || [];
  }

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
            out of ${c.noStudents} enrolled
            | Avg SET: <b>${c.avgSETRating.toFixed(2)}</b>
            | Weighted: <b>${c.weightedScore.toFixed(2)}</b>
          </p>`;

      if (evals.length === 0) {
        html += `<p style="font-size:11px; color:#94a3b8; margin:0 0 14px; padding-left:8px;">No submissions yet.</p>`;
        continue;
      }

      html += `
          <div style="overflow-x:auto; margin-bottom:16px;">
            <table style="border-collapse:collapse; font-size:11px; min-width:100%;">
              <thead>
                <tr>
                  <th style="border:1px solid #cbd5e1; padding:6px 8px; background:#f8fafc;
                    text-align:left; min-width:260px; color:#334155;">Question</th>`;
      evals.forEach((_, i) => {
        html += `<th style="border:1px solid #cbd5e1; padding:6px 8px; background:#f8fafc;
          text-align:center; color:#334155; min-width:40px;">R${i + 1}</th>`;
      });
      html += `
                  <th style="border:1px solid #cbd5e1; padding:6px 8px; background:#eff6ff;
                    text-align:center; color:#1e40af; min-width:52px;">Avg</th>
                </tr>
              </thead>
              <tbody>`;

      ["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10","q11","q12","q13","q14","q15"]
        .forEach((qid, qi) => {
          if (qi === 0)
            html += `<tr><td colspan="${evals.length + 2}"
              style="background:#f1f5f9; padding:5px 8px; font-size:10px;
                font-weight:600; color:#475569; border:1px solid #cbd5e1;">
              A. Management of Teaching and Learning</td></tr>`;
          if (qi === 6)
            html += `<tr><td colspan="${evals.length + 2}"
              style="background:#f1f5f9; padding:5px 8px; font-size:10px;
                font-weight:600; color:#475569; border:1px solid #cbd5e1;">
              B. Content Knowledge, Pedagogy and Technology</td></tr>`;
          if (qi === 11)
            html += `<tr><td colspan="${evals.length + 2}"
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
            </td>`;
          vals.forEach(v => {
            html += `<td style="border:1px solid #cbd5e1; padding:5px 8px;
              text-align:center; color:#1e293b;">${v}</td>`;
          });
          html += `<td style="border:1px solid #cbd5e1; padding:5px 8px;
            text-align:center; font-weight:600; color:#1e40af; background:#eff6ff;">${avg}</td>
          </tr>`;
        });

      html += `<tr style="background:#f8fafc;">
        <td style="border:1px solid #cbd5e1; padding:6px 8px; font-weight:700; color:#1e293b;">
          Total Score (raw / 75)
        </td>`;
      evals.forEach(e => {
        const total = Object.values(e.scores || {}).reduce((s,v) => s+v, 0);
        html += `<td style="border:1px solid #cbd5e1; padding:6px 8px;
          text-align:center; font-weight:700; color:#1e293b;">${total}</td>`;
      });
      html += `<td style="border:1px solid #cbd5e1; padding:6px 8px;
        text-align:center; color:#64748b;">—</td></tr>`;

      html += `<tr style="background:#eff6ff;">
        <td style="border:1px solid #cbd5e1; padding:6px 8px; font-weight:700; color:#1e40af;">
          Computed SET Rating
        </td>`;
      evals.forEach(e => {
        const total = Object.values(e.scores || {}).reduce((s,v) => s+v, 0);
        const rating = ((total / 75) * 100).toFixed(2);
        html += `<td style="border:1px solid #cbd5e1; padding:6px 8px;
          text-align:center; font-weight:700; color:#1e40af;">${rating}</td>`;
      });
      html += `<td style="border:1px solid #cbd5e1; padding:6px 8px;
        text-align:center; font-weight:700; color:#1e40af;">${c.avgSETRating.toFixed(2)}</td></tr>`;

      html += `</tbody></table></div>`;
    }

    html += `
          <div style="border-top:2px solid #e2e8f0; margin-top:4px; padding-top:16px;">
            <p style="font-weight:700; font-size:13px; color:#1e293b; margin:0 0 12px;">
              Supervisor's Evaluation of Faculty (SEF) — Summary
            </p>`;

    if (supRemarks) {
      html += `
            <table style="border-collapse:collapse; font-size:12px; width:100%; max-width:420px; margin-bottom:12px;">
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155;">Overall SEF Rating</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; text-align:center;
                  font-weight:700; font-size:15px; color:#1e40af;">${sefRating}</td>
              </tr>
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155; vertical-align:top;">Supervisor Comments</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; color:#334155;
                  font-size:11px; line-height:1.6;">
                  ${supRemarks.comments ? escHtml(supRemarks.comments) : "<em style='color:#94a3b8;'>No comments submitted.</em>"}
                </td>
              </tr>
              <tr>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc;
                  font-weight:600; color:#334155; vertical-align:top;">Supervisor Remarks</td>
                <td style="border:1px solid #cbd5e1; padding:8px 12px; color:#334155;
                  font-size:11px; line-height:1.6;">
                  ${supRemarks.remarks ? escHtml(supRemarks.remarks) : "<em style='color:#94a3b8;'>No remarks submitted.</em>"}
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
        if (s === 'forwarded_to_supervisor')
          return `<div class="no-print" style="background:#faf5ff; border:1px solid #c4b5fd; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#6d28d9;">
            ⏳ <b>AWAITING SUPERVISOR REVIEW</b> — Forwarded to supervisor. Waiting for their remarks.
          </div>`;
        return `<div class="no-print" style="background:#fef3c7; border:1px solid #fcd34d; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#92400e;">
          📝 <b>PREVIEW (QA ONLY)</b> — Not yet forwarded. Faculty cannot see this report yet.
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
            <th style="background:#fff; color:#000; padding:8px 10px; border:1px solid #000; text-align:center; font-weight:bold;">*SEF Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px; border:1px solid #000; font-weight:bold; color:#000;">OVERALL RATING</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px; color:#000;">${overallSET.toFixed(2)}</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; color:#000;">${sefRating}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:10px; color:#000; margin-bottom:16px; font-style:italic;">
        *Note: rating given by the supervisor using the SEF instrument
      </p>

      <!-- Category Breakdown -->
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
function renderBarChart(ranked) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("bar-chart").getContext("2d");
  if (barChart) barChart.destroy();

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
              ` ${ctx.parsed.y.toFixed(2)} — ${getRatingLabel(ctx.parsed.y)}${tooltipSuffix[ctx.dataIndex] || ""}`
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
  if (typeof Chart === "undefined") return;
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

  btn.textContent      = "📤 Forward to Supervisor";
  btn.style.background = "#475569";
  btn.onclick          = forwardToSupervisor;
}

function goToMonitoringFiltered(teacherId, teacherName) {
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));

  if (typeof switchPanel === "function") {
    switchPanel("panel-monitoring");
  }

  let attempts = 0;
  const apply = setInterval(() => {
    const input = document.getElementById("filter-faculty");
    if (input) {
      input.value = teacherName;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clearInterval(apply);
      sessionStorage.removeItem("mon_filter_faculty");
    }
    if (++attempts > 20) clearInterval(apply);
  }, 100);
}

async function forwardToSupervisor() {
  const teacherId   = window._reportTeacherId;
  const teacherName = window._reportTeacherName;
  const semesterId  = window._reportSemesterId;
  if (!teacherId || !semesterId) return;

  // Supervisor assignment is now by DEPARTMENT match (exactly one
  // supervisor per department — the program chair), not the old
  // users.supervisor_id link, which nothing in the admin UI ever
  // actually set. Look up this teacher's own department, then find
  // whichever active supervisor shares it.
  const { data: teacherRow } = await supabase
    .from("users")
    .select("department")
    .eq("id", teacherId)
    .maybeSingle();

  let supervisorName = "No supervisor assigned to this department yet";
  if (teacherRow?.department) {
    const { data: supRow } = await supabase
      .from("users")
      .select("name")
      .eq("role", "supervisor")
      .eq("department", teacherRow.department)
      .eq("is_active", true)
      .maybeSingle();
    if (supRow?.name) supervisorName = supRow.name;
  } else {
    supervisorName = "This faculty member has no department set — assign one in User Management first";
  }

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

document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
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
    pagebreak:   { mode: ["css", "legacy"] },
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

const rankGroupToggleEl = document.getElementById("rank-group-toggle");
if (rankGroupToggleEl) {
  rankGroupByEmployment = rankGroupToggleEl.checked;
  rankGroupToggleEl.addEventListener("change", () => {
    rankGroupByEmployment = rankGroupToggleEl.checked;
    rankPage = 1;
    renderRankingsPage();
  });
}

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
    tbody.innerHTML = `<tr><td colspan="5">Error loading history: ${error.message}</td></tr>`;
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

const historyRefreshBtn = document.getElementById("refresh-btn-history");
if (historyRefreshBtn) historyRefreshBtn.addEventListener("click", loadPrintHistory);

const historySearchEl = document.getElementById("history-search");
if (historySearchEl) historySearchEl.addEventListener("input", () => { historyPage = 1; renderHistoryTable(); });

const historySemFilterEl = document.getElementById("history-semester-filter");
if (historySemFilterEl) historySemFilterEl.addEventListener("change", () => { historyPage = 1; renderHistoryTable(); });

lazyPanel("panel-history", loadPrintHistory);

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
    .select("id, student_id, current_email, requested_email, reason, status, review_note, created_at, reviewed_at, student:student_id(name, student_id, email)")
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
        <button onclick="openRejectEmailModal('${r.id}')"
          style="font-size:11px; padding:4px 10px; background:#dc2626;">❌ Reject</button>
      </div>` : "—";

    return `<tr>
      <td><b>${escHtml(name)}</b><br/><span style="font-size:11px; color:#64748b;">${escHtml(studentNo)}</span></td>
      <td style="font-size:12px;">${escHtml(r.current_email || r.student?.email || "—")}</td>
      <td style="font-size:12px; font-weight:bold;">${escHtml(r.requested_email)}</td>
      <td style="font-size:12px; max-width:200px;">${escHtml(r.reason)}</td>
      <td style="font-size:12px; white-space:nowrap;">${date}</td>
      <td>
        ${statusBadge}
        ${r.status === "rejected" && r.review_note
          ? `<div style="font-size:11px; color:#991b1b; margin-top:4px; max-width:160px;">${escHtml(r.review_note)}</div>`
          : ""}
      </td>
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

  const { error: updateError } = await supabase
    .from("users")
    .update({ email: req.requested_email })
    .eq("id", studentUuid);

  if (updateError) {
    if (updateError.code === "23505") {
      await fpAlert(
        `Can't approve — "${req.requested_email}" is already in use by a different account.\n\n` +
        `This request is still pending. Either reject it and ask the student to resubmit with ` +
        `a different email, or first check whether that email belongs to a duplicate/incorrect account.`,
        "error"
      );
    } else {
      await fpAlert("Failed to update email: " + updateError.message, "error");
    }
    return;
  }

  const { error: reqError } = await supabase
    .from("email_change_requests")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (reqError) { await fpAlert("Email updated but failed to mark request approved.", "error"); return; }

  await fpAlert("Email change approved and updated successfully.", "success");
  loadEmailRequests();
}

let rejectEmailTargetId = null;

function openRejectEmailModal(requestId) {
  rejectEmailTargetId = requestId;
  document.getElementById("reject-email-reason").value = "";
  document.getElementById("reject-email-error").textContent = "";
  document.getElementById("reject-email-modal").classList.remove("hidden");
}

async function confirmRejectEmailRequest() {
  const reasonEl = document.getElementById("reject-email-reason");
  const errorEl  = document.getElementById("reject-email-error");
  const reason   = reasonEl.value.trim();

  if (!reason || reason.length < 10) {
    errorEl.textContent = "Please provide a reason (at least 10 characters) — the student will see this.";
    return;
  }
  if (!rejectEmailTargetId) return;

  const btn = document.getElementById("confirm-reject-email-btn");
  btn.textContent = "Rejecting...";
  btn.disabled = true;

  const { error } = await supabase
    .from("email_change_requests")
    .update({ status: "rejected", review_note: reason, reviewed_at: new Date().toISOString() })
    .eq("id", rejectEmailTargetId);

  btn.textContent = "Reject";
  btn.disabled = false;

  if (error) {
    errorEl.textContent = "Failed to reject: " + error.message;
    return;
  }

  document.getElementById("reject-email-modal").classList.add("hidden");
  rejectEmailTargetId = null;
  await fpAlert("Request rejected.", "success");
  loadEmailRequests();
}

document.getElementById("confirm-reject-email-btn")?.addEventListener("click", confirmRejectEmailRequest);
document.getElementById("cancel-reject-email-btn")?.addEventListener("click", () => {
  document.getElementById("reject-email-modal").classList.add("hidden");
  rejectEmailTargetId = null;
});

window.approveEmailRequest = approveEmailRequest;
window.openRejectEmailModal = openRejectEmailModal;

document.getElementById("refresh-email-req-btn")?.addEventListener("click", loadEmailRequests);
document.getElementById("email-req-filter")?.addEventListener("change", loadEmailRequests);

loadEmailRequests();

// ══════════════════════════════════════════════════════════════
//  SYNC ENROLLED COUNTS
// ══════════════════════════════════════════════════════════════
const syncEnrolledBtn = document.getElementById("sync-enrolled-btn");
if (syncEnrolledBtn) {
  syncEnrolledBtn.addEventListener("click", async () => {
    const confirmed = await fpConfirm(
      "Sync enrolled counts?\n\nThis will update the enrolled student count for all subjects based on the actual number of active students in each section.\n\nRun this before generating IFERs to ensure accurate numbers."
    );
    if (!confirmed) return;

    syncEnrolledBtn.textContent = "Syncing...";
    syncEnrolledBtn.disabled = true;

    const { data, error } = await supabase.rpc("sync_enrolled_counts");

    syncEnrolledBtn.textContent = "Sync Enrolled";
    syncEnrolledBtn.disabled = false;

    if (error) {
      await fpAlert("Sync failed: " + error.message, "error");
      return;
    }

    await fpAlert(
      `Enrolled counts synced.\n${data.updated} subject(s) updated.\n\nYou can now generate IFERs with accurate student counts.`,
      "success"
    );
    loadRankings();
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
    `• Students will only be able to submit evaluations for subjects in this semester\n\n` +
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
}

async function loadDepartmentsForAssignment() {
  const sel = document.getElementById("subject-assign-department");
  if (!sel) return;
  const { data, error } = await supabase.from("sections").select("department");
  if (error) { console.error("Failed to load departments:", error); return; }
  const depts = [...new Set((data || []).map(r => r.department).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">All Departments</option>` +
    depts.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join("");
}

async function loadTeachersForAssignment(department) {
  const sel = document.getElementById("subject-assign-teacher");
  if (!sel) return;

  // "All Departments" now loads every active teacher, not a disabled
  // placeholder — assigning across departments in one batch is a valid
  // (if less common) workflow, so the teacher list should support it.
  let query = supabase
    .from("users")
    .select("id, name")
    .eq("role", "teacher")
    .neq("is_active", false)
    .order("name");
  if (department) query = query.eq("department", department);

  const { data } = await query;
  teachersForAssignment = data || [];
  sel.disabled = false;
  sel.innerHTML = teachersForAssignment.length
    ? `<option value="">— select teacher —</option>` +
      teachersForAssignment.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("")
    : `<option value="">No teachers found${department ? " in this department" : ""}</option>`;
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
  }

  let query = supabase
    .from("subjects")
    .select("id, name, enrolled_count, teacher_id, section_id, semester_id, sections(name, department), teacher:users(name)");

  const semFilter = semSel?.value || "";
  if (semFilter) query = query.eq("semester_id", semFilter);

  const { data, error } = await query;
  if (error) {
    const tbody = document.getElementById("subjects-assign-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">Error loading subjects: ${escHtml(error.message)}</td></tr>`;
    return;
  }

  allSubjectsForAssignment = data || [];
  populateYearLevelOptions();
  subjectAssignPage = 1;
  selectedSubjectIds.clear();
  updateSubjectAssignSelectionBar();
  renderSubjectAssignPage();
}

function renderSubjectAssignPage() {
  const tbody = document.getElementById("subjects-assign-tbody");
  if (!tbody) return;

  document.getElementById("subject-assign-select-all").disabled = false;

  const search             = (document.getElementById("subject-assign-search")?.value || "").toLowerCase();
  const showUnassignedOnly = document.getElementById("subject-assign-unassigned-only")?.checked;

  let filtered = allSubjectsForAssignment.filter(s => {
    const matchDept        = !subjectAssignDepartment || s.sections?.department === subjectAssignDepartment;
    const matchYearLevel   = !subjectAssignYearLevel
      || extractYearLevelFromSection(s.sections?.name) === subjectAssignYearLevel;
    const matchSearch      = !search
      || s.name.toLowerCase().includes(search)
      || (s.sections?.name || "").toLowerCase().includes(search);
    const matchUnassigned  = !showUnassignedOnly || !s.teacher_id;
    return matchDept && matchYearLevel && matchSearch && matchUnassigned;
  });

  filtered.sort((a, b) =>
    a.name.localeCompare(b.name) || (a.sections?.name || "").localeCompare(b.sections?.name || "")
  );

  const deptSubjects    = subjectAssignDepartment
    ? allSubjectsForAssignment.filter(s => s.sections?.department === subjectAssignDepartment)
    : allSubjectsForAssignment;
  const totalUnassigned = deptSubjects.filter(s => !s.teacher_id).length;
  const deptLabel  = subjectAssignDepartment || "All Departments";
  const scopeLabel = subjectAssignYearLevel
    ? `${deptLabel} — Year ${subjectAssignYearLevel}`
    : deptLabel;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No subjects match in ${escHtml(scopeLabel)}.</td></tr>`;
    document.getElementById("subject-assign-count").textContent =
      `No subjects found in ${scopeLabel}. (${totalUnassigned} unassigned in ${deptLabel})`;
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
      <td><b>${escHtml(s.name)}</b></td>
      <td>${escHtml(s.sections?.name || "—")}</td>
      <td style="text-align:center;">${s.enrolled_count ?? 0}</td>
      <td>${s.teacher?.name ? escHtml(s.teacher.name) : `<span style="color:#d97706; font-weight:600;">Unassigned</span>`}</td>
    </tr>
  `).join("");

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
      if (e.target.matches(".subject-assign-checkbox")) return;
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
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});
document.getElementById("subject-assign-unassigned-only")?.addEventListener("change", () => {
  subjectAssignPage = 1;
  renderSubjectAssignPage();
});
document.getElementById("subject-assign-semester-filter")?.addEventListener("change", loadSubjectsForAssignment);
document.getElementById("refresh-btn-subjects")?.addEventListener("click", async () => {
  await loadSubjectsForAssignment();
  await loadTeachersForAssignment(subjectAssignDepartment);
});

document.getElementById("subject-assign-btn")?.addEventListener("click", async () => {
  const teacherId = document.getElementById("subject-assign-teacher")?.value;
  if (!teacherId) { await fpAlert("Pick a teacher first.", "warning"); return; }
  if (selectedSubjectIds.size === 0) return;

  const teacherName = teachersForAssignment.find(t => t.id === teacherId)?.name || "this teacher";
  const ids = [...selectedSubjectIds];

  const confirmed = await fpConfirm(
    `Assign ${ids.length} subject(s) to ${teacherName}?`,
    { confirmLabel: "Assign", confirmStyle: "fp-btn-primary" }
  );
  if (!confirmed) return;

  const btn = document.getElementById("subject-assign-btn");
  btn.textContent = "Assigning..."; btn.disabled = true;

  const { error } = await supabase.from("subjects").update({ teacher_id: teacherId }).in("id", ids);

  btn.textContent = "Assign to Selected"; btn.disabled = false;

  if (error) { await fpAlert("Failed to assign: " + error.message, "error"); return; }

  await fpAlert(`Assigned ${ids.length} subject(s) to ${teacherName}.`, "success");
  await loadSubjectsForAssignment();
});

document.getElementById("subject-unassign-btn")?.addEventListener("click", async () => {
  if (selectedSubjectIds.size === 0) return;
  const ids = [...selectedSubjectIds];

  const confirmed = await fpConfirm(
    `Clear the teacher assignment from ${ids.length} subject(s)?`,
    { confirmLabel: "Clear", confirmStyle: "fp-btn-danger" }
  );
  if (!confirmed) return;

  const { error } = await supabase.from("subjects").update({ teacher_id: null }).in("id", ids);
  if (error) { await fpAlert("Failed: " + error.message, "error"); return; }

  await fpAlert(`Cleared ${ids.length} subject(s).`, "success");
  await loadSubjectsForAssignment();
});

lazyPanel("panel-subjects", () => {
  loadDepartmentsForAssignment();
  loadTeachersForAssignment(""); // "" = All Departments
  loadSubjectsForAssignment();
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

// ── Init ──
// Shows the loading popup for the very first thing the admin sees —
// the default Dashboard panel's data (summary counts + rankings/charts).
// The other panels' own init calls below this (semesters, subjects,
// email requests, etc.) run independently and don't block this popup,
// since their panels aren't visible until the admin clicks their tab.
{
  const initialLoad = fpLoading("Loading dashboard...");
  Promise.all([loadSummary(), loadRankings()]).finally(() => initialLoad.close());
}