// ============================================================
//  FacultyPulse — Supervisor Dashboard
//  SEF (Supervisor's Evaluation of Faculty) — Annex B
//  CMO No. 19, s. 2025
//  15 Annex B questions (differ from SET Annex A), formula: (score/75) x 100
// ============================================================

import { supabase } from "./supabase.js";
import { fpAlert } from "./modal.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "supervisor") {
  window.location.href = "../index.html";
}

const supervisorId   = sessionStorage.getItem("userId");
const supervisorName = sessionStorage.getItem("name");

document.getElementById("nav-user").textContent = "Logged in as: " + supervisorName;

// ══════════════════════════════════════════════════════════════
//  SEF QUESTIONS — same as SET (Annex B, CMO No. 19 s. 2025)
// ══════════════════════════════════════════════════════════════
const QUESTIONS = [
  { id:"q1",  cat:"A", text:"Comes to class on time." },
  { id:"q2",  cat:"A", text:"Submits updated syllabus, grade sheets, and other required reports on time." },
  { id:"q3",  cat:"A", text:"Maximizes the allocated time/learning hours effectively." },
  { id:"q4",  cat:"A", text:"Provides appropriate learning activities that facilitate critical thinking and creativity of students." },
  { id:"q5",  cat:"A", text:"Guides students to learn on their own, reflect on new ideas and experiences, and make decisions in accomplishing given tasks." },
  { id:"q6",  cat:"A", text:"Communicates constructive feedback to students for their academic growth." },
  { id:"q7",  cat:"B", text:"Demonstrates extensive and broad knowledge of the subject/course." },
  { id:"q8",  cat:"B", text:"Simplifies complex ideas in the lesson for ease of understanding." },
  { id:"q9",  cat:"B", text:"Integrates contemporary issues and developments in the discipline and/or daily life activities in the syllabus." },
  { id:"q10", cat:"B", text:"Promotes active learning and student engagement by using appropriate teaching and learning resources including ICT tools and platforms." },
  { id:"q11", cat:"B", text:"Uses appropriate assessments (projects, exams, quizzes, assignments, etc.) aligned with the learning outcomes." },
  { id:"q12", cat:"C", text:"Recognizes and values the unique diversity and individual differences among students." },
  { id:"q13", cat:"C", text:"Assists students with their learning challenges during consultation hours." },
  { id:"q14", cat:"C", text:"Provides immediate feedback on student outputs and performance." },
  { id:"q15", cat:"C", text:"Provides transparent and clear criteria in rating student's performance." },
];

const CAT_LABELS = {
  A: "A. Management of Teaching and Learning",
  B: "B. Content Knowledge, Pedagogy and Technology",
  C: "C. Commitment and Transparency",
};

// ── State ──
let activeSemester   = null;
let currentTeacherId = null;

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
// CMO No. 19 Annex A/B rating scale breakpoints
function getRatingLabel(score) {
  if (score >= 91) return "Outstanding";
  if (score >= 61) return "Very Satisfactory";
  if (score >= 31) return "Satisfactory";
  if (score >= 11) return "Needs Improvement";
  return "Poor";
}

function getRatingColor(score) {
  if (score >= 91) return "#10b981";
  if (score >= 61) return "#3b82f6";
  if (score >= 31) return "#f59e0b";
  if (score >= 11) return "#f97316";
  return "#ef4444";
}

function computeSEFFromInputs() {
  let total = 0;
  let answered = 0;
  QUESTIONS.forEach(q => {
    const checked = document.querySelector(`input[name="sef_${q.id}"]:checked`);
    if (checked) { total += parseInt(checked.value); answered++; }
  });
  if (answered === 0) return null;
  return parseFloat(((total / 75) * 100).toFixed(2));
}

