// ============================================================
//  FacultyPulse — Student Dashboard
//  CMO No. 19, s. 2025 — 15 Official SET Questions
//  Formula: Rating = (Total Score / 75) × 100
//
//  Anonymity model: Admin/QA can see who submitted (for monitoring
//  and comment verification). The FACULTY never sees student identity
//  — teacher.js only ever reads aggregated scores, never student_id.
// ============================================================

import { supabase } from "./supabase.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "student") {
  window.location.href = "../index.html";
}

const studentId = sessionStorage.getItem("studentId");
const sectionId = sessionStorage.getItem("sectionId");

document.getElementById("welcome-name").textContent = studentId;
document.getElementById("nav-user").textContent     = "Logged in as: " + studentId;

// ══════════════════════════════════════════════════════════════
//  OFFICIAL SET QUESTIONS — CMO No. 19, s. 2025 (Annex A)
// ══════════════════════════════════════════════════════════════
const QUESTIONS = [
  { id: "q1",  category: "A. Management of Teaching and Learning", text: "Comes to class on time." },
  { id: "q2",  category: "A. Management of Teaching and Learning", text: "Explains learning outcomes, expectations, grading system, and various requirements of the subject/course." },
  { id: "q3",  category: "A. Management of Teaching and Learning", text: "Maximizes the allocated time/learning hours effectively." },
  { id: "q4",  category: "A. Management of Teaching and Learning", text: "Facilitates students to think critically and creatively by providing appropriate learning activities." },
  { id: "q5",  category: "A. Management of Teaching and Learning", text: "Guides students to learn on their own, reflect on new ideas and experiences, and make decisions in accomplishing given tasks." },
  { id: "q6",  category: "A. Management of Teaching and Learning", text: "Communicates constructive feedback to students for their academic growth." },
  { id: "q7",  category: "B. Content Knowledge, Pedagogy and Technology", text: "Demonstrates extensive and broad knowledge of the subject/course." },
  { id: "q8",  category: "B. Content Knowledge, Pedagogy and Technology", text: "Simplifies complex ideas in the lesson for ease of understanding." },
  { id: "q9",  category: "B. Content Knowledge, Pedagogy and Technology", text: "Relates the subject matter to contemporary issues and developments in the discipline and/or daily life activities." },
  { id: "q10", category: "B. Content Knowledge, Pedagogy and Technology", text: "Promotes active learning and student engagement by using appropriate teaching and learning resources including ICT tools and platforms." },
  { id: "q11", category: "B. Content Knowledge, Pedagogy and Technology", text: "Uses appropriate assessments (projects, exams, quizzes, assignments, etc.) aligned with the learning outcomes." },
  { id: "q12", category: "C. Commitment and Transparency", text: "Recognizes and values the unique diversity and individual differences among students." },
  { id: "q13", category: "C. Commitment and Transparency", text: "Assists students with their learning challenges during consultation hours." },
  { id: "q14", category: "C. Commitment and Transparency", text: "Provides immediate feedback on student outputs and performance." },
  { id: "q15", category: "C. Commitment and Transparency", text: "Provides transparent and clear criteria in rating student's performance." },
];

let currentSubjectId   = null;
let currentSubjectName = "";
let currentTeacherName = "";

