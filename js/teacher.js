// ============================================================
//  FacultyPulse — Teacher Dashboard
//  CMO No. 19, s. 2025 — Weighted SET Formula (Annex C)
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

let donutChart = null;

// ══════════════════════════════════════════════════════════════
//  HELPERS
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
//  INIT
// ══════════════════════════════════════════════════════════════
async function loadSemester() {
  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).single();

  if (!semester) {
    document.getElementById("semester-label").textContent = "No active semester";
    showNotReleased();
    return;
  }

  document.getElementById("semester-label").textContent = semester.label;

  // Gate: only show after final release
  const { data: release } = await supabase
    .from("report_releases")
    .select("stage")
    .eq("teacher_id", userId)
    .eq("semester_id", semester.id)
    .maybeSingle();

  if (!release || release.stage !== "released") {
    showNotReleased();
    return;
  }

  // Show dashboard
  document.getElementById("dashboard-view").style.display = "block";

  await loadScores(semester.id);
  await loadSubjects(semester.id);
  await loadSupervisorRemarks(semester.id);
}

// ══════════════════════════════════════════════════════════════
//  NOT RELEASED STATE
// ══════════════════════════════════════════════════════════════
function showNotReleased() {
  document.getElementById("not-released-view").style.display = "block";
  document.getElementById("dashboard-view").style.display    = "none";
}

// ══════════════════════════════════════════════════════════════
//  LOAD SCORES — Weighted SET computation (Annex C)
// ══════════════════════════════════════════════════════════════
async function loadScores(semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) return;

  const classData = [];
  let totalWeighted = 0, totalEnrolled = 0, totalRespondents = 0;
  const catTotals = { A:0, B:0, C:0 };
  const catCounts = { A:0, B:0, C:0 };

  // Per-question accumulation for recommendations
  const qTotals = {};
  const qCounts = {};
  for (let i = 1; i <= 15; i++) { qTotals[`q${i}`] = 0; qCounts[`q${i}`] = 0; }

  for (const subject of subjects) {
    const { data: evals } = await supabase
      .from("evaluation_scores")
      .select("scores")
      .eq("subject_id", subject.id)
      .eq("semester_id", semesterId);

    if (!evals || evals.length === 0) {
      classData.push({
        course: subject.name, section: subject.sections?.name || "—",
        noStudents: subject.enrolled_count || 0,
        avgSETRating: 0, weightedScore: 0, respondents: 0,
      });
      continue;
    }

    let sumRatings = 0;
    evals.forEach(e => {
      const total = Object.values(e.scores).reduce((s,v) => s+v, 0);
      sumRatings += (total / 75) * 100;
      const catA = ["q1","q2","q3","q4","q5","q6"].reduce((s,k) => s+(e.scores[k]||0), 0);
      const catB = ["q7","q8","q9","q10","q11"].reduce((s,k) => s+(e.scores[k]||0), 0);
      const catC = ["q12","q13","q14","q15"].reduce((s,k) => s+(e.scores[k]||0), 0);
      catTotals.A += (catA/30)*100; catCounts.A++;
      catTotals.B += (catB/25)*100; catCounts.B++;
      catTotals.C += (catC/20)*100; catCounts.C++;

      // Tally per-question scores (scale 1–5)
      for (let i = 1; i <= 15; i++) {
        const k = `q${i}`;
        qTotals[k] += (e.scores[k] || 0);
        qCounts[k]++;
      }
    });

    const respondents    = evals.length;
    const avgSETRating   = parseFloat((sumRatings / respondents).toFixed(2));
    const enrolled       = subject.enrolled_count || respondents;
    const weightedScore  = parseFloat((enrolled * avgSETRating).toFixed(2));

    classData.push({
      course: subject.name, section: subject.sections?.name || "—",
      noStudents: enrolled, avgSETRating, weightedScore, respondents,
    });

    totalWeighted    += weightedScore;
    totalEnrolled    += enrolled;
    totalRespondents += respondents;
  }

  const overallSET = totalEnrolled > 0
    ? parseFloat((totalWeighted / totalEnrolled).toFixed(2)) : 0;

  const avgA = catCounts.A > 0 ? parseFloat((catTotals.A/catCounts.A).toFixed(2)) : 0;
  const avgB = catCounts.B > 0 ? parseFloat((catTotals.B/catCounts.B).toFixed(2)) : 0;
  const avgC = catCounts.C > 0 ? parseFloat((catTotals.C/catCounts.C).toFixed(2)) : 0;

  // ── Hero ──
  document.getElementById("score-overall").textContent = overallSET;
  document.getElementById("score-label").textContent   = getRatingLabel(overallSET);
  document.getElementById("eval-count").textContent    = totalRespondents;

  // ── Category cards with progress bars ──
  const cats = { A: avgA, B: avgB, C: avgC };
  const colors = { A: "#3b82f6", B: "#10b981", C: "#f59e0b" };
  Object.entries(cats).forEach(([cat, val]) => {
    const scoreEl = document.getElementById(`score-cat${cat}`);
    const barEl   = document.getElementById(`bar-cat${cat}`);
    if (scoreEl) scoreEl.textContent = val + " / 100";
    if (barEl)   { barEl.style.width = val + "%"; barEl.style.background = colors[cat]; }
  });

  // ── Weighted table ──
  renderClassTable(classData, totalEnrolled, totalWeighted, overallSET);

  // ── Charts ──
  renderCharts(avgA, avgB, avgC);

  // ── Preset Recommendations ──
  const qAvgs = {};
  for (let i = 1; i <= 15; i++) {
    const k = `q${i}`;
    qAvgs[k] = qCounts[k] > 0 ? parseFloat((qTotals[k] / qCounts[k]).toFixed(2)) : 0;
  }
  renderRecommendations(avgA, avgB, avgC, qAvgs);
}