// ══════════════════════════════════════════════════════════════
//  WEIGHTED SET COMPUTATION (for reference display)
// ══════════════════════════════════════════════════════════════
async function computeWeightedSET(teacherId, semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) return null;

  let totalWeighted = 0, totalEnrolled = 0, totalRespondents = 0;
  const catTotals = { A:0, B:0, C:0 };
  const catCounts = { A:0, B:0, C:0 };
  const qTotals = {}; const qCounts = {};
  for (let i = 1; i <= 15; i++) { qTotals[`q${i}`] = 0; qCounts[`q${i}`] = 0; }

  for (const subject of subjects) {
    const { data: evals } = await supabase
      .from("evaluation_scores")
      .select("scores")
      .eq("subject_id", subject.id)
      .eq("semester_id", semesterId);

    if (!evals || evals.length === 0) continue;

    let sumRatings = 0;
    evals.forEach(e => {
      const totalScore = Object.values(e.scores).reduce((s,v) => s+v, 0);
      sumRatings += (totalScore / 75) * 100;
      const catA = ["q1","q2","q3","q4","q5","q6"].reduce((s,k) => s+(e.scores[k]||0), 0);
      const catB = ["q7","q8","q9","q10","q11"].reduce((s,k) => s+(e.scores[k]||0), 0);
      const catC = ["q12","q13","q14","q15"].reduce((s,k) => s+(e.scores[k]||0), 0);
      catTotals.A += (catA/30)*100; catCounts.A++;
      catTotals.B += (catB/25)*100; catCounts.B++;
      catTotals.C += (catC/20)*100; catCounts.C++;
      for (let i = 1; i <= 15; i++) {
        const k = `q${i}`;
        qTotals[k] += (e.scores[k] || 0);
        qCounts[k]++;
      }
    });

    const respondents = evals.length;
    let enrolled = subject.enrolled_count || 0;
    if (enrolled < respondents) enrolled = respondents;
    totalWeighted    += enrolled * (sumRatings / respondents);
    totalEnrolled    += enrolled;
    totalRespondents += respondents;
  }

  if (totalRespondents === 0) return null;

  const qAvgs = {};
  for (let i = 1; i <= 15; i++) {
    const k = `q${i}`;
    qAvgs[k] = qCounts[k] > 0 ? parseFloat((qTotals[k] / qCounts[k]).toFixed(2)) : 0;
  }

  return {
    overallSET: parseFloat((totalWeighted / totalEnrolled).toFixed(2)),
    avgA: catCounts.A > 0 ? parseFloat((catTotals.A/catCounts.A).toFixed(2)) : 0,
    avgB: catCounts.B > 0 ? parseFloat((catTotals.B/catCounts.B).toFixed(2)) : 0,
    avgC: catCounts.C > 0 ? parseFloat((catTotals.C/catCounts.C).toFixed(2)) : 0,
    qAvgs,
  };
}

