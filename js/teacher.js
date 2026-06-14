// ============================================================
//  FacultyPulse — Teacher Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula (Annex C)
//
//  Step 1: Per student → Rating = (Total Score / 75) × 100
//  Step 2: Per class   → Weighted Score = No. of Students × Avg SET Rating
//  Step 3: Overall SET → Total Weighted Score / Total No. of Students
// ============================================================

import { supabase } from "./supabase.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "teacher") {
  window.location.href = "../index.html";
}

const userId = sessionStorage.getItem("userId");
const name   = sessionStorage.getItem("name");

document.getElementById("welcome-name").textContent = name;
document.getElementById("nav-user").textContent     = "Logged in as: " + name;

// ── Chart instances ──
let barChart   = null;
let donutChart = null;

// ══════════════════════════════════════════════════════════════
//  RATING BRACKETS (result is out of 100)
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

// ── Load all semesters + build dropdown ──
async function loadSemester() {
  const { data: semesters } = await supabase
    .from("semesters")
    .select("id, label, is_active")
    .order("created_at", { ascending: false }); // newest first

  if (!semesters || semesters.length === 0) {
    document.getElementById("semester-select").innerHTML =
      `<option disabled>No semesters found</option>`;
    showNotReleased();
    return;
  }

  // Build dropdown — active semester at top, rest below
  const activeSemester = semesters.find(s => s.is_active);
  const select = document.getElementById("semester-select");

  select.innerHTML = semesters.map(s =>
    `<option value="${s.id}" ${s.is_active ? "selected" : ""}>
      ${s.label}${s.is_active ? " (Current)" : ""}
    </option>`
  ).join("");

  // Show/hide the CURRENT badge
  const badge = document.getElementById("active-badge");
  if (activeSemester) badge.style.display = "inline-block";

  // Load data for the default selected semester
  const defaultId = activeSemester?.id || semesters[0].id;
  await loadForSemester(defaultId, !!activeSemester && semesters[0].id === defaultId);

  // Switch semesters on dropdown change
  select.addEventListener("change", async () => {
    const selectedId       = select.value;
    const selectedIsActive = semesters.find(s => s.id === selectedId)?.is_active || false;

    // Update CURRENT badge visibility
    badge.style.display = selectedIsActive ? "inline-block" : "none";

    // Update subjects heading label
    const selectedLabel = semesters.find(s => s.id === selectedId)?.label || "";
    document.getElementById("subjects-semester-label").textContent = selectedLabel;

    await loadForSemester(selectedId, selectedIsActive);
  });
}

// ── Load scores + subjects for a given semester ──
async function loadForSemester(semesterId, isActive) {
  // Update subjects heading for initial load
  const sel = document.getElementById("semester-select");
  const selectedLabel = sel.options[sel.selectedIndex]?.text
    .replace(" (Current)", "").trim() || "";
  document.getElementById("subjects-semester-label").textContent = selectedLabel;

  // Reset cards to loading state
  document.getElementById("score-overall").textContent = "—";
  document.getElementById("score-overall").style.color = "";
  document.getElementById("score-label").textContent   = "";
  document.getElementById("eval-count").textContent    = "—";
  document.getElementById("score-catA").textContent    = "—";
  document.getElementById("score-catB").textContent    = "—";
  document.getElementById("score-catC").textContent    = "—";

  // ── GATE: faculty can only see results AFTER QA releases the report ──
  const { data: release } = await supabase
    .from("report_releases")
    .select("released_at")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId)
    .maybeSingle();

  if (!release) {
    showNotReleased(isActive);
    return;
  }

  hideNotReleased();
  await loadScores(semesterId);
  await loadSubjects(semesterId);
}

