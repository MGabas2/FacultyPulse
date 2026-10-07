// ============================================================
//  FacultyPulse — Executive Summary Dashboard
//  For the School President, Vice President, and Director of
//  Instruction (or anyone else given the "executive" role).
//
//  Deliberately READ-ONLY and AGGREGATE-ONLY: no editing, no
//  per-student raw scores, no comments (evaluation_comments is
//  identity-free per CMO §6.10 but is still qualitative/sensitive
//  text — out of scope for a program-level summary view). This
//  page only ever computes and shows averages grouped by program.
// ============================================================

import { supabase } from "./supabase.js";

// ── Guard ──
if (!sessionStorage.getItem("role") || sessionStorage.getItem("role") !== "executive") {
  window.location.href = "../index.html";
}

const name = sessionStorage.getItem("name");
document.getElementById("nav-user").textContent = "Logged in as: " + name;

// CMO No. 19 s.2025 SEF rating bands — kept in sync with js/admin.js,
// teacher.js, supervisor.js (each page keeps its own copy; no shared
// module in this codebase). If you change one, change all four.
function getRatingLabel(score) {
  if (score >= 96) return "Outstanding";
  if (score >= 91) return "Very Satisfactory";
  if (score >= 86) return "Satisfactory";
  if (score >= 80) return "Developing";
  return "Needs Improvement";
}
function getRatingColor(score) {
  if (score >= 96) return "#10b981";
  if (score >= 91) return "#3b82f6";
  if (score >= 86) return "#f59e0b";
  if (score >= 80) return "#f97316";
  return "#ef4444";
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ══════════════════════════════════════════════════════════════
//  SEMESTER SELECTOR
// ══════════════════════════════════════════════════════════════
async function populateSemesters() {
  const sel = document.getElementById("exec-semester-filter");
  const { data: sems, error } = await supabase
    .from("semesters").select("id, label, is_active").order("label", { ascending: false });

  if (error || !sems || sems.length === 0) {
    sel.innerHTML = `<option value="">No semesters found</option>`;
    return null;
  }

  sel.innerHTML = sems
    .map(s => `<option value="${s.id}">${escHtml(s.label)}${s.is_active ? " (active)" : ""}</option>`)
    .join("");

  const activeSem = sems.find(s => s.is_active) || sems[0];
  sel.value = activeSem.id;
  return activeSem.id;
}

// ══════════════════════════════════════════════════════════════
//  LOAD + AGGREGATE
// ══════════════════════════════════════════════════════════════
async function loadProgramSummary(semesterId) {
  const container = document.getElementById("program-summary-container");
  container.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading…</p></div>`;

  if (!semesterId) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No semester selected.</p></div>`;
    resetCards();
    return;
  }

  // ── Subjects for this semester, with their program (sections.department)
  //    and teacher, so each subject can be bucketed by program. ──
  const { data: subjects, error: subjError } = await supabase
    .from("subjects")
    .select("id, teacher_id, enrolled_count, sections(department)")
    .eq("semester_id", semesterId);

  if (subjError) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading subjects: ${escHtml(subjError.message)}</p></div>`;
    resetCards();
    return;
  }

  const subjectsWithTeacher = (subjects || []).filter(s => s.teacher_id && s.sections?.department);

  if (subjectsWithTeacher.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No subjects with an assigned teacher yet for this semester.</p></div>`;
    resetCards();
    return;
  }

  // ── Raw evaluation_scores for this semester, in one query — then group
  //    client-side by subject_id. Fetching per-subject (like the Teacher
  //    Trends chart does for a single teacher) would be one query per
  //    subject here, which doesn't scale to an institution-wide summary. ──
  const { data: scores, error: scoreError } = await supabase
    .from("evaluation_scores")
    .select("subject_id, scores")
    .eq("semester_id", semesterId);

  if (scoreError) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading evaluation scores: ${escHtml(scoreError.message)}</p></div>`;
    resetCards();
    return;
  }

  const scoresBySubject = new Map();
  (scores || []).forEach(row => {
    if (!scoresBySubject.has(row.subject_id)) scoresBySubject.set(row.subject_id, []);
    scoresBySubject.get(row.subject_id).push(row.scores);
  });

  // ── Bucket by program ──
  const programs = new Map(); // program -> { ratings: [], teacherIds: Set, subjectIds: Set }
  subjectsWithTeacher.forEach(s => {
    const program = s.sections.department;
    if (!programs.has(program)) {
      programs.set(program, { ratings: [], teacherIds: new Set(), subjectIds: new Set() });
    }
    const bucket = programs.get(program);
    bucket.teacherIds.add(s.teacher_id);
    bucket.subjectIds.add(s.id);

    const rowsForSubject = scoresBySubject.get(s.id) || [];
    rowsForSubject.forEach(scoreObj => {
      const total  = Object.values(scoreObj || {}).reduce((sum, v) => sum + (v || 0), 0);
      const rating = (total / 75) * 100; // CMO No. 19 Annex A formula, 15 questions x 5 max = 75
      bucket.ratings.push(rating);
    });
  });

  // ── Render ──
  const rows = [...programs.entries()]
    .map(([program, b]) => ({
      program,
      faculty:     b.teacherIds.size,
      subjects:    b.subjectIds.size,
      respondents: b.ratings.length,
      avg:         b.ratings.length > 0 ? b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length : null,
    }))
    .sort((a, b) => a.program.localeCompare(b.program));

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No evaluation data for this semester yet.</p></div>`;
    resetCards();
    return;
  }

  container.innerHTML = `
    <table class="exec-table">
      <thead>
        <tr>
          <th>Program</th>
          <th>Faculty</th>
          <th>Subjects</th>
          <th>Respondents</th>
          <th>Average Rating</th>
          <th>CMO Interpretation</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><b>${escHtml(r.program)}</b></td>
            <td>${r.faculty}</td>
            <td>${r.subjects}</td>
            <td>${r.respondents}</td>
            <td>${r.avg !== null ? r.avg.toFixed(2) : "—"}</td>
            <td>${r.avg !== null
              ? `<span class="rating-pill" style="background:${getRatingColor(r.avg)};">${getRatingLabel(r.avg)}</span>`
              : `<span style="color:var(--mist); font-size:12px;">No respondents yet</span>`}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // ── Summary cards ──
  const allRatings    = rows.flatMap(r => programs.get(r.program).ratings);
  const totalFaculty   = new Set(subjectsWithTeacher.map(s => s.teacher_id)).size;
  const totalRespond   = allRatings.length;
  const overallAvg     = totalRespond > 0 ? allRatings.reduce((s, v) => s + v, 0) / totalRespond : null;

  document.getElementById("count-programs").textContent    = rows.length;
  document.getElementById("count-faculty").textContent     = totalFaculty;
  document.getElementById("count-respondents").textContent = totalRespond;
  document.getElementById("count-overall").textContent     = overallAvg !== null ? overallAvg.toFixed(2) : "—";
}

function resetCards() {
  ["count-programs", "count-faculty", "count-respondents", "count-overall"].forEach(id => {
    document.getElementById(id).textContent = "—";
  });
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
(async function init() {
  const activeSemId = await populateSemesters();
  await loadProgramSummary(activeSemId);
})();

document.getElementById("exec-semester-filter")?.addEventListener("change", (e) => {
  loadProgramSummary(e.target.value);
});

// ── Change Password (same pattern as teacher/supervisor/admin) ──
document.getElementById("change-password-btn")?.addEventListener("click", () => {
  document.getElementById("cp-new").value         = "";
  document.getElementById("cp-confirm").value     = "";
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
  btn.textContent = "Saving..."; btn.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: newPw });
  btn.textContent = "Save Password"; btn.disabled = false;
  if (error) { errEl.textContent = "Failed: " + error.message; return; }
  document.getElementById("change-password-modal").classList.add("hidden");
  alert("Password changed successfully.");
});