// ══════════════════════════════════════════════════════════════
//  LOAD FORWARDED REPORTS
// ══════════════════════════════════════════════════════════════
async function loadForwardedReports() {
  const container = document.getElementById("faculty-cards-container");
  container.innerHTML = `<p style="color:#94a3b8; text-align:center; padding:32px 0;">Loading...</p>`;

  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).single();

  if (!semester) {
    container.innerHTML = `<p style="color:#ef4444; text-align:center; padding:32px 0;">No active semester found.</p>`;
    return;
  }

  activeSemester = semester;
  document.getElementById("semester-label").textContent = semester.label;

  const { data: releases, error } = await supabase
    .from("report_releases")
    .select("id, teacher_id, stage, users(name, academic_rank)")
    .eq("semester_id", semester.id)
    .in("stage", ["forwarded_to_supervisor", "supervisor_done"]);

  if (error || !releases || releases.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>No Reports Forwarded Yet</h3>
        <p>The QAO has not forwarded any faculty evaluation reports for your review.</p>
      </div>`;
    document.getElementById("count-pending").textContent = "0";
    document.getElementById("count-done").textContent    = "0";
    document.getElementById("count-total").textContent   = "0";
    return;
  }

  const pending = releases.filter(r => r.stage === "forwarded_to_supervisor").length;
  const done    = releases.filter(r => r.stage === "supervisor_done").length;
  document.getElementById("count-pending").textContent = pending;
  document.getElementById("count-done").textContent    = done;
  document.getElementById("count-total").textContent   = releases.length;

  container.innerHTML = "";
  for (const release of releases) {
    const teacherName = release.users?.name || "Unknown Faculty";
    const isDone      = release.stage === "supervisor_done";
    const safeId      = release.teacher_id;
    const safeName    = escapeHtml(teacherName).replace(/'/g,"\\'");

    const card = document.createElement("div");
    card.className = "faculty-card";
    card.id = `card-${safeId}`;
    card.innerHTML = `
      <div class="faculty-card-info">
        <h3>${escapeHtml(teacherName)}</h3>
        <p>${release.users?.academic_rank || "Faculty"}</p>
      </div>
      <div class="faculty-card-score">
        <div class="score-big" id="score-${safeId}" style="color:#94a3b8;">—</div>
        <div class="score-sub">Student SET</div>
      </div>
      <div class="faculty-card-actions">
        <span class="stage-badge ${isDone ? "stage-done" : "stage-forwarded"}">
          ${isDone ? "✅ SEF Submitted" : "📋 Pending SEF"}
        </span>
        <button
          onclick="openReview('${safeId}', '${safeName}', ${isDone})"
          ${isDone ? 'class="btn-secondary"' : ""}
          style="font-size:13px; padding:6px 14px;">
          ${isDone ? "View Submission" : "Complete SEF →"}
        </button>
      </div>
    `;
    container.appendChild(card);

    // Load SET score async
    computeWeightedSET(release.teacher_id, semester.id).then(result => {
      const el = document.getElementById(`score-${release.teacher_id}`);
      if (!el || !result) return;
      el.textContent = result.overallSET + " / 100";
      el.style.color = getRatingColor(result.overallSET);
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  OPEN REVIEW MODAL
// ══════════════════════════════════════════════════════════════
async function openReview(teacherId, teacherName, isDone) {
  currentTeacherId = teacherId;

  document.getElementById("modal-teacher-name").textContent = teacherName;
  document.getElementById("modal-semester").textContent     = `Semester: ${activeSemester?.label || "—"}`;
  document.getElementById("review-error").textContent       = "";
  document.getElementById("sef-live-score").textContent     = "—";
  document.getElementById("sef-live-score").style.color     = "#1a56db";

  // Toggle form vs submitted view
  document.getElementById("review-form").style.display    = isDone ? "none" : "block";
  document.getElementById("submitted-view").style.display = isDone ? "block" : "none";

  // Load SET score for reference
  const setResult = await computeWeightedSET(teacherId, activeSemester.id);
  if (setResult) {
    document.getElementById("modal-catA").textContent =
      `${setResult.avgA} / 100 — ${getRatingLabel(setResult.avgA)}`;
    document.getElementById("modal-catB").textContent =
      `${setResult.avgB} / 100 — ${getRatingLabel(setResult.avgB)}`;
    document.getElementById("modal-catC").textContent =
      `${setResult.avgC} / 100 — ${getRatingLabel(setResult.avgC)}`;
    const overallEl = document.getElementById("modal-overall");
    overallEl.textContent = `${setResult.overallSET} / 100`;
    overallEl.style.color = getRatingColor(setResult.overallSET);

    // Show recommendations so supervisor knows what to address in comments
    renderSupRecommendations(setResult.avgA, setResult.avgB, setResult.avgC, setResult.qAvgs || {});
  } else {
    ["modal-catA","modal-catB","modal-catC","modal-overall"].forEach(id => {
      document.getElementById(id).textContent = "No data";
    });
    const recPanel = document.getElementById("modal-rec-panel");
    if (recPanel) recPanel.style.display = "none";
  }

  if (isDone) {
    // Load existing submission
    const { data: existing } = await supabase
      .from("supervisor_remarks")
      .select("comments, remarks, sef_score")
      .eq("teacher_id", teacherId)
      .eq("semester_id", activeSemester.id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sefScore = existing?.sef_score;
    document.getElementById("submitted-sef-score").textContent =
      sefScore
        ? `${sefScore} / 100 — ${getRatingLabel(sefScore)}`
        : "Not recorded";
    document.getElementById("submitted-comments").textContent =
      existing?.comments || "(no comments recorded)";
    document.getElementById("submitted-remarks").textContent  =
      existing?.remarks  || "(no remarks recorded)";
  } else {
    // Build SEF question table (desktop) + mobile cards
    buildSEFTable();
    buildSEFMobileCards();
    initCommentRows(""); // start with 3 blank rows
    document.getElementById("input-remarks").value = "";
  }

  document.getElementById("review-modal").classList.remove("hidden");
}

// ── Build SEF question table ──
function buildSEFTable() {
  const tbody = document.getElementById("sef-tbody");
  tbody.innerHTML = "";
  let currentCat = "";

  QUESTIONS.forEach((q, idx) => {
    if (q.cat !== currentCat) {
      currentCat = q.cat;
      const catRow = document.createElement("tr");
      catRow.innerHTML = `
        <td colspan="6" style="background:#334155; color:white; font-weight:bold; font-size:12px; padding:8px 12px; border-color:#1e293b;">
          ${CAT_LABELS[q.cat]}
        </td>`;
      tbody.appendChild(catRow);
    }

    const row = document.createElement("tr");
    row.id = `sef-row-${q.id}`;
    row.innerHTML = `
      <td class="q-text"><b>${idx+1}.</b> ${q.text}</td>
      ${[5,4,3,2,1].map(n => `
        <td class="r-cell">
          <input type="radio" name="sef_${q.id}" value="${n}"
            onchange="onSEFChange()" />
        </td>`).join("")}
    `;
    tbody.appendChild(row);
  });
}

// ── Mobile SEF card builder ──
function buildSEFMobileCards() {
  const container = document.getElementById("sef-mobile-cards");
  if (!container) return;
  container.innerHTML = "";
  let currentCat = "";

  QUESTIONS.forEach((q, idx) => {
    if (q.cat !== currentCat) {
      currentCat = q.cat;
      const header = document.createElement("div");
      header.style.cssText = "background:#334155; color:white; font-weight:bold; font-size:12px; padding:8px 12px; border-radius:4px; margin:12px 0 6px;";
      header.textContent = CAT_LABELS[q.cat];
      container.appendChild(header);
    }

    const card = document.createElement("div");
    card.className = "sef-q-card";
    card.id = `sef-mcard-${q.id}`;
    card.innerHTML = `
      <div class="sef-q-text"><b>${idx+1}.</b> ${q.text}</div>
      <div class="sef-q-options">
        ${[5,4,3,2,1].map(n => `
          <label class="sef-q-btn" id="sef-mbtn-${q.id}-${n}">
            <input type="radio" name="sef_${q.id}" value="${n}"
              onchange="onSEFMobileRate('${q.id}', ${n}, this)" />
            ${n}
          </label>
        `).join("")}
      </div>
    `;
    container.appendChild(card);
  });
}

function onSEFMobileRate(qId, val, input) {
  // Sync: update selected style on mobile buttons
  [5,4,3,2,1].forEach(n => {
    const btn = document.getElementById(`sef-mbtn-${qId}-${n}`);
    if (btn) btn.classList.toggle("selected", n === val);
  });
  // Sync: also check the hidden desktop radio so computeSEFFromInputs() still works
  const desktopRadio = document.querySelector(`#sef-tbody input[name="sef_${qId}"][value="${val}"]`);
  if (desktopRadio) desktopRadio.checked = true;
  // Also highlight / un-highlight the mobile card
  const card = document.getElementById(`sef-mcard-${qId}`);
  if (card) card.classList.remove("unanswered");
  onSEFChange();
}
window.onSEFMobileRate = onSEFMobileRate;

