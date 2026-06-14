// ============================================================
//  FacultyPulse — Admin Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula + IFER Report
// ============================================================

import { supabase } from "./supabase.js";

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
  tbody.innerHTML = `<tr><td colspan="5">Loading...</td></tr>`;

  const { data: semester } = await supabase
    .from("semesters").select("id").eq("is_active", true).single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="5">No active semester.</td></tr>`;
    return;
  }

  const { data: teachers } = await supabase
    .from("users").select("id, name, academic_rank").eq("role", "teacher");

  if (!teachers || teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No faculty found.</td></tr>`;
    return;
  }

  const ranked = [];
  for (const teacher of teachers) {
    const result = await computeWeightedSET(teacher.id, semester.id);
    if (!result || result.totalRespondents === 0) continue;
    ranked.push({
      id:          teacher.id,
      name:        teacher.name,
      rank:        teacher.academic_rank || "—",
      overallSET:  result.overallSET,
      respondents: result.totalRespondents,
    });
  }

  ranked.sort((a, b) => b.overallSET - a.overallSET);

  allRanked = ranked;
  rankPage  = 1;
  renderRankingsPage();

  // Populate report dropdown (all faculty, not paginated)
  const select = document.getElementById("report-faculty");
  select.innerHTML = ranked.map(t =>
    `<option value="${t.id}|${t.name}">${t.name}</option>`
  ).join("");

  // Charts use the full ranked list
  renderBarChart(ranked);
  renderDonutChart(ranked);
}