// ── Weighted table ──
function renderClassTable(classData, totalEnrolled, totalWeighted, overallSET) {
  const tbody = document.getElementById("class-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  classData.forEach((c, i) => {
    tbody.innerHTML += `
      <tr>
        <td>${i+1}</td>
        <td>${c.course}</td>
        <td>${c.section}</td>
        <td>${c.noStudents}</td>
        <td>${c.avgSETRating}</td>
        <td>${c.weightedScore}</td>
      </tr>`;
  });

  tbody.innerHTML += `
    <tr style="font-weight:bold; background:#f0f4ff;">
      <td colspan="3" style="text-align:right; padding:8px 10px;">TOTAL</td>
      <td>${totalEnrolled}</td>
      <td>—</td>
      <td>${totalWeighted.toFixed(2)}</td>
    </tr>
    <tr style="background:#dbeafe;">
      <td colspan="4" style="text-align:right; font-weight:bold; padding:8px 10px;">
        Overall SET = ${totalWeighted.toFixed(2)} ÷ ${totalEnrolled}
      </td>
      <td colspan="2" style="text-align:center; font-weight:bold; color:#1a56db; font-size:14px;">
        ${overallSET} / 100
      </td>
    </tr>`;
}

// ── Charts ──
function renderCharts(avgA, avgB, avgC) {
  const scores = [avgA, avgB, avgC];
  const colors = ["#3b82f6", "#10b981", "#f59e0b"];
  const labels = ["Mgmt of Teaching", "Content Knowledge", "Commitment"];

  const donutCtx = document.getElementById("donut-chart")?.getContext("2d");
  if (donutCtx) {
    if (donutChart) donutChart.destroy();
    donutChart = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: scores, backgroundColor: colors, borderColor:"#fff", borderWidth:3, hoverOffset:8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout:"65%",
        plugins: {
          legend: { position:"bottom", labels:{ font:{ size:11 }, padding:10 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} / 100` } }
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  PRESET RECOMMENDATIONS — based on category + question scores
//  Phase 1: rule-based presets (AI-generated in Phase 2)
// ══════════════════════════════════════════════════════════════

// Rating bands (out of 5)
// > 4.5  Excellent   > 4.0  Very Good   > 3.5  Good   > 2.5  Fair   ≤ 2.5  Needs Improvement
const THRESHOLD_WARN = 3.5; // below this triggers a recommendation
const THRESHOLD_CRIT = 2.5; // below this triggers a stronger warning

// Question metadata: short label + preset recommendation
const Q_PRESETS = {
  q1:  {
    short: "Punctuality",
    rec:   "Students noted attendance and punctuality concerns. Consider reviewing your schedule adherence and communicating any schedule changes proactively to students."
  },
  q2:  {
    short: "Clarity of expectations",
    rec:   "Students felt learning outcomes, grading criteria, or course requirements were not communicated clearly. Distributing a detailed course syllabus at the start of the semester and revisiting it regularly can address this."
  },
  q3:  {
    short: "Time management",
    rec:   "Allocated class time may not be used as effectively as students expect. Structured lesson plans and avoiding over-running or cutting sessions short can improve this score."
  },
  q4:  {
    short: "Critical thinking activities",
    rec:   "Students indicated limited opportunities for critical and creative thinking. Incorporating case studies, problem-solving tasks, or open-ended discussions into lessons can help."
  },
  q5:  {
    short: "Student autonomy",
    rec:   "Students felt they were not sufficiently guided toward independent learning. Try assigning reflective tasks, self-directed projects, or peer-to-peer learning activities."
  },
  q6:  {
    short: "Constructive feedback",
    rec:   "Students reported a need for more timely and constructive feedback on their academic progress. Regular verbal or written feedback tied to learning outcomes is recommended."
  },
  q7:  {
    short: "Subject knowledge",
    rec:   "Students perceived gaps in the depth or breadth of subject knowledge presented. Staying updated with the latest developments in your discipline and referencing current literature may help."
  },
  q8:  {
    short: "Simplifying complex ideas",
    rec:   "Students found it difficult to follow complex concepts as presented. Using analogies, visual aids, step-by-step explanations, or real-world examples can improve clarity."
  },
  q9:  {
    short: "Relevance to current issues",
    rec:   "Students noted the subject matter rarely connected to contemporary issues or daily life. Integrating recent news, case studies, or current events relevant to your discipline can increase engagement."
  },
  q10: {
    short: "Active learning & ICT",
    rec:   "Students felt active engagement and use of technology in instruction was limited. Exploring LMS tools, interactive platforms, or collaborative digital activities can enhance engagement."
  },
  q11: {
    short: "Assessment alignment",
    rec:   "Students found that assessments were not always clearly aligned with what was taught. Reviewing your assessment design against your course learning outcomes and communicating rubrics in advance is advisable."
  },
  q12: {
    short: "Valuing diversity",
    rec:   "Students indicated that individual differences and diversity in the classroom may not be fully recognized. Adapting instruction to varied learning styles and being mindful of diverse student backgrounds can help."
  },
  q13: {
    short: "Consultation support",
    rec:   "Students reported difficulty accessing support during consultation hours. Ensuring consistent availability during your scheduled consultation periods and communicating these hours clearly to students is recommended."
  },
  q14: {
    short: "Feedback on outputs",
    rec:   "Students noted delays or gaps in receiving feedback on submitted work. Setting a clear turnaround policy for graded outputs and returning work promptly with comments can improve this."
  },
  q15: {
    short: "Transparent grading",
    rec:   "Students felt grading criteria were not always transparent or clearly communicated. Using and sharing detailed rubrics before assessment activities can address this concern."
  },
};

const CAT_NAMES = {
  A: "A. Management of Teaching and Learning",
  B: "B. Content Knowledge, Pedagogy and Technology",
  C: "C. Commitment and Transparency",
};

const CAT_QUESTIONS = {
  A: ["q1","q2","q3","q4","q5","q6"],
  B: ["q7","q8","q9","q10","q11"],
  C: ["q12","q13","q14","q15"],
};

function getRatingBand(score100) {
  if (score100 > 90) return { label: "Excellent",          color: "#16a34a" };
  if (score100 > 80) return { label: "Very Good",          color: "#2563eb" };
  if (score100 > 70) return { label: "Good",               color: "#0891b2" };
  if (score100 > 50) return { label: "Fair",               color: "#d97706" };
                     return { label: "Needs Improvement",  color: "#dc2626" };
}

function renderRecommendations(avgA, avgB, avgC, qAvgs) {
  const card = document.getElementById("rec-card");
  const body = document.getElementById("rec-body");
  if (!card || !body) return;

  // Per-category analysis: find weakest question within each category
  const catScores = { A: avgA, B: avgB, C: avgC };
  const recs = [];

  for (const [cat, catScore] of Object.entries(catScores)) {
    // Find the single weakest question in this category
    let weakestQ = null, weakestScore = Infinity;
    for (const qId of CAT_QUESTIONS[cat]) {
      const avg5 = qAvgs[qId]; // score out of 5
      if (avg5 < weakestScore) { weakestScore = avg5; weakestQ = qId; }
    }

    const weakest100 = parseFloat(((weakestScore / 5) * 100).toFixed(1));
    const cat100     = catScore;

    // Only surface a recommendation if the CATEGORY score is below threshold.
    // The weakest question is shown as diagnostic context, not an independent trigger.
    const catThreshold100  = THRESHOLD_WARN * 20; // 3.5 × 20 = 70
    const critThreshold100 = THRESHOLD_CRIT * 20; // 2.5 × 20 = 50
    const watchThreshold100 = 60; // weakest question below this triggers a soft watch note

    if (cat100 <= catThreshold100) {
      // Full recommendation — category itself is weak
      const isCrit = cat100 <= critThreshold100;
      recs.push({ cat, catScore: cat100, weakestQ, weakestScore: weakest100, isCrit, tier: "warn" });
    } else if (weakest100 < watchThreshold100) {
      // Soft watch area — category is healthy but one question is notably low
      recs.push({ cat, catScore: cat100, weakestQ, weakestScore: weakest100, isCrit: false, tier: "watch" });
    }
  }

  if (recs.length === 0) {
    // All categories above threshold — positive reinforcement
    body.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start;">
        <span style="font-size:20px; flex-shrink:0;">🌟</span>
        <div>
          <p style="font-size:13px; font-weight:bold; color:#16a34a; margin-bottom:4px;">
            Strong performance across all categories.
          </p>
          <p style="font-size:12px; color:#64748b; line-height:1.6;">
            Your students rated you above the threshold in all three categories. 
            Keep up the excellent work and continue seeking feedback from your students each semester.
          </p>
        </div>
      </div>`;
    card.style.display = "block";
    return;
  }

  // Sort: warn items first (by severity), then watch items (by weakest question score)
  recs.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "warn" ? -1 : 1;
    if (a.tier === "warn") return (b.isCrit - a.isCrit) || (a.catScore - b.catScore);
    return a.weakestScore - b.weakestScore;
  });

  let html = "";
  recs.forEach(({ cat, catScore, weakestQ, weakestScore, isCrit, tier }) => {
    const preset  = Q_PRESETS[weakestQ];
    const catBand = getRatingBand(catScore);
    const qBand   = getRatingBand(weakestScore);

    if (tier === "warn") {
      const border = isCrit ? "#fca5a5" : "#fcd34d";
      const bg     = isCrit ? "#fff7f7" : "#fffbeb";
      const icon   = isCrit ? "⚠️" : "💡";

      html += `
        <div style="border:1px solid ${border}; background:${bg}; border-radius:8px;
                    padding:12px 14px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;
                      gap:8px; flex-wrap:wrap; margin-bottom:6px;">
            <span style="font-size:12px; font-weight:bold; color:#1e293b;">
              ${icon} ${CAT_NAMES[cat]}
            </span>
            <span style="font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;
                         background:white; border:1px solid ${border};
                         color:${catBand.color}; white-space:nowrap;">
              ${catScore} / 100 — ${catBand.label}
            </span>
          </div>
          <p style="font-size:11px; color:#64748b; margin-bottom:6px;">
            Lowest-rated item: <b>${preset.short}</b>
            <span style="color:${qBand.color}; font-weight:bold;"> (${weakestScore} / 100)</span>
          </p>
          <p style="font-size:12px; color:#374151; line-height:1.65; margin:0;">
            ${preset.rec}
          </p>
        </div>`;

    } else {
      // Soft watch area — lighter visual, no alarm
      html += `
        <div style="border:1px solid #e2e8f0; background:#f8fafc; border-radius:8px;
                    padding:10px 14px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;
                      gap:8px; flex-wrap:wrap; margin-bottom:4px;">
            <span style="font-size:12px; font-weight:bold; color:#475569;">
              📌 Watch Area — ${CAT_NAMES[cat]}
            </span>
            <span style="font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;
                         background:white; border:1px solid #e2e8f0;
                         color:${catBand.color}; white-space:nowrap;">
              ${catScore} / 100 — ${catBand.label}
            </span>
          </div>
          <p style="font-size:11px; color:#64748b; margin-bottom:5px;">
            One item rated lower than the rest: <b>${preset.short}</b>
            <span style="color:${qBand.color}; font-weight:bold;"> (${weakestScore} / 100)</span>
          </p>
          <p style="font-size:12px; color:#64748b; line-height:1.65; margin:0;">
            ${preset.rec}
          </p>
        </div>`;
    }
  });

  body.innerHTML = html;
  card.style.display = "block";
}