// ── Live SEF score update ──
function onSEFChange() {
  const score = computeSEFFromInputs();
  const el    = document.getElementById("sef-live-score");
  if (score === null) {
    el.textContent = "—";
    el.style.color = "#1a56db";
  } else {
    el.textContent = `${score} / 100 — ${getRatingLabel(score)}`;
    el.style.color = getRatingColor(score);
  }
}
window.onSEFChange = onSEFChange;

// ══════════════════════════════════════════════════════════════
//  SUBMIT SEF + REMARKS
// ══════════════════════════════════════════════════════════════
async function submitReview() {
  const comments = getCommentsFromRows();
  const remarks  = document.getElementById("input-remarks").value.trim();
  const errorEl  = document.getElementById("review-error");
  const btn      = document.getElementById("submit-review-btn");

  errorEl.textContent = "";

  // Validate all 15 SEF questions answered
  const unanswered = QUESTIONS.filter(q =>
    !document.querySelector(`input[name="sef_${q.id}"]:checked`)
  );

  if (unanswered.length > 0) {
    // Highlight unanswered — desktop rows + mobile cards
    QUESTIONS.forEach(q => {
      const isUnanswered = !document.querySelector(`input[name="sef_${q.id}"]:checked`);
      const row  = document.getElementById(`sef-row-${q.id}`);
      const card = document.getElementById(`sef-mcard-${q.id}`);
      if (row)  row.classList.toggle("sef-unanswered", isUnanswered);
      if (card) card.classList.toggle("unanswered", isUnanswered);
    });
    errorEl.textContent = `Please answer all 15 SEF questions. (${unanswered.length} unanswered)`;
    return;
  }

  if (!remarks) { errorEl.textContent = "Remarks are required."; return; }

  const sefScore = computeSEFFromInputs();

  btn.textContent = "Submitting...";
  btn.disabled    = true;

  try {
    // 1. Insert supervisor_remarks with SEF score
    const { error: insertError } = await supabase
      .from("supervisor_remarks")
      .insert({
        teacher_id:    currentTeacherId,
        semester_id:   activeSemester.id,
        supervisor_id: supervisorId,
        comments,
        remarks,
        sef_score:     sefScore,
      });

    if (insertError) {
      errorEl.textContent = "Failed to save: " + insertError.message;
      return;
    }

    // 2. Update stage to supervisor_done
    const { error: updateError } = await supabase
      .from("report_releases")
      .update({ stage: "supervisor_done" })
      .eq("teacher_id",  currentTeacherId)
      .eq("semester_id", activeSemester.id);

    if (updateError) {
      errorEl.textContent = "Saved but failed to update stage: " + updateError.message;
      return;
    }

    closeReviewModal();
    await fpAlert(
      `SEF submitted successfully!\n\nSEF Rating: ${sefScore} / 100 — ${getRatingLabel(sefScore)}\n\nThe QAO can now do the Final Release. Your comments will automatically appear in the printed IFER.`,
      "success"
    );
    await loadForwardedReports();

  } catch (err) {
    errorEl.textContent = "Unexpected error: " + err.message;
    console.error(err);
  } finally {
    btn.textContent = "✅ Submit SEF & Remarks";
    btn.disabled    = false;
  }
}