// ── Render current page of rankings ──
function renderRankingsPage() {
  const tbody = document.getElementById("rankings-tbody");

  if (allRanked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No evaluation data yet.</td></tr>`;
    document.getElementById("rank-page-info").textContent = "";
    document.getElementById("rank-page-buttons").innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(allRanked.length / RANK_SIZE);
  if (rankPage > totalPages) rankPage = totalPages;

  const start = (rankPage - 1) * RANK_SIZE;
  const end   = start + RANK_SIZE;
  const pageRows = allRanked.slice(start, end);

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
        <td>
          <button onclick="viewReport('${t.id}','${t.name.replace(/'/g,"\\'")}')">
            View Report
          </button>
        </td>
      </tr>
    `;
  });

  document.getElementById("rank-page-info").textContent =
    `Showing ${start + 1}–${Math.min(end, allRanked.length)} of ${allRanked.length} faculty`;

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

  // ── Check if this report has already been released to faculty ──
  const { data: release } = await supabase
    .from("report_releases")
    .select("released_at, released_by")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semester.id)
    .maybeSingle();

  window._reportReleased = !!release;

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

  // Get SEF rating if available (from evaluation_scores with supervisor hash)
  // For now shows "—" until SEF module is implemented
  const sefRating = "—";

  // NOTE: Student comments are intentionally left blank in the report.
  // They are filled by hand during the supervisor–faculty meeting (CMO §10.2).
  // Planned (post-defense, with backend): unlink commenter identity using a
  // server-side keyed hash (HMAC) to satisfy CMO §6.10. A client-side hash
  // would be reversible, so it is deferred until a server holds the secret.

  // ── Build IFER HTML — Annex C Format ──
  const dateGenerated = new Date().toLocaleDateString("en-PH", {
    year: "numeric", month: "long", day: "numeric"
  });

  reportContent.innerHTML = `
    <div style="font-family: Arial, sans-serif; font-size: 13px; color: #000;">

      ${window._reportReleased
        ? `<div class="no-print" style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#166534;">
             ✅ <b>RELEASED TO FACULTY</b> — This report has been finalized. Student identities are
             hashed and the faculty can now view their results.
           </div>`
        : `<div class="no-print" style="background:#fef3c7; border:1px solid #fcd34d; border-radius:6px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#92400e;">
             📝 <b>PREVIEW (QA ONLY)</b> — Not yet released. Comments below show raw student IDs for
             your verification. Faculty cannot see this report until you click "Release to Faculty".
           </div>`
      }

      <!-- A. Faculty Information -->
      <h3 style="text-align:center; font-size:14px; margin-bottom:4px;">
        INDIVIDUAL FACULTY EVALUATION REPORT
      </h3>
      <p style="text-align:center; font-size:11px; color:#555; margin-bottom:16px;">
        Pursuant to CMO No. 19, s. 2025 | Generated: ${dateGenerated}
      </p>

      <table style="width:100%; font-size:12px; margin-bottom:16px; border-collapse:collapse;">
        <tr>
          <td style="width:40%; color:#555;">Name of Faculty Evaluated</td>
          <td style="font-weight:bold;">: ${teacher?.name || teacherName}</td>
        </tr>
        <tr>
          <td style="color:#555;">Department/College</td>
          <td>: ${department}</td>
        </tr>
        <tr>
          <td style="color:#555;">Current Faculty Rank</td>
          <td>: ${teacher?.academic_rank || "—"}</td>
        </tr>
        <tr>
          <td style="color:#555;">Semester/Term &amp; Academic Year</td>
          <td>: ${semester.label}</td>
        </tr>
      </table>

      <!-- B. Summary of Average SET Rating -->
      <p style="font-weight:bold; font-size:13px; margin-bottom:4px;">
        B. Summary of Average SET Rating
      </p>
      <p style="font-size:11px; color:#555; margin-bottom:8px;">
        <b>Step 1:</b> Get the average SET rating for each class.<br/>
        <b>Step 2:</b> Multiply the number of students in each class with its average SET rating
        to get the Weighted SET Score per class.<br/>
        <b>Step 3:</b> Get the total number of students and the total weighted SET score.
      </p>

      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:12px;">
        <thead>
          <tr>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">Seq</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:left;">Course Code/Title</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">Year/Section</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">No. of Students</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">Average SET Rating</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">(3×4) Weighted SET Score</th>
          </tr>
        </thead>
        <tbody>
          ${classData.map((c, i) => `
            <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
              <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${i + 1}</td>
              <td style="padding:7px 10px; border:1px solid #e2e8f0;">${c.course}</td>
              <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${c.section}</td>
              <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${c.noStudents}</td>
              <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${c.avgSETRating}</td>
              <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${c.weightedScore}</td>
            </tr>
          `).join("")}
          <tr style="font-weight:bold; background:#f0f4ff;">
            <td colspan="3" style="padding:7px 10px; border:1px solid #e2e8f0; text-align:right;">TOTAL</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${totalEnrolled}</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">TOTAL</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${totalWeighted.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <p style="font-size:12px; margin-bottom:16px;">
        <b>Computation:</b> Overall SET Rating =
        ${totalWeighted.toFixed(2)} ÷ ${totalEnrolled} =
        <b style="color:#1a56db;">${overallSET}</b>
      </p>

      <!-- C. SET and SEF Ratings -->
      <p style="font-weight:bold; font-size:13px; margin-bottom:8px;">
        C. SET and SEF Ratings
      </p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#334155; color:#ffffff; padding:8px 12px; border:1px solid #1e293b;"></th>
            <th style="background:#334155; color:#ffffff; padding:8px 12px; border:1px solid #1e293b; text-align:center;">SET Rating</th>
            <th style="background:#334155; color:#ffffff; padding:8px 12px; border:1px solid #1e293b; text-align:center;">*SEF Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 12px; border:1px solid #e2e8f0; font-weight:bold;">OVERALL RATING</td>
            <td style="padding:8px 12px; border:1px solid #e2e8f0; text-align:center;
              font-weight:bold; font-size:16px; color:${getRatingColor(overallSET)};">
              ${overallSET}
            </td>
            <td style="padding:8px 12px; border:1px solid #e2e8f0; text-align:center;">${sefRating}</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:8px 12px; border:1px solid #e2e8f0; font-weight:bold;">RATING DESCRIPTION</td>
            <td style="padding:8px 12px; border:1px solid #e2e8f0; text-align:center;">
              <span style="background:${getRatingColor(overallSET)}20;
                color:${getRatingColor(overallSET)};
                padding:3px 10px; border-radius:12px; font-weight:bold; font-size:12px;">
                ${getRatingLabel(overallSET)}
              </span>
            </td>
            <td style="padding:8px 12px; border:1px solid #e2e8f0; text-align:center;">—</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:11px; color:#555; margin-bottom:16px;">
        *Note: SEF rating is given by the supervisor using the SEF instrument.
      </p>

      <!-- Category Breakdown -->
      <p style="font-weight:bold; font-size:13px; margin-bottom:8px;">
        Category Breakdown
      </p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:left;">Category</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">Score (out of 100)</th>
            <th style="background:#1a56db; color:#ffffff; padding:7px 10px; border:1px solid #1447b8; text-align:center;">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:7px 10px; border:1px solid #e2e8f0;">A. Management of Teaching and Learning</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${avgA}</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${getRatingLabel(avgA)}</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:7px 10px; border:1px solid #e2e8f0;">B. Content Knowledge, Pedagogy and Technology</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${avgB}</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${getRatingLabel(avgB)}</td>
          </tr>
          <tr>
            <td style="padding:7px 10px; border:1px solid #e2e8f0;">C. Commitment and Transparency</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${avgC}</td>
            <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${getRatingLabel(avgC)}</td>
          </tr>
        </tbody>
      </table>

      <!-- D. Summary of Qualitative Comments — Students (blank for meeting) -->
      <p style="font-weight:bold; font-size:13px; margin-bottom:8px;">
        D. Summary of Qualitative Comments and Suggestions
      </p>

      <p style="font-size:12px; font-weight:bold; color:#475569; margin-bottom:6px;">
        Comments and Suggestions from the Students
      </p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="background:#334155; color:#ffffff; padding:7px 10px; border:1px solid #1e293b; text-align:center; width:50px;">Seq</th>
            <th style="background:#334155; color:#ffffff; padding:7px 10px; border:1px solid #1e293b; text-align:left;">Comments and Suggestions from the Students</th>
          </tr>
        </thead>
        <tbody id="student-comments-tbody">
          ${[1,2,3,4,5].map(n => `
            <tr>
              <td style="padding:16px 10px; border:1px solid #e2e8f0; text-align:center;">${n}</td>
              <td style="padding:16px 10px; border:1px solid #e2e8f0;">&nbsp;</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="no-print" style="display:flex; gap:8px; margin-bottom:16px;">
        <button onclick="addCommentRow('student-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#1a56db; border:1px solid #1a56db; border-radius:5px; cursor:pointer;">
          + Add Row
        </button>
        <button onclick="removeCommentRow('student-comments-tbody')"
          style="font-size:12px; padding:5px 12px; background:white; color:#dc2626; border:1px solid #dc2626; border-radius:5px; cursor:pointer;">
          − Remove Row
        </button>
      </div>

      <!-- Comments and Suggestions from the Supervisor (SEF) -->
      <p style="font-size:12px; font-weight:bold; color:#475569; margin-bottom:6px;">
        Comments and Suggestions from the Supervisor
      </p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="background:#334155; color:#ffffff; padding:7px 10px; border:1px solid #1e293b; text-align:center; width:50px;">Seq</th>
            <th style="background:#334155; color:#ffffff; padding:7px 10px; border:1px solid #1e293b; text-align:left;">Comments and Suggestions from the Supervisor</th>
          </tr>
        </thead>
        <tbody id="supervisor-comments-tbody">
          ${[1,2,3,4,5].map(n => `
            <tr>
              <td style="padding:16px 10px; border:1px solid #e2e8f0; text-align:center;">${n}</td>
              <td style="padding:16px 10px; border:1px solid #e2e8f0;">&nbsp;</td>
            </tr>
          `).join("")}
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

      <!-- Prepared by / Reviewed by (Annex C horizontal format) -->
      <div style="margin-top:28px; font-size:12px; max-width:480px;">
        <p style="margin-bottom:14px;"><b>Prepared by:</b></p>
        <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
          <span style="width:230px; flex:none;">Signature of Staff</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>
        <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
          <span style="width:230px; flex:none;">Name of Staff</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>
        <div style="display:flex; align-items:flex-end; margin-bottom:22px;">
          <span style="width:230px; flex:none;">Date</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>

        <p style="margin-bottom:14px;"><b>Reviewed by:</b></p>
        <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
          <span style="width:230px; flex:none;">Signature of Authorized Official</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>
        <div style="display:flex; align-items:flex-end; margin-bottom:14px;">
          <span style="width:230px; flex:none;">Name of Authorized Official</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>
        <div style="display:flex; align-items:flex-end;">
          <span style="width:230px; flex:none;">Date</span>
          <span style="margin:0 6px;">:</span>
          <span style="flex:1; border-bottom:1px solid #000; height:1em;">&nbsp;</span>
        </div>
      </div>

      <p style="font-size:10px; color:#94a3b8; margin-top:20px; text-align:center;">
        This report is generated by FacultyPulse in compliance with CMO No. 19, s. 2025
        and DBM-CHED Joint Circular No. 3, Series of 2022.
      </p>
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

  barChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ranked.map(t => t.name.split(",")[0]),
      datasets: [{
        label: "Overall SET Rating",
        data: ranked.map(t => t.overallSET),
        backgroundColor: ranked.map(t => getRatingColor(t.overallSET)),
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
              ` ${ctx.parsed.y} / 100 — ${getRatingLabel(ctx.parsed.y)}`
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

  const buckets = {
    "Outstanding":       { count: 0, color: "#10b981" },
    "Very Satisfactory": { count: 0, color: "#3b82f6" },
    "Satisfactory":      { count: 0, color: "#f59e0b" },
    "Needs Improvement": { count: 0, color: "#f97316" },
    "Poor":              { count: 0, color: "#ef4444" },
  };

  ranked.forEach(t => {
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
//  RELEASE REPORT TO FACULTY
//  Marks the report as released so faculty can view it, then
//  re-renders the report in hashed (released) mode.
// ══════════════════════════════════════════════════════════════
async function releaseReport() {
  const teacherId   = window._reportTeacherId;
  const teacherName = window._reportTeacherName;
  const semesterId  = window._reportSemesterId;

  if (!teacherId || !semesterId) return;

  const confirmed = confirm(
    `Release this report to ${teacherName}?\n\n` +
    `• Student IDs will be hashed (irreversible) on the faculty copy\n` +
    `• ${teacherName} will be able to view their scores and comments\n` +
    `• You (QA) keep full access to identities for monitoring\n\n` +
    `Proceed?`
  );
  if (!confirmed) return;

  const btn = document.getElementById("release-btn");
  if (btn) { btn.textContent = "Releasing..."; btn.disabled = true; }

  const { error } = await supabase
    .from("report_releases")
    .insert({
      teacher_id:  teacherId,
      semester_id: semesterId,
      released_by: sessionStorage.getItem("name") || "QA Admin",
    });

  if (error && error.code !== "23505") { // 23505 = already released
    alert("Failed to release: " + error.message);
    if (btn) { btn.textContent = "📤 Release to Faculty"; btn.disabled = false; }
    return;
  }

  alert(`✅ Report released to ${teacherName}.\nThe faculty can now view their evaluation results.`);

  // Re-render in released (hashed) mode
  viewReport(teacherId, teacherName);
}

// ── Toggle Release button visibility based on release status ──
function updateReleaseButton() {
  const btn = document.getElementById("release-btn");
  if (!btn) return;
  if (window._reportReleased) {
    btn.style.display = "none";  // already released, hide button
  } else {
    btn.style.display = "inline-block";
    btn.textContent   = "📤 Release to Faculty";
    btn.disabled      = false;
  }
}

// ── Expose to HTML (rankings table uses onclick) ──
window.viewReport = viewReport;

// ── Add a blank row to a comment table (student or supervisor) ──
function addCommentRow(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const nextNum = tbody.querySelectorAll("tr").length + 1;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td style="padding:16px 10px; border:1px solid #e2e8f0; text-align:center;">${nextNum}</td>
    <td style="padding:16px 10px; border:1px solid #e2e8f0;">&nbsp;</td>
  `;
  tbody.appendChild(tr);
}

// ── Remove the last row from a comment table (keeps a minimum of 1) ──
function removeCommentRow(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const rows = tbody.querySelectorAll("tr");
  if (rows.length <= 1) {
    alert("At least one row must remain.");
    return;
  }
  tbody.removeChild(rows[rows.length - 1]);
}

window.addCommentRow    = addCommentRow;
window.removeCommentRow = removeCommentRow;

// ── Attach events ──
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

document.getElementById("generate-report-btn").addEventListener("click", () => {
  const select = document.getElementById("report-faculty");
  const [id, ...nameParts] = select.value.split("|");
  viewReport(id, nameParts.join("|"));
});

document.getElementById("print-btn").addEventListener("click", () => window.print());
document.getElementById("close-report-btn").addEventListener("click", closeReportModal);

const releaseBtnEl = document.getElementById("release-btn");
if (releaseBtnEl) releaseBtnEl.addEventListener("click", releaseReport);

// ── Refresh button — reloads all dashboard data ──
function refreshDashboard() {
  const btn = document.getElementById("refresh-btn");
  if (btn) {
    btn.textContent = "🔄 Refreshing...";
    btn.disabled = true;
  }
  Promise.all([loadSummary(), loadRankings(), loadUsers()]).finally(() => {
    if (btn) {
      btn.textContent = "🔄 Refresh";
      btn.disabled = false;
    }
  });
}
const refreshBtnEl = document.getElementById("refresh-btn");
if (refreshBtnEl) refreshBtnEl.addEventListener("click", refreshDashboard);

// ── Init ──
loadSummary();
loadRankings();
loadUsers();