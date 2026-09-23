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

// ── This supervisor's own department — fetched once at load, since
//    faculty visibility below is scoped by department match (exactly
//    one supervisor per department, i.e. the program chair), not by
//    the old per-teacher supervisor_id link. ──
let supervisorDepartment = null;
async function loadSupervisorDepartment() {
  const { data, error } = await supabase
    .from("users")
    .select("department")
    .eq("id", supervisorId)
    .maybeSingle();
  if (error || !data?.department) {
    document.getElementById("faculty-cards-container").innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <h3>No Department Set</h3>
        <p>Your account has no department assigned, so no faculty can be shown.
           Ask an admin to set your department in User Management.</p>
      </div>`;
    return null;
  }
  return data.department;
}

// ══════════════════════════════════════════════════════════════
//  SEF QUESTIONS — Annex B, CMO No. 19 s. 2025 (1:1 copy)
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

// ── Suggested Means for Verification — 1:1 copy from Annex B ──
const MEANS_OF_VERIFICATION = {
  q1:  ["Daily time record","Faculty schedule and timetable","Informal interview with students"],
  q2:  ["Documents submission log","Submission Receipts or Acknowledgment Emails"],
  q3:  ["Class Schedules & Timetables","LMS Logs","Informal interview with students"],
  q4:  ["Course syllabus","Learning Plan","Classroom Observation","Informal interview with students","LMS Logs"],
  q5:  ["Course Syllabus","Learning Plan","Student Work Samples","Classroom Observation","LMS Logs","Informal interview with students","Faculty Consultation Log"],
  q6:  ["Graded Student Work with Feedback","Faculty Consultation Log","Informal interview with students","Emails or Official correspondence","LMS Logs"],
  q7:  ["Course Syllabus","Learning Plan","IMs developed by the faculty","Informal interview with students","Mentorship or Thesis/Dissertation Advisory records"],
  q8:  ["Learning Plan","Course Syllabus","Classroom Observation","Informal interview with students","Lecture notes and presentations","LMS Logs"],
  q9:  ["Course Syllabus","Learning Plan","Classroom Observation","Informal interview with students","LMS Logs","IMs developed by the faculty","Participation in Conferences, Webinars, and Training"],
  q10: ["Course Syllabus","Learning Plan","Classroom Observation","Informal interview with students","LMS Logs","Multimedia Lecture Materials","Student Work Samples"],
  q11: ["Course Syllabus","Learning Plan","Informal interview with students","Assessment tools and rubrics","Exam and Quiz Samples","Graded Student Work Samples","LMS records"],
  q12: ["Course Syllabus","Learning Plan","IMs developed by the faculty","Classroom Observation","Informal interview with students"],
  q13: ["Course Syllabus","Faculty Consultation Log","Advisory Records","LMS Logs","Emails or Official Correspondence"],
  q14: ["Graded Student Work Samples","Assessment tools and rubrics","Informal interview with students","LMS Logs","Emails or Official Correspondence"],
  q15: ["Faculty Consultation Log","Advising Reports","Course Syllabus","Assessment Tools and Rubrics","Informal interview with students","LMS Records","Grade Sheets and Records"],
};

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
//  WEIGHTED SET COMPUTATION
//  (still used for the "Student SET" badge on the faculty list
//   cards — that badge was NOT crossed out, only the in-modal
//   reference box and improvement-areas panel were removed.)
// ══════════════════════════════════════════════════════════════
async function computeWeightedSET(teacherId, semesterId) {
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, enrolled_count, sections(name)")
    .eq("teacher_id", teacherId)
    .eq("semester_id", semesterId);

  if (!subjects || subjects.length === 0) return null;

  let totalWeighted = 0, totalEnrolled = 0, totalRespondents = 0;

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
    });

    const respondents = evals.length;
    let enrolled = subject.enrolled_count || 0;
    if (enrolled < respondents) enrolled = respondents;
    totalWeighted    += enrolled * (sumRatings / respondents);
    totalEnrolled    += enrolled;
    totalRespondents += respondents;
  }

  if (totalRespondents === 0) return null;

  return {
    overallSET: parseFloat((totalWeighted / totalEnrolled).toFixed(2)),
  };
}

// ══════════════════════════════════════════════════════════════
//  LOAD FORWARDED REPORTS
// ══════════════════════════════════════════════════════════════
async function loadForwardedReports() {
  const container = document.getElementById("faculty-cards-container");
  container.innerHTML = `<p style="color:#94a3b8; text-align:center; padding:32px 0;">Loading...</p>`;

  if (supervisorDepartment === null) {
    supervisorDepartment = await loadSupervisorDepartment();
    if (!supervisorDepartment) return; // empty-state already rendered
  }

  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).single();

  if (!semester) {
    container.innerHTML = `<p style="color:#ef4444; text-align:center; padding:32px 0;">No active semester found.</p>`;
    return;
  }

  activeSemester = semester;
  document.getElementById("semester-label").textContent = semester.label;

  // ── Ownership filter ──
  // users!inner + .eq("users.department", supervisorDepartment) restricts
  // this query, at the database level, to faculty in THIS supervisor's own
  // department — the model here is exactly one supervisor per department
  // (the program chair), so department match IS the assignment. This
  // replaces the earlier users.supervisor_id link, which nothing in the
  // admin UI ever actually set. Without a real filter here, every
  // supervisor account could see and submit an SEF for every faculty
  // member in the system, regardless of department — that was a real
  // bug, not a hypothetical one.
  const { data: releases, error } = await supabase
    .from("report_releases")
    .select("id, teacher_id, stage, users!inner(name, academic_rank, department)")
    .eq("semester_id", semester.id)
    .eq("users.department", supervisorDepartment)
    .in("stage", ["forwarded_to_supervisor", "supervisor_done"]);

  if (error || !releases || releases.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>No Reports Forwarded Yet</h3>
        <p>The QAO has not forwarded any faculty evaluation reports assigned to you for review.</p>
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
    const teacherRank = release.users?.academic_rank || "";
    const teacherDept = release.users?.department || "";
    const isDone      = release.stage === "supervisor_done";
    const safeId      = release.teacher_id;
    const safeName    = escapeHtml(teacherName).replace(/'/g,"\\'");
    const safeRank    = escapeHtml(teacherRank).replace(/'/g,"\\'");
    const safeDept    = escapeHtml(teacherDept).replace(/'/g,"\\'");

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
          onclick="openReview('${safeId}', '${safeName}', ${isDone}, '${safeRank}', '${safeDept}')"
          ${isDone ? 'class="btn-secondary"' : ""}
          style="font-size:13px; padding:6px 14px;">
          ${isDone ? "View Submission" : "Complete SEF →"}
        </button>
      </div>
    `;
    container.appendChild(card);

    // Load SET score async (list-card badge only — unaffected by this update)
    computeWeightedSET(release.teacher_id, semester.id).then(result => {
      const el = document.getElementById(`score-${release.teacher_id}`);
      if (!el || !result) return;
      el.textContent = result.overallSET + " / 100";
      el.style.color = getRatingColor(result.overallSET);
    });
  }
}