function closeReviewModal() {
  document.getElementById("review-modal").classList.add("hidden");
  currentTeacherId = null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

window.openReview = openReview;

// ── Change Password ──
document.getElementById("change-password-btn")?.addEventListener("click", () => {
  document.getElementById("cp-new").value          = "";
  document.getElementById("cp-confirm").value      = "";
  document.getElementById("cp-error").textContent  = "";
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
  btn.textContent = "Saving..."; btn.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: newPw });
  btn.textContent = "Save Password"; btn.disabled = false;
  if (error) { errEl.textContent = "Failed: " + error.message; return; }
  document.getElementById("change-password-modal").classList.add("hidden");
  alert("Password changed successfully.");
});

// ══════════════════════════════════════════════════════════════
//  DYNAMIC COMMENT ROWS
// ══════════════════════════════════════════════════════════════
function addCommentRow(text = "") {
  const container = document.getElementById("comments-rows-container");
  if (!container) return;
  const idx = container.children.length + 1;
  const row = document.createElement("div");
  row.style.cssText = "display:flex; align-items:flex-start; gap:8px;";
  row.innerHTML = `
    <span style="font-size:12px; color:#94a3b8; padding-top:10px; min-width:20px; text-align:right;">${idx}.</span>
    <textarea class="comment-row-input"
      placeholder="Comment ${idx}..."
      style="flex:1; padding:8px 10px; border:1px solid #ccc; border-radius:6px;
        font-size:13px; font-family:Arial,sans-serif; resize:vertical; min-height:52px;"
    >${text}</textarea>
  `;
  container.appendChild(row);
}

function removeCommentRow() {
  const container = document.getElementById("comments-rows-container");
  if (!container || container.children.length === 0) return;
  container.removeChild(container.lastChild);
}

function getCommentsFromRows() {
  const inputs = document.querySelectorAll(".comment-row-input");
  return Array.from(inputs)
    .map(i => i.value.trim())
    .filter(Boolean)
    .join("\n");
}