// ── Show "results not yet available" gate ──
function showNotReleased(isCurrentSemester = true) {
  const container = document.querySelector(".container");
  if (!container) return;

  const sections = container.querySelectorAll(".cards-row, .charts-row, .section");
  sections.forEach(s => s.style.display = "none");

  // Remove any existing notice first
  const existing = document.getElementById("not-released-notice");
  if (existing) existing.remove();

  const notice = document.createElement("div");
  notice.id        = "not-released-notice";
  notice.className = "section";
  notice.style.cssText = "text-align:center; padding:48px 24px;";
  notice.innerHTML = isCurrentSemester ? `
    <div style="font-size:42px; margin-bottom:12px;">🕐</div>
    <h3 style="margin-bottom:8px; color:#1e293b;">Evaluation Results Not Yet Available</h3>
    <p style="color:#64748b; font-size:14px; max-width:440px; margin:0 auto; line-height:1.6;">
      Your evaluation results for this semester have not yet been released by the
      Quality Assurance Office. You will be able to view your scores, charts, and
      feedback once the QA Office finalizes and releases your report.
    </p>
  ` : `
    <div style="font-size:42px; margin-bottom:12px;">📭</div>
    <h3 style="margin-bottom:8px; color:#1e293b;">No Report for This Semester</h3>
    <p style="color:#64748b; font-size:14px; max-width:440px; margin:0 auto; line-height:1.6;">
      No evaluation report was released for this semester. This may mean evaluations
      were not conducted, or the report has not been released by QA.
    </p>
  `;
  container.appendChild(notice);
}

// ── Hide the not-released notice and show data sections ──
function hideNotReleased() {
  const existing = document.getElementById("not-released-notice");
  if (existing) existing.remove();

  const container = document.querySelector(".container");
  if (!container) return;
  const sections = container.querySelectorAll(".cards-row, .charts-row, .section");
  sections.forEach(s => s.style.display = "");
}