// ── Fill Course Code/Title from the teacher's actual subjects this
//    semester. Annex B assumes one row per course; a faculty here can
//    have several, so we list them all rather than guessing a single
//    one. College/Department comes straight from the teacher's own
//    stored `department` now (passed in from the card, matches the
//    supervisor's own department by construction) rather than being
//    inferred from subjects/sections — more reliable, and works even
//    for a teacher with zero subjects assigned yet. ──
async function populateCourseTitle(teacherId) {
  const courseEl  = document.getElementById("fi-course");
  courseEl.textContent = "—";
  if (!activeSemester) return;

  const { data: subjects } = await supabase
    .from("subjects")
    .select("name")
    .eq("teacher_id", teacherId)
    .eq("semester_id", activeSemester.id);

  if (!subjects || subjects.length === 0) return;

  const courseNames = [...new Set(subjects.map(s => s.name).filter(Boolean))];
  if (courseNames.length) courseEl.textContent = courseNames.join(", ");
}

// ══════════════════════════════════════════════════════════════
//  OPEN REVIEW MODAL
// ══════════════════════════════════════════════════════════════
async function openReview(teacherId, teacherName, isDone, academicRank, department) {
  currentTeacherId = teacherId;

  document.getElementById("modal-teacher-name").textContent = teacherName;
  document.getElementById("modal-semester").textContent     = `Semester: ${activeSemester?.label || "—"}`;
  document.getElementById("review-error").textContent       = "";
  document.getElementById("sef-live-score").textContent     = "—";
  document.getElementById("sef-live-score").style.color     = "#1a56db";

  // ── A. Faculty Information (1:1 copy from Annex B) ──
  document.getElementById("fi-name").textContent     = teacherName;
  document.getElementById("fi-rank").textContent      = academicRank || "—";
  document.getElementById("fi-college").textContent   = department || "—";
  document.getElementById("fi-semester").textContent  = activeSemester?.label || "—";
  document.getElementById("fi-programyear").textContent = "—"; // not tracked anywhere in the schema — see note
  await populateCourseTitle(teacherId);

  // Toggle form vs submitted view
  document.getElementById("review-form").style.display    = isDone ? "none" : "block";
  document.getElementById("submitted-view").style.display = isDone ? "block" : "none";

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
        <td colspan="7" style="background:#334155; color:white; font-weight:bold; font-size:12px; padding:8px 12px; border-color:#1e293b;">
          ${CAT_LABELS[q.cat]}
        </td>`;
      tbody.appendChild(catRow);
    }

    const means = MEANS_OF_VERIFICATION[q.id] || [];
    const row = document.createElement("tr");
    row.id = `sef-row-${q.id}`;
    row.innerHTML = `
      <td class="q-text"><b>${idx+1}.</b> ${q.text}</td>
      <td class="means-cell"><ul>${means.map(m => `<li>${m}</li>`).join("")}</ul></td>
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

    const means = MEANS_OF_VERIFICATION[q.id] || [];
    const card = document.createElement("div");
    card.className = "sef-q-card";
    card.id = `sef-mcard-${q.id}`;
    card.innerHTML = `
      <div class="sef-q-text"><b>${idx+1}.</b> ${q.text}</div>
      <div class="sef-q-means">
        <b>Suggested Means:</b>
        <ul>${means.map(m => `<li>${m}</li>`).join("")}</ul>
      </div>
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