function initCommentRows(existingText = "") {
  const container = document.getElementById("comments-rows-container");
  if (!container) return;
  container.innerHTML = "";
  const lines = existingText
    ? existingText.split("\n").map(l => l.trim()).filter(Boolean)
    : [];
  const count = Math.max(lines.length, 3); // at least 3 rows
  for (let i = 0; i < count; i++) addCommentRow(lines[i] || "");
}

// ══════════════════════════════════════════════════════════════
//  PRESET RECOMMENDATIONS (supervisor view)
//  Same logic as teacher dashboard — helps supervisor see
//  which areas students flagged before writing comments.
// ══════════════════════════════════════════════════════════════
const SUP_Q_PRESETS = {
  q1:"Punctuality", q2:"Clarity of expectations", q3:"Time management",
  q4:"Critical thinking activities", q5:"Student autonomy", q6:"Constructive feedback",
  q7:"Subject knowledge", q8:"Simplifying complex ideas", q9:"Relevance to current issues",
  q10:"Active learning & ICT", q11:"Assessment alignment", q12:"Valuing diversity",
  q13:"Consultation support", q14:"Feedback on outputs", q15:"Transparent grading",
};
const SUP_CAT_QUESTIONS = {
  A: ["q1","q2","q3","q4","q5","q6"],
  B: ["q7","q8","q9","q10","q11"],
  C: ["q12","q13","q14","q15"],
};
const SUP_CAT_NAMES = {
  A: "A. Management of Teaching & Learning",
  B: "B. Content Knowledge, Pedagogy & Technology",
  C: "C. Commitment & Transparency",
};

function renderSupRecommendations(avgA, avgB, avgC, qAvgs) {
  const panel   = document.getElementById("modal-rec-panel");
  const body    = document.getElementById("modal-rec-body");
  if (!panel || !body) return;

  const catScores = { A: avgA, B: avgB, C: avgC };
  const WARN = 70; const WATCH = 60;
  let html = "";

  for (const [cat, catScore] of Object.entries(catScores)) {
    let weakestQ = null, weakestScore = Infinity;
    for (const qId of SUP_CAT_QUESTIONS[cat]) {
      if ((qAvgs[qId] ?? 0) < weakestScore) { weakestScore = qAvgs[qId] ?? 0; weakestQ = qId; }
    }
    const weakest100 = parseFloat(((weakestScore / 5) * 100).toFixed(1));

    if (catScore <= WARN) {
      const isCrit  = catScore <= 50;
      const border  = isCrit ? "#fca5a5" : "#fcd34d";
      const bg      = isCrit ? "#fff7f7" : "#fffbeb";
      const icon    = isCrit ? "⚠️" : "💡";
      html += `<div style="border:1px solid ${border}; background:${bg}; border-radius:6px;
        padding:8px 12px; margin-bottom:8px;">
        <b>${icon} ${SUP_CAT_NAMES[cat]}</b> — ${catScore}/100<br/>
        <span style="color:#64748b;">Lowest item: <b>${SUP_Q_PRESETS[weakestQ]}</b> (${weakest100}/100)</span>
      </div>`;
    } else if (weakest100 < WATCH) {
      html += `<div style="border:1px solid #e2e8f0; background:#f8fafc; border-radius:6px;
        padding:8px 12px; margin-bottom:8px;">
        <b>📌 Watch — ${SUP_CAT_NAMES[cat]}</b> — ${catScore}/100<br/>
        <span style="color:#64748b;">One lower item: <b>${SUP_Q_PRESETS[weakestQ]}</b> (${weakest100}/100)</span>
      </div>`;
    }
  }

  if (!html) {
    html = `<div style="color:#16a34a; font-size:12px;">🌟 All categories above threshold. Strong performance.</div>`;
  }

  body.innerHTML = html;
  panel.style.display = "block";
}

// ── Events ──
document.getElementById("submit-review-btn").addEventListener("click", submitReview);
document.getElementById("add-comment-row-btn")?.addEventListener("click", () => addCommentRow());
document.getElementById("remove-comment-row-btn")?.addEventListener("click", removeCommentRow);
document.getElementById("cancel-review-btn").addEventListener("click", closeReviewModal);
document.getElementById("close-submitted-btn").addEventListener("click", closeReviewModal);
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// ── Init ──
loadForwardedReports();