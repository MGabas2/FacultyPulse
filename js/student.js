// ============================================================
//  FacultyPulse — Student Dashboard (Guided Step-by-Step)
//  CMO No. 19, s. 2025 — 15 Official SET Questions
//  Formula: Rating = (Total Score / 75) × 100
// ============================================================

import { supabase } from "./supabase.js";
import { fpAlert } from "./modal.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "student") {
  window.location.href = "../index.html";
}

const studentId   = sessionStorage.getItem("studentId");
const sectionId   = sessionStorage.getItem("sectionId");
const studentName = sessionStorage.getItem("name") || studentId;

// Show real name in welcome, ID in nav bar for clarity
document.getElementById("welcome-name").textContent = studentName !== studentId
  ? `${studentName} (${studentId})`
  : studentId;
document.getElementById("nav-user").textContent = "Logged in as: " + studentId;

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

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
let subjects        = [];   // all subjects for this student
let submittedIds    = new Set(); // already submitted to DB
let currentIdx      = null; // which subject is open in modal
let drafts          = {};   // { subjectId: { scores: {}, comment: "" } }
let activeSemId     = null;

const DRAFT_KEY = `fp_draft_${studentId}`;

function saveDraftsToStorage() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch(e) {}
}

function loadDraftsFromStorage() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) drafts = JSON.parse(raw);
  } catch(e) { drafts = {}; }
}

// ══════════════════════════════════════════════════════════════
//  INIT — load semester + subjects
// ══════════════════════════════════════════════════════════════
async function init() {
  loadDraftsFromStorage();

  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("is_active", true).single();

  if (!semester) {
    document.getElementById("semester-label").textContent = "No active semester. Contact admin.";
    return;
  }

  document.getElementById("semester-label").textContent = semester.label;
  activeSemId = semester.id;

  const { data: subs, error } = await supabase
    .from("subjects")
    .select("id, name, users(name)")
    .eq("section_id", sectionId)
    .eq("semester_id", semester.id);

  if (error || !subs || subs.length === 0) {
    document.getElementById("progress-section").style.display = "block";
    document.getElementById("subject-steps").innerHTML =
      `<p style="color:#94a3b8; padding:12px 0;">No subjects found for your section.</p>`;
    return;
  }

  subjects = subs;

  // Check which subjects already submitted in DB
  const { data: done } = await supabase
    .from("evaluation_tracking")
    .select("subject_id")
    .eq("student_id", studentId)
    .eq("semester_id", semester.id);

  submittedIds = new Set((done || []).map(e => e.subject_id));

  // Clear drafts for already-submitted subjects
  subjects.forEach(s => {
    if (submittedIds.has(s.id)) delete drafts[s.id];
  });
  saveDraftsToStorage();

  renderProgress();
}

// ══════════════════════════════════════════════════════════════
//  RENDER PROGRESS + SUBJECT STEPS
// ══════════════════════════════════════════════════════════════
function renderProgress() {
  const total     = subjects.length;
  const doneCount = submittedIds.size;
  const pct       = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // All submitted — show done screen
  if (doneCount === total && total > 0) {
    document.getElementById("progress-section").style.display    = "none";
    document.getElementById("submit-all-section").classList.remove("visible");
    document.getElementById("all-done-section").classList.add("visible");
    return;
  }

  document.getElementById("progress-section").style.display = "block";
  document.getElementById("all-done-section").classList.remove("visible");

  document.getElementById("progress-count").textContent = `${doneCount} / ${total} completed`;
  const bar = document.getElementById("progress-bar");
  bar.style.width = pct + "%";
  bar.classList.toggle("complete", pct === 100);

  // Check if all drafts are complete (all questions answered)
  const allDrafted = subjects.every(s =>
    submittedIds.has(s.id) || isDraftComplete(s.id)
  );

  // Show submit-all only if all drafted and none pending submission
  const pendingSubmit = subjects.some(s => !submittedIds.has(s.id) && isDraftComplete(s.id));
  if (allDrafted && pendingSubmit) {
    document.getElementById("submit-all-section").classList.add("visible");
  } else {
    document.getElementById("submit-all-section").classList.remove("visible");
  }

  // Render subject steps
  const container = document.getElementById("subject-steps");
  container.innerHTML = "";

  subjects.forEach((sub, idx) => {
    const isSubmitted = submittedIds.has(sub.id);
    const draft       = drafts[sub.id];
    const isComplete  = isDraftComplete(sub.id);
    const hasDraft    = draft && Object.keys(draft.scores || {}).length > 0;

    let stepClass  = "";
    let badgeClass = "pending";
    let badgeText  = "Not Started";
    let actionHTML = "";

    if (isSubmitted) {
      stepClass  = "done";
      badgeClass = "done";
      badgeText  = "✅ Submitted";
      actionHTML = `<button class="btn-secondary" style="font-size:12px; padding:5px 12px;" onclick="openReview(${idx})">View</button>`;
    } else if (isComplete) {
      stepClass  = "active";
      badgeClass = "draft";
      badgeText  = "✔ Ready";
      actionHTML = `<button style="font-size:12px; padding:5px 12px;" onclick="openEval(${idx})">Edit</button>`;
    } else if (hasDraft) {
      stepClass  = "active";
      badgeClass = "draft";
      badgeText  = "In Progress";
      actionHTML = `<button style="font-size:12px; padding:5px 12px;" onclick="openEval(${idx})">Continue →</button>`;
    } else {
      badgeClass = "pending";
      badgeText  = "Not Started";
      actionHTML = `<button style="font-size:12px; padding:5px 12px;" onclick="openEval(${idx})">Start →</button>`;
    }

    const div = document.createElement("div");
    div.className = `subject-step ${stepClass}`;
    div.innerHTML = `
      <div class="step-num">${isSubmitted ? "✓" : idx + 1}</div>
      <div class="step-info">
        <div class="step-name">${escapeHtml(sub.name)}</div>
        <div class="step-teacher">${escapeHtml(sub.users?.name || "—")}</div>
      </div>
      <span class="step-badge ${badgeClass}">${badgeText}</span>
      <div class="step-action">${actionHTML}</div>
    `;
    container.appendChild(div);
  });
}