// ══════════════════════════════════════════════════════════════
//  LOAD SUBJECTS
// ══════════════════════════════════════════════════════════════
async function loadSubjects(semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("name, enrolled_count, sections(name)")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId);

  const list = document.getElementById("subjects-list");
  if (!list) return;

  if (!subjects || subjects.length === 0) {
    list.innerHTML = `<p style="color:#94a3b8; font-size:13px;">No subjects found.</p>`;
    return;
  }

  list.innerHTML = subjects.map(s => `
    <div class="subject-item">
      <div>
        <div class="subj-name">${s.name}</div>
        <div class="subj-sec">${s.sections?.name || "—"}</div>
      </div>
      <span class="subj-count">${s.enrolled_count || 0} students</span>
    </div>
  `).join("");
}

// ══════════════════════════════════════════════════════════════
//  LOAD SUPERVISOR REMARKS + SEF RATING
// ══════════════════════════════════════════════════════════════
async function loadSupervisorRemarks(semesterId) {
  const { data: remarks } = await supabase
    .from("supervisor_remarks")
    .select("sef_score, remarks, submitted_at")
    .eq("teacher_id", userId)
    .eq("semester_id", semesterId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!remarks) return;

  // SEF card
  if (remarks.sef_score) {
    const sefCard = document.getElementById("sef-card");
    if (sefCard) sefCard.style.display = "block";
    const sefEl = document.getElementById("sef-rating");
    const sefLb = document.getElementById("sef-label");
    if (sefEl) { sefEl.textContent = remarks.sef_score; sefEl.style.color = getRatingColor(remarks.sef_score); }
    if (sefLb)   sefLb.textContent = getRatingLabel(remarks.sef_score);
  }

  // Remarks card
  if (remarks.remarks) {
    const remarksCard = document.getElementById("remarks-card");
    const remarksBox  = document.getElementById("supervisor-remarks-box");
    if (remarksCard) remarksCard.style.display = "block";
    if (remarksBox)  remarksBox.textContent = remarks.remarks;
  }
}