// ── Load subjects for this student's section ──
async function loadSubjects() {
  const tbody = document.getElementById("subjects-tbody");
  tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;

  const { data: semester } = await supabase
    .from("semesters")
    .select("id, label")
    .eq("is_active", true)
    .single();

  if (!semester) {
    tbody.innerHTML = `<tr><td colspan="4">No active semester. Contact admin.</td></tr>`;
    return;
  }

  document.getElementById("semester-label").textContent = semester.label;
  window._activeSemesterId = semester.id;

  const { data: subjects, error } = await supabase
    .from("subjects")
    .select("id, name, users(name)")
    .eq("section_id", sectionId)
    .eq("semester_id", semester.id);

  if (error || !subjects || subjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No subjects found for your section.</td></tr>`;
    return;
  }

  // Check which subjects this student already evaluated (from tracking)
  const { data: done } = await supabase
    .from("evaluation_tracking")
    .select("subject_id")
    .eq("student_id", studentId)
    .eq("semester_id", semester.id);

  const doneIds = new Set((done || []).map(e => e.subject_id));

  tbody.innerHTML = "";
  subjects.forEach(sub => {
    const evaluated = doneIds.has(sub.id);
    tbody.innerHTML += `
      <tr>
        <td>${sub.name}</td>
        <td>${sub.users?.name || "—"}</td>
        <td>
          <span class="badge ${evaluated ? "done" : "pending"}">
            ${evaluated ? "Evaluated" : "Not Yet Evaluated"}
          </span>
        </td>
        <td>
          <button
            onclick="openEval('${sub.id}', '${sub.name.replace(/'/g,"\\'")}', '${(sub.users?.name || "").replace(/'/g,"\\'")}')"
            ${evaluated ? "disabled" : ""}>
            Evaluate
          </button>
        </td>
      </tr>
    `;
  });
}

// ── Open evaluation modal ──
function openEval(subjectId, subjectName, teacherName) {
  currentSubjectId   = subjectId;
  currentSubjectName = subjectName;
  currentTeacherName = teacherName;

  document.getElementById("modal-teacher").textContent = teacherName;
  document.getElementById("modal-subject").textContent = "Subject: " + subjectName;
  document.getElementById("eval-comment").value = "";

  const tbody = document.getElementById("questions-tbody");
  tbody.innerHTML = "";

  let currentCategory = "";
  QUESTIONS.forEach((q, index) => {
    if (q.category !== currentCategory) {
      currentCategory = q.category;
      const catRow = document.createElement("tr");
      catRow.className = "category-row";
      catRow.innerHTML = `<td colspan="6">${q.category}</td>`;
      tbody.appendChild(catRow);
    }
    const row = document.createElement("tr");
    row.id = "row-" + q.id;
    row.innerHTML = `
      <td class="question-text"><b>${index + 1}.</b> ${q.text}</td>
      ${[5,4,3,2,1].map(n => `
        <td class="rating-cell">
          <input type="radio" name="${q.id}" value="${n}" />
        </td>
      `).join("")}
    `;
    tbody.appendChild(row);
  });

  document.getElementById("eval-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("eval-modal").classList.add("hidden");
  currentSubjectId = null;
}

// ── CMO formula: Rating = (Total Score / 75) × 100 ──
function computeSETRating(scores) {
  const totalScore = Object.values(scores).reduce((sum, val) => sum + val, 0);
  return parseFloat(((totalScore / 75) * 100).toFixed(2));
}

// ── Submit evaluation ──
async function submitEval() {
  // Validate all 15 answered
  let allAnswered = true;
  let firstUnanswered = null;
  QUESTIONS.forEach(q => {
    const row = document.getElementById("row-" + q.id);
    if (!document.querySelector(`input[name="${q.id}"]:checked`)) {
      allAnswered = false;
      if (row) row.classList.add("unanswered");
      if (!firstUnanswered) firstUnanswered = row;
    } else {
      if (row) row.classList.remove("unanswered");
    }
  });

  if (!allAnswered) {
    alert("Please answer all 15 questions before submitting.\nUnanswered questions are highlighted in red.");
    if (firstUnanswered) firstUnanswered.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const scores = {};
  QUESTIONS.forEach(q => {
    scores[q.id] = parseInt(document.querySelector(`input[name="${q.id}"]:checked`).value);
  });

  const comment   = document.getElementById("eval-comment").value.trim();
  const setRating = computeSETRating(scores);

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.textContent = "Submitting...";
  submitBtn.disabled    = true;

  try {
    // ── Step 1: Write to TRACKING (identity + comment, admin-only) ──
    // The unique constraint here is the double-submission guard.
    const { error: trackError } = await supabase
      .from("evaluation_tracking")
      .insert({
        student_id:  studentId,
        subject_id:  currentSubjectId,
        semester_id: window._activeSemesterId,
        comment:     comment || null,
        is_verified: null,
      });

    if (trackError) {
      if (trackError.code === "23505") {
        alert("You have already submitted an evaluation for this subject.");
        closeModal();
        loadSubjects();
        return;
      }
      throw new Error(trackError.message);
    }

    // ── Step 2: Write to SCORES (no identity — safe for faculty) ──
    const { error: scoreError } = await supabase
      .from("evaluation_scores")
      .insert({
        subject_id:  currentSubjectId,
        semester_id: window._activeSemesterId,
        scores:      scores,
      });

    // ── Rollback if scores failed (prevents tracking/scores drift) ──
    if (scoreError) {
      await supabase
        .from("evaluation_tracking")
        .delete()
        .eq("student_id",  studentId)
        .eq("subject_id",  currentSubjectId)
        .eq("semester_id", window._activeSemesterId);
      throw new Error(scoreError.message);
    }

    alert(
      `✅ Evaluation submitted successfully!\n\n` +
      `Your SET Rating: ${setRating} / 100\n` +
      `(Based on CMO No. 19, s. 2025 formula)\n\n` +
      `Your teacher will only see anonymous, combined results — ` +
      `never your individual responses.`
    );

    closeModal();
    loadSubjects();

  } catch (err) {
    alert("Submission failed: " + err.message);
    console.error(err);
  } finally {
    submitBtn.textContent = "Submit Evaluation";
    submitBtn.disabled    = false;
  }
}

// ── Logout ──
function logout() {
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
}

// ── Expose to HTML ──
window.openEval   = openEval;
window.submitEval = submitEval;
window.closeModal = closeModal;

// ── Attach events ──
document.getElementById("submit-btn").addEventListener("click", submitEval);
document.getElementById("cancel-btn").addEventListener("click", closeModal);
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  logout();
});

// ── Init ──
loadSubjects();