function isDraftComplete(subjectId) {
  const draft = drafts[subjectId];
  if (!draft || !draft.scores) return false;
  return QUESTIONS.every(q => draft.scores[q.id] !== undefined);
}

// ══════════════════════════════════════════════════════════════
//  OPEN EVAL MODAL
// ══════════════════════════════════════════════════════════════
function openEval(idx) {
  currentIdx = idx;
  const sub  = subjects[idx];

  document.getElementById("modal-teacher").textContent  = sub.users?.name || "—";
  document.getElementById("modal-subject").textContent  = "Subject: " + sub.name;
  document.getElementById("modal-step-badge").textContent =
    `${idx + 1} of ${subjects.length}`;

  const draft = drafts[sub.id] || { scores: {}, comment: "" };

  // Restore comment
  document.getElementById("eval-comment").value = draft.comment || "";

  // ── Desktop table ──
  const tbody = document.getElementById("questions-tbody");
  tbody.innerHTML = "";
  let currentCategory = "";
  QUESTIONS.forEach((q, qIdx) => {
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
      <td class="question-text"><b>${qIdx + 1}.</b> ${q.text}</td>
      ${[5,4,3,2,1].map(n => `
        <td class="rating-cell">
          <input type="radio" name="${q.id}" value="${n}"
            ${draft.scores[q.id] === n ? "checked" : ""} />
        </td>
      `).join("")}
    `;
    tbody.appendChild(row);
  });

  // ── Mobile cards ──
  const mobileContainer = document.getElementById("mobile-questions-container");
  mobileContainer.innerHTML = "";
  currentCategory = "";
  QUESTIONS.forEach((q, qIdx) => {
    if (q.category !== currentCategory) {
      currentCategory = q.category;
      const div = document.createElement("div");
      div.className = "category-divider";
      div.textContent = q.category;
      mobileContainer.appendChild(div);
    }
    const card = document.createElement("div");
    card.className = "question-card";
    card.id = "mrow-" + q.id;
    card.innerHTML = `
      <div class="q-text"><b>${qIdx + 1}.</b> ${q.text}</div>
      <div class="q-ratings">
        ${[5,4,3,2,1].map(n => `
          <label class="q-rating-btn ${draft.scores[q.id] === n ? "selected" : ""}">
            <input type="radio" name="m_${q.id}" value="${n}"
              ${draft.scores[q.id] === n ? "checked" : ""}
              onchange="onMobileRate('${q.id}', ${n}, this)" />
            <span class="num">${n}</span>
          </label>
        `).join("")}
      </div>
    `;
    mobileContainer.appendChild(card);
  });

  // Live save on desktop radio change
  document.querySelectorAll("#questions-tbody input[type=radio]").forEach(r => {
    r.addEventListener("change", () => saveDraftFromModal());
  });

  document.getElementById("eval-modal").classList.remove("hidden");
}

function onMobileRate(qId, val, input) {
  // Update selected style on siblings
  const card = document.getElementById("mrow-" + qId);
  if (card) {
    card.querySelectorAll(".q-rating-btn").forEach(btn => btn.classList.remove("selected"));
    input.closest(".q-rating-btn").classList.add("selected");
  }
  saveDraftFromModal();
}
window.onMobileRate = onMobileRate;

// ══════════════════════════════════════════════════════════════
//  SAVE DRAFT FROM MODAL (live)
// ══════════════════════════════════════════════════════════════
function saveDraftFromModal() {
  if (currentIdx === null) return;
  const sub    = subjects[currentIdx];
  const scores = {};

  QUESTIONS.forEach(q => {
    // Desktop
    const checked = document.querySelector(`input[name="${q.id}"]:checked`);
    // Mobile
    const mChecked = document.querySelector(`input[name="m_${q.id}"]:checked`);
    const val = checked ? parseInt(checked.value) : (mChecked ? parseInt(mChecked.value) : undefined);
    if (val !== undefined) scores[q.id] = val;
  });

  const comment = document.getElementById("eval-comment").value.trim();
  drafts[sub.id] = { scores, comment };
  saveDraftsToStorage();
}

// ══════════════════════════════════════════════════════════════
//  NEXT BUTTON — save draft + close modal + refresh steps
// ══════════════════════════════════════════════════════════════
function onNext() {
  saveDraftFromModal();
  closeEvalModal();
  renderProgress();
}

function closeEvalModal() {
  document.getElementById("eval-modal").classList.add("hidden");
  currentIdx = null;
}

// ══════════════════════════════════════════════════════════════
//  REVIEW MODAL — show saved draft answers read-only
// ══════════════════════════════════════════════════════════════
function openReview(idx) {
  const sub   = subjects[idx];
  const draft = drafts[sub.id] || {};

  document.getElementById("review-teacher").textContent = sub.users?.name || "—";
  document.getElementById("review-subject").textContent = "Subject: " + sub.name;

  const content = document.getElementById("review-content");
  let html = "";
  let currentCategory = "";

  QUESTIONS.forEach((q, qIdx) => {
    if (q.category !== currentCategory) {
      currentCategory = q.category;
      html += `<div class="review-category">${q.category}</div>`;
    }
    const score = draft.scores?.[q.id] ?? "—";
    html += `
      <div class="review-answer">
        <span>${qIdx + 1}. ${escapeHtml(q.text)}</span>
        <span class="review-score">${score}</span>
      </div>
    `;
  });

  if (draft.comment) {
    html += `
      <div style="margin-top:14px; padding-top:14px; border-top:1px solid #e2e8f0;">
        <div class="review-category">Comment</div>
        <p style="font-size:13px; color:#475569; line-height:1.6;">${escapeHtml(draft.comment)}</p>
      </div>
    `;
  }

  content.innerHTML = html;
  document.getElementById("review-modal").classList.remove("hidden");
}

function closeReviewModal() {
  document.getElementById("review-modal").classList.add("hidden");
}

// Edit from review modal — open eval modal for that subject
document.getElementById("review-edit-btn").addEventListener("click", () => {
  // Find which subject the review is showing
  const teacherName = document.getElementById("review-teacher").textContent;
  const idx = subjects.findIndex(s => (s.users?.name || "—") === teacherName);
  closeReviewModal();
  if (idx !== -1) openEval(idx);
});

document.getElementById("review-close-btn").addEventListener("click", closeReviewModal);

// ══════════════════════════════════════════════════════════════
//  SUBMIT ALL — write all completed drafts to Supabase
// ══════════════════════════════════════════════════════════════
async function submitAll() {
  const toSubmit = subjects.filter(s => !submittedIds.has(s.id) && isDraftComplete(s.id));

  if (toSubmit.length === 0) {
    await fpAlert("No completed evaluations to submit.", "info");
    return;
  }

  const btn = document.getElementById("submit-all-btn");
  btn.textContent = "Submitting...";
  btn.disabled    = true;

  let successCount = 0;
  let failCount    = 0;

  for (const sub of toSubmit) {
    const draft = drafts[sub.id];
    try {
      // Step 1: Tracking (guard against double submit)
      const { error: trackError } = await supabase
        .from("evaluation_tracking")
        .insert({
          student_id:  studentId,
          subject_id:  sub.id,
          semester_id: activeSemId,
        });

      if (trackError) {
        if (trackError.code === "23505") {
          // Already submitted — mark done and continue
          submittedIds.add(sub.id);
          delete drafts[sub.id];
          successCount++;
          continue;
        }
        throw new Error(trackError.message);
      }

      // Step 2: Scores (identity-free)
      const { error: scoreError } = await supabase
        .from("evaluation_scores")
        .insert({
          subject_id:  sub.id,
          semester_id: activeSemId,
          scores:      draft.scores,
        });

      if (scoreError) {
        // Rollback tracking
        await supabase.from("evaluation_tracking").delete()
          .eq("student_id",  studentId)
          .eq("subject_id",  sub.id)
          .eq("semester_id", activeSemId);
        throw new Error(scoreError.message);
      }

      // Step 3: Comment (best-effort, identity-free)
      if (draft.comment) {
        await supabase.from("evaluation_comments").insert({
          subject_id:  sub.id,
          semester_id: activeSemId,
          comment:     draft.comment,
        });
      }

      submittedIds.add(sub.id);
      delete drafts[sub.id];
      successCount++;

    } catch (err) {
      console.error("Failed to submit", sub.name, err);
      failCount++;
    }
  }

  saveDraftsToStorage();

  btn.textContent = "Submit All Evaluations";
  btn.disabled    = false;

  if (failCount > 0) {
    await fpAlert(
      `${successCount} evaluation(s) submitted successfully.\n${failCount} failed — please try again.`,
      "error"
    );
  } else {
    await fpAlert(
      `All ${successCount} evaluation(s) submitted successfully!\n\nThank you. Your responses are recorded anonymously.`,
      "success"
    );
  }

  renderProgress();
}

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Expose to HTML ──
window.openEval   = openEval;
window.openReview = openReview;

// ── Change Email Request ──
const REAL_NAME_EMAIL = /^[a-zA-Z][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

document.getElementById("change-email-btn")?.addEventListener("click", () => {
  document.getElementById("ce-email").value       = "";
  document.getElementById("ce-reason").value      = "";
  document.getElementById("ce-error").textContent = "";
  document.getElementById("ce-success").style.display = "none";
  document.getElementById("ce-submit-btn").style.display = "inline-block";
  document.getElementById("change-email-modal").classList.remove("hidden");
});

document.getElementById("ce-cancel-btn")?.addEventListener("click", () => {
  document.getElementById("change-email-modal").classList.add("hidden");
});

document.getElementById("ce-submit-btn")?.addEventListener("click", async () => {
  const email  = document.getElementById("ce-email").value.trim();
  const reason = document.getElementById("ce-reason").value.trim();
  const errEl  = document.getElementById("ce-error");
  const btn    = document.getElementById("ce-submit-btn");
  errEl.textContent = "";

  // Real-name email check: local part must be at least 2 chars and look like a name
  // Rejects: admin@, test@, 12345@, a@
  const localPart = email.split("@")[0] || "";
  const looksGeneric = /^(admin|test|info|user|noreply|no-reply|\d+)$/i.test(localPart);

  if (!email)                       { errEl.textContent = "Email address is required."; return; }
  if (!REAL_NAME_EMAIL.test(email)) { errEl.textContent = "Enter a valid email address."; return; }
  if (localPart.length < 4)         { errEl.textContent = "Use a real-name email (e.g. juandelacruz@gmail.com)."; return; }
  if (looksGeneric)                  { errEl.textContent = "Generic email addresses are not accepted. Use your real name."; return; }
  if (!reason || reason.length < 10){ errEl.textContent = "Please provide a reason (at least 10 characters)."; return; }

  btn.textContent = "Submitting...";
  btn.disabled    = true;

  const studentUserId = sessionStorage.getItem("userId");
  const currentEmail  = sessionStorage.getItem("email") || "";

  const { error } = await supabase
    .from("email_change_requests")
    .insert({
      student_id:      studentUserId,
      current_email:   currentEmail,
      requested_email: email,
      reason:          reason,
      status:          "pending",
    });

  btn.textContent = "Submit Request";
  btn.disabled    = false;

  if (error) {
    errEl.textContent = "Failed to submit: " + error.message;
    return;
  }

  document.getElementById("ce-success").style.display = "block";
  btn.style.display = "none";
});

// ── Events ──
document.getElementById("next-btn").addEventListener("click", onNext);
document.getElementById("cancel-btn").addEventListener("click", () => {
  saveDraftFromModal();
  closeEvalModal();
  renderProgress();
});
document.getElementById("submit-all-btn").addEventListener("click", submitAll);
document.getElementById("logout-btn").addEventListener("click", (e) => {
  e.preventDefault();
  supabase.auth.signOut();
  sessionStorage.clear();
  window.location.href = "../index.html";
});

// ── Init ──
init();