// ── Change Password ──
document.getElementById("change-password-btn")?.addEventListener("click", () => {
  document.getElementById("cp-new").value     = "";
  document.getElementById("cp-confirm").value = "";
  document.getElementById("cp-error").textContent = "";
  document.getElementById("change-password-modal").classList.remove("hidden");
});

document.getElementById("cp-cancel-btn")?.addEventListener("click", () => {
  document.getElementById("change-password-modal").classList.add("hidden");
});

document.getElementById("cp-save-btn")?.addEventListener("click", async () => {
  const newPw  = document.getElementById("cp-new").value;
  const confPw = document.getElementById("cp-confirm").value;
  const errEl  = document.getElementById("cp-error");
  const btn    = document.getElementById("cp-save-btn");
  errEl.textContent = "";

  if (!newPw || newPw.length < 8) { errEl.textContent = "Password must be at least 8 characters."; return; }
  if (newPw !== confPw)           { errEl.textContent = "Passwords do not match."; return; }

  btn.textContent = "Saving...";
  btn.disabled    = true;

  const { error } = await supabase.auth.updateUser({ password: newPw });

  btn.textContent = "Save Password";
  btn.disabled    = false;

  if (error) { errEl.textContent = "Failed: " + error.message; return; }

  document.getElementById("change-password-modal").classList.add("hidden");
  alert("Password changed successfully.");
});

// ── Events ──
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// ── Init ──
loadSemester();