// ══════════════════════════════════════════════════════════════
//  WEIGHTED SET COMPUTATION — CMO No. 19 Annex C
//
//  For each subject (class):
//    1. Per student: rating = (sum of 15 answers / 75) × 100
//    2. Average SET rating for the class = sum of all ratings / no. of respondents
//    3. Weighted score = enrolled_count × average SET rating
//
//  Overall SET = Total Weighted Score / Total Enrolled Students
// ══════════════════════════════════════════════════════════════
async function loadScores(semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) {
    showNoData();
    return;
  }

  // Build per-class data for the weighted computation
  const classData    = [];
  let totalWeighted  = 0;
  let totalEnrolled  = 0;
  let totalRespondents = 0;

  // Category score accumulators (for bar/donut charts)
  const catTotals = { A: 0, B: 0, C: 0 };
  const catCounts = { A: 0, B: 0, C: 0 };

  for (const subject of subjects) {
    // Get all evaluation scores for this subject (no identity in this table)
    const { data: evals } = await supabase
      .from("evaluation_scores")
      .select("scores")
      .eq("subject_id", subject.id)
      .eq("semester_id", semesterId);

    if (!evals || evals.length === 0) {
      classData.push({
        course:       subject.name,
        section:      subject.sections?.name || "—",
        noStudents:   subject.enrolled_count || 0,
        avgSETRating: 0,
        weightedScore: 0,
        respondents:  0,
      });
      continue;
    }

    // Step 1: Compute rating per student then average per class
    let sumRatings = 0;
    evals.forEach(e => {
      const totalScore = Object.values(e.scores).reduce((s, v) => s + v, 0);
      const rating     = (totalScore / 75) * 100;
      sumRatings      += rating;

      // Accumulate category scores for charts
      // Category A: q1–q6 (6 questions, max 30)
      const catA = ["q1","q2","q3","q4","q5","q6"]
        .reduce((s,k) => s + (e.scores[k] || 0), 0);
      // Category B: q7–q11 (5 questions, max 25)
      const catB = ["q7","q8","q9","q10","q11"]
        .reduce((s,k) => s + (e.scores[k] || 0), 0);
      // Category C: q12–q15 (4 questions, max 20)
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
    const enrolled      = subject.enrolled_count || respondents;
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

  // Step 3: Overall SET Rating
  const overallSET = totalEnrolled > 0
    ? parseFloat((totalWeighted / totalEnrolled).toFixed(2))
    : 0;

  // Category averages
  const avgA = catCounts.A > 0 ? parseFloat((catTotals.A / catCounts.A).toFixed(2)) : 0;
  const avgB = catCounts.B > 0 ? parseFloat((catTotals.B / catCounts.B).toFixed(2)) : 0;
  const avgC = catCounts.C > 0 ? parseFloat((catTotals.C / catCounts.C).toFixed(2)) : 0;

  // ── Update summary cards ──
  document.getElementById("score-overall").textContent  = overallSET + " / 100";
  document.getElementById("score-overall").style.color  = getRatingColor(overallSET);
  document.getElementById("score-label").textContent    = getRatingLabel(overallSET);
  document.getElementById("eval-count").textContent     = totalRespondents;
  document.getElementById("score-catA").textContent     = avgA + " / 100";
  document.getElementById("score-catB").textContent     = avgB + " / 100";
  document.getElementById("score-catC").textContent     = avgC + " / 100";

  // ── Render weighted SET table ──
  renderClassTable(classData, totalEnrolled, totalWeighted, overallSET);

  // ── Render charts ──
  renderCharts(avgA, avgB, avgC, overallSET);
}

// ── Render per-class weighted table (Annex C format) ──
function renderClassTable(classData, totalEnrolled, totalWeighted, overallSET) {
  const tbody = document.getElementById("class-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  classData.forEach((c, i) => {
    tbody.innerHTML += `
      <tr>
        <td>${i + 1}</td>
        <td>${c.course}</td>
        <td>${c.section}</td>
        <td style="text-align:center;">${c.noStudents}</td>
        <td style="text-align:center;">${c.avgSETRating}</td>
        <td style="text-align:center;">${c.weightedScore}</td>
      </tr>
    `;
  });

  // Totals row
  tbody.innerHTML += `
    <tr style="font-weight:bold; background:#f0f4ff;">
      <td colspan="3" style="text-align:right;">TOTAL</td>
      <td style="text-align:center;">${totalEnrolled}</td>
      <td style="text-align:center;">—</td>
      <td style="text-align:center;">${totalWeighted.toFixed(2)}</td>
    </tr>
    <tr style="background:#dbeafe;">
      <td colspan="4" style="text-align:right; font-weight:bold;">
        Overall SET Rating = ${totalWeighted.toFixed(2)} ÷ ${totalEnrolled}
      </td>
      <td colspan="2" style="text-align:center; font-weight:bold; font-size:15px; color:#1a56db;">
        ${overallSET} / 100
      </td>
    </tr>
  `;
}

// ── Show no data state ──
function showNoData() {
  document.getElementById("score-overall").textContent = "—";
  document.getElementById("eval-count").textContent    = "0";
  document.getElementById("score-catA").textContent    = "—";
  document.getElementById("score-catB").textContent    = "—";
  document.getElementById("score-catC").textContent    = "—";
}

// ── Render Bar + Donut charts ──
function renderCharts(avgA, avgB, avgC, overall) {
  const categories = [
    "A. Management of\nTeaching & Learning",
    "B. Content Knowledge,\nPedagogy & Technology",
    "C. Commitment &\nTransparency",
  ];
  const scores = [avgA, avgB, avgC];
  const colors = ["#3b82f6", "#10b981", "#f59e0b"];

  // ── Bar Chart ──
  const barCtx = document.getElementById("bar-chart").getContext("2d");
  if (barChart) barChart.destroy();

  barChart = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: ["Mgmt of Teaching", "Content Knowledge", "Commitment"],
      datasets: [{
        label: "Category Score (out of 100)",
        data: scores,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
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
            label: ctx => ` Score: ${ctx.parsed.y} / 100 — ${getRatingLabel(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
          grid: { color: "#f0f0f0" }
        },
        x: { ticks: { font: { size: 11 } } }
      }
    }
  });

  // ── Donut Chart ──
  const donutCtx = document.getElementById("donut-chart").getContext("2d");
  if (donutChart) donutChart.destroy();

  donutChart = new Chart(donutCtx, {
    type: "doughnut",
    data: {
      labels: ["Mgmt of Teaching", "Content Knowledge", "Commitment"],
      datasets: [{
        data: scores,
        backgroundColor: colors,
        borderColor: "#fff",
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11 }, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} / 100`
          }
        }
      }
    }
  });
}

// ── Load subjects handled ──
async function loadSubjects(semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("name, enrolled_count, sections(name)")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId);

  const tbody = document.getElementById("subjects-tbody");
  if (!subjects || subjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No subjects found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  subjects.forEach(s => {
    tbody.innerHTML += `
      <tr>
        <td>${s.name}</td>
        <td>${s.sections?.name || "—"}</td>
        <td>${s.enrolled_count || "—"}</td>
      </tr>
    `;
  });
}

// ── Attach events ──
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// ── Init ──
loadSemester();