// ============================================================
//  FacultyPulse — Executive Summary Dashboard
//  For the School President, Vice President, and Director of
//  Instruction (or anyone else given the "executive" role).
//
//  READ-ONLY and RELEASED-ONLY: a faculty report only ever shows up
//  here once report_releases.stage === "released" — same bar as the
//  faculty's own dashboard (teacher.js). No editing, no per-student
//  identity, no release/forward actions — those stay on Admin.
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

function ratingCell(value) {
  return value !== null && value !== undefined ? value.toFixed(2) : "—";
}

// ══════════════════════════════════════════════════════════════
//  STATE — the last-loaded faculty rows (unfiltered) and the
//  currently-active program filter, so a program-row click can
//  re-render the faculty table without re-querying the DB.
// ══════════════════════════════════════════════════════════════
let currentSemesterId   = null;
let currentFacultyRows  = [];
let currentProgramFilter = null;

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
  currentSemesterId    = semesterId;
  currentProgramFilter = null;
  hideFilterChip();

  const container = document.getElementById("program-summary-container");
  container.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading…</p></div>`;

  if (!semesterId) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No semester selected.</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
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
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  const subjectsWithTeacher = (subjects || []).filter(s => s.teacher_id && s.sections?.department);

  if (subjectsWithTeacher.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No subjects with an assigned teacher yet for this semester.</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  // ── Release gate: Executive only ever sees RELEASED reports — same bar as
  //    the faculty's own dashboard (teacher.js gates on stage === "released").
  //    A report still at "pending" / "forwarded_to_supervisor" / "supervisor_done"
  //    must NOT contribute to any average the Executive sees, program or individual. ──
  const { data: releases, error: releaseError } = await supabase
    .from("report_releases")
    .select("teacher_id, stage")
    .eq("semester_id", semesterId)
    .eq("stage", "released");

  if (releaseError) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading report releases: ${escHtml(releaseError.message)}</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  const releasedTeacherIds = new Set((releases || []).map(r => r.teacher_id));
  const releasedSubjects   = subjectsWithTeacher.filter(s => releasedTeacherIds.has(s.teacher_id));

  if (releasedSubjects.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No faculty reports have been released for this semester yet.</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  // ── Raw evaluation_scores (SET) for this semester, in one query — then
  //    group client-side by subject_id. One query per subject would not
  //    scale to an institution-wide summary. ──
  const { data: scores, error: scoreError } = await supabase
    .from("evaluation_scores")
    .select("subject_id, scores")
    .eq("semester_id", semesterId);

  if (scoreError) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading evaluation scores: ${escHtml(scoreError.message)}</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  // ── Latest SEF score per released teacher (supervisor_remarks.sef_score).
  //    A teacher may have several supervisor_remarks rows over time; take
  //    the most recent by submitted_at, same as admin.js's viewReport(). ──
  const { data: sefRows, error: sefError } = await supabase
    .from("supervisor_remarks")
    .select("teacher_id, sef_score, submitted_at")
    .eq("semester_id", semesterId)
    .in("teacher_id", [...releasedTeacherIds])
    .order("submitted_at", { ascending: false });

  if (sefError) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading SEF scores: ${escHtml(sefError.message)}</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  const sefByTeacher = new Map(); // teacher_id -> latest sef_score (or undefined if never a number)
  (sefRows || []).forEach(r => {
    if (!sefByTeacher.has(r.teacher_id) && r.sef_score != null) {
      sefByTeacher.set(r.teacher_id, Number(r.sef_score));
    }
  });

  const scoresBySubject = new Map();
  (scores || []).forEach(row => {
    if (!scoresBySubject.has(row.subject_id)) scoresBySubject.set(row.subject_id, []);
    scoresBySubject.get(row.subject_id).push(row.scores);
  });

  // ── Bucket by program (released subjects only) ──
  const programs = new Map(); // program -> { ratings: [], teacherIds: Set, subjectIds: Set }
  // ── Bucket by teacher too, for the individual faculty table below ──
  const faculty = new Map(); // teacher_id -> { ratings: [], programs: Set, subjectIds: Set }

  releasedSubjects.forEach(s => {
    const program = s.sections.department;
    if (!programs.has(program)) {
      programs.set(program, { ratings: [], teacherIds: new Set(), subjectIds: new Set() });
    }
    const bucket = programs.get(program);
    bucket.teacherIds.add(s.teacher_id);
    bucket.subjectIds.add(s.id);

    if (!faculty.has(s.teacher_id)) {
      faculty.set(s.teacher_id, { ratings: [], programs: new Set(), subjectIds: new Set() });
    }
    const fBucket = faculty.get(s.teacher_id);
    fBucket.programs.add(program);
    fBucket.subjectIds.add(s.id);

    const rowsForSubject = scoresBySubject.get(s.id) || [];
    rowsForSubject.forEach(scoreObj => {
      const total  = Object.values(scoreObj || {}).reduce((sum, v) => sum + (v || 0), 0);
      const rating = (total / 75) * 100; // CMO No. 19 Annex A formula, 15 questions x 5 max = 75
      bucket.ratings.push(rating);
      fBucket.ratings.push(rating);
    });
  });

  // ── Program rows: SET Rating (mean of student submissions) + SEF Rating
  //    (mean of each program's teachers' latest SEF score, released only) ──
  const rows = [...programs.entries()]
    .map(([program, b]) => {
      const sefValues = [...b.teacherIds].map(id => sefByTeacher.get(id)).filter(v => v != null);
      return {
        program,
        faculty:     b.teacherIds.size,
        subjects:    b.subjectIds.size,
        respondents: b.ratings.length,
        setRating:   b.ratings.length > 0 ? b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length : null,
        sefRating:   sefValues.length > 0 ? sefValues.reduce((s, v) => s + v, 0) / sefValues.length : null,
      };
    })
    .sort((a, b) => a.program.localeCompare(b.program));

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No evaluation data for this semester yet.</p></div>`;
    resetCards();
    currentFacultyRows = [];
    renderFacultyTable([]);
    return;
  }

  renderProgramTable(container, rows);

  // ── Summary cards (released-only, matches the tables) ──
  const allRatings  = rows.flatMap(r => programs.get(r.program).ratings);
  const totalFaculty = faculty.size;
  const totalRespond = allRatings.length;
  const overallAvg   = totalRespond > 0 ? allRatings.reduce((s, v) => s + v, 0) / totalRespond : null;

  document.getElementById("count-programs").textContent    = rows.length;
  document.getElementById("count-faculty").textContent     = totalFaculty;
  document.getElementById("count-respondents").textContent = totalRespond;
  document.getElementById("count-overall").textContent     = overallAvg !== null ? overallAvg.toFixed(2) : "—";

  // ── Individual faculty reports (released only) ──
  const { data: teacherRows, error: teacherError } = await supabase
    .from("users")
    .select("id, name")
    .in("id", [...faculty.keys()]);

  if (teacherError) {
    currentFacultyRows = [];
    renderFacultyTable([], teacherError.message);
    return;
  }

  const nameById = new Map((teacherRows || []).map(t => [t.id, t.name]));
  const facultyRows = [...faculty.entries()]
    .map(([teacherId, b]) => ({
      teacherId,
      name:        nameById.get(teacherId) || "(unknown)",
      programs:    [...b.programs].sort(),
      subjects:    b.subjectIds.size,
      respondents: b.ratings.length,
      setRating:   b.ratings.length > 0 ? b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length : null,
      sefRating:   sefByTeacher.get(teacherId) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  currentFacultyRows = facultyRows;
  renderFacultyTable(facultyRows);
}

// ══════════════════════════════════════════════════════════════
//  RENDER — Program table (click a row to filter faculty below)
// ══════════════════════════════════════════════════════════════
function renderProgramTable(container, rows) {
  container.innerHTML = `
    <table class="exec-table">
      <thead>
        <tr>
          <th>Program</th>
          <th>Faculty</th>
          <th>Subjects</th>
          <th>Respondents</th>
          <th>SET Rating</th>
          <th>SEF Rating</th>
          <th>CMO Interpretation</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr data-program="${escHtml(r.program)}" title="Click to filter faculty by this program">
            <td><b>${escHtml(r.program)}</b></td>
            <td>${r.faculty}</td>
            <td>${r.subjects}</td>
            <td>${r.respondents}</td>
            <td>${ratingCell(r.setRating)}</td>
            <td>${ratingCell(r.sefRating)}</td>
            <td>${r.setRating !== null
              ? `<span class="rating-pill" style="background:${getRatingColor(r.setRating)};">${getRatingLabel(r.setRating)}</span>`
              : `<span style="color:var(--mist); font-size:12px;">No respondents yet</span>`}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ══════════════════════════════════════════════════════════════
//  RENDER — Individual faculty table (click a row to open report)
// ══════════════════════════════════════════════════════════════
function renderFacultyTable(facultyRows, errorMessage) {
  const container = document.getElementById("faculty-report-container");
  if (!container) return; // guard if executive.html hasn't been redeployed with this section yet

  if (errorMessage) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Error loading faculty names: ${escHtml(errorMessage)}</p></div>`;
    return;
  }

  if (!facultyRows || facultyRows.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No released faculty reports for this semester yet.</p></div>`;
    return;
  }

  container.innerHTML = `
    <table class="exec-table">
      <thead>
        <tr>
          <th>Faculty</th>
          <th>Program(s)</th>
          <th>Subjects</th>
          <th>Respondents</th>
          <th>SET Rating</th>
          <th>SEF Rating</th>
          <th>CMO Interpretation</th>
        </tr>
      </thead>
      <tbody>
        ${facultyRows.map(r => `
          <tr data-teacher-id="${escHtml(r.teacherId)}" data-teacher-name="${escHtml(r.name)}" title="Click to open full report">
            <td><b>${escHtml(r.name)}</b></td>
            <td>${escHtml(r.programs.join(", "))}</td>
            <td>${r.subjects}</td>
            <td>${r.respondents}</td>
            <td>${ratingCell(r.setRating)}</td>
            <td>${ratingCell(r.sefRating)}</td>
            <td>${r.setRating !== null
              ? `<span class="rating-pill" style="background:${getRatingColor(r.setRating)};">${getRatingLabel(r.setRating)}</span>`
              : `<span style="color:var(--mist); font-size:12px;">No respondents yet</span>`}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ══════════════════════════════════════════════════════════════
//  PROGRAM → FACULTY FILTER CHIP
// ══════════════════════════════════════════════════════════════
function showFilterChip(program) {
  const chip = document.getElementById("faculty-filter-chip");
  const text = document.getElementById("faculty-filter-text");
  if (!chip || !text) return;
  text.textContent = `Showing faculty in: ${program}`;
  chip.style.display = "flex";
}
function hideFilterChip() {
  const chip = document.getElementById("faculty-filter-chip");
  if (chip) chip.style.display = "none";
}
function filterFacultyByProgram(program) {
  currentProgramFilter = program;
  showFilterChip(program);
  const filtered = currentFacultyRows.filter(r => r.programs.includes(program));
  renderFacultyTable(filtered);
  document.getElementById("faculty-report-container")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clearFacultyFilter() {
  currentProgramFilter = null;
  hideFilterChip();
  renderFacultyTable(currentFacultyRows);
}

function resetCards() {
  ["count-programs", "count-faculty", "count-respondents", "count-overall"].forEach(id => {
    document.getElementById(id).textContent = "—";
  });
}

// ══════════════════════════════════════════════════════════════
//  WEIGHTED SET COMPUTATION — CMO No. 19 Annex C
//  (duplicated from js/admin.js's computeWeightedSET — no shared
//  module in this codebase; keep both in sync if the formula changes)
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

  const classData = [];
  let totalWeighted    = 0;
  let totalEnrolled    = 0;

  for (const { subject, evals } of subjectResults) {
    if (evals.length === 0) {
      classData.push({
        course: subject.name, section: subject.sections?.name || "—",
        noStudents: subject.enrolled_count || 0, avgSETRating: 0, weightedScore: 0, respondents: 0,
      });
      continue;
    }

    let sumRatings = 0;
    evals.forEach(e => {
      const totalScore = Object.values(e.scores).reduce((s, v) => s + v, 0);
      const rating     = (totalScore / 75) * 100;
      sumRatings      += rating;

      const catA = ["q1","q2","q3","q4","q5","q6"].reduce((s,k) => s + (e.scores[k] || 0), 0);
      const catB = ["q7","q8","q9","q10","q11"].reduce((s,k) => s + (e.scores[k] || 0), 0);
      const catC = ["q12","q13","q14","q15"].reduce((s,k) => s + (e.scores[k] || 0), 0);
      catTotals.A += (catA / 30) * 100;
      catTotals.B += (catB / 25) * 100;
      catTotals.C += (catC / 20) * 100;
      catCounts.A++; catCounts.B++; catCounts.C++;
    });

    const respondents  = evals.length;
    const avgSETRating = parseFloat((sumRatings / respondents).toFixed(2));
    let enrolled = subject.enrolled_count || 0;
    if (enrolled < respondents) enrolled = respondents;
    const weightedScore = parseFloat((enrolled * avgSETRating).toFixed(2));

    classData.push({ course: subject.name, section: subject.sections?.name || "—", noStudents: enrolled, avgSETRating, weightedScore, respondents });
    totalWeighted += weightedScore;
    totalEnrolled += enrolled;
  }

  const overallSET = totalEnrolled > 0 ? parseFloat((totalWeighted / totalEnrolled).toFixed(2)) : 0;
  const avgA = catCounts.A > 0 ? parseFloat((catTotals.A / catCounts.A).toFixed(2)) : 0;
  const avgB = catCounts.B > 0 ? parseFloat((catTotals.B / catCounts.B).toFixed(2)) : 0;
  const avgC = catCounts.C > 0 ? parseFloat((catTotals.C / catCounts.C).toFixed(2)) : 0;

  return { overallSET, classData, totalEnrolled, totalWeighted, avgA, avgB, avgC, subjects };
}

// ══════════════════════════════════════════════════════════════
//  INDIVIDUAL FACULTY REPORT — Annex C & D, read-only
//  (trimmed from admin.js's viewReport(): no release/forward
//  buttons, no editable comment rows, no blank signature tables —
//  those belong to the Admin/Supervisor signing workflow, not an
//  executive's informational view. Only ever called for a teacher
//  already confirmed released, via the faculty-table click handler.)
// ══════════════════════════════════════════════════════════════
async function openFacultyReport(teacherId, teacherName) {
  const reportContent = document.getElementById("exec-report-content");
  reportContent.innerHTML = `<p style="text-align:center; color:#64748b;">Loading report...</p>`;
  document.getElementById("exec-report-modal").classList.remove("hidden");

  const semesterId = currentSemesterId;
  const { data: semester } = await supabase
    .from("semesters").select("id, label").eq("id", semesterId).maybeSingle();

  if (!semester) {
    reportContent.innerHTML = `<p>Semester not found.</p>`;
    return;
  }

  const [
    { data: teacher },
    { data: deptSubject },
    result,
    { data: supRemarks },
    { data: fedaf },
  ] = await Promise.all([
    supabase.from("users").select("name, academic_rank").eq("id", teacherId).single(),
    supabase.from("subjects").select("sections(department)").eq("teacher_id", teacherId).eq("semester_id", semesterId).limit(1).maybeSingle(),
    computeWeightedSET(teacherId, semesterId),
    supabase.from("supervisor_remarks").select("sef_score, comments, remarks")
      .eq("teacher_id", teacherId).eq("semester_id", semesterId)
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("fedaf").select("areas_improvement, proposed_activities, action_plan, supervisor_signed")
      .eq("teacher_id", teacherId).eq("semester_id", semesterId).maybeSingle(),
  ]);

  const department = deptSubject?.sections?.department || "—";

  if (!result) {
    reportContent.innerHTML = `<p>No evaluation data found for this faculty.</p>`;
    return;
  }

  const { overallSET, classData, totalEnrolled, totalWeighted, avgA, avgB, avgC } = result;
  const sefRating = supRemarks?.sef_score != null ? Number(supRemarks.sef_score).toFixed(2) : "—";

  const subjectIds = (result.subjects || []).map(s => s.id);
  let studentComments = [];
  if (subjectIds.length > 0) {
    const { data: rawComments } = await supabase
      .from("evaluation_comments")
      .select("comment")
      .in("subject_id", subjectIds)
      .eq("semester_id", semesterId);
    studentComments = (rawComments || []).map(r => r.comment?.trim()).filter(Boolean);
  }

  reportContent.innerHTML = `
    <div style="font-family: Arial, sans-serif; font-size: 12px; color: #000; line-height: 1.4;">

      <h3 style="text-align:center; font-size:13px; font-weight:bold; margin-bottom:16px; text-transform:uppercase; letter-spacing:.02em;">
        Individual Faculty Evaluation Report
      </h3>

      <!-- A. Faculty Information -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">A. Faculty Information</p>
      <table style="width:100%; font-size:12px; margin-bottom:16px; border-collapse:collapse;">
        <tr><td style="width:42%; padding:3px 0; border:none;">Name of Faculty Evaluated</td><td style="padding:3px 0; font-weight:bold; border:none;">: ${escHtml(teacher?.name || teacherName)}</td></tr>
        <tr><td style="padding:3px 0; border:none;">Department/College</td><td style="padding:3px 0; border:none;">: ${escHtml(department)}</td></tr>
        <tr><td style="padding:3px 0; border:none;">Current Faculty Rank</td><td style="padding:3px 0; border:none;">: ${escHtml(teacher?.academic_rank || "—")}</td></tr>
        <tr><td style="padding:3px 0; border:none;">Semester/Term &amp; Academic Year</td><td style="padding:3px 0; border:none;">: ${escHtml(semester.label)}</td></tr>
      </table>

      <!-- B. Summary of Average SET Rating -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">B. Summary of Average SET Rating</p>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:10px;">
        <thead>
          <tr>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Seq</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Course Code</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Year/Section</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">No. of Students</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Average SET Rating</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Weighted SET Score</th>
          </tr>
        </thead>
        <tbody>
          ${classData.map((c, i) => `
            <tr>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center;">${i + 1}</td>
              <td style="padding:7px 8px; border:1px solid #000; font-style:italic;">${escHtml(c.course)}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center;">${escHtml(c.section)}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center;">${c.noStudents}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center;">${c.avgSETRating.toFixed(2)}</td>
              <td style="padding:7px 8px; border:1px solid #000; text-align:center;">${c.weightedScore.toFixed(2)}</td>
            </tr>
          `).join("")}
          <tr>
            <td colspan="3" style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">TOTAL</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">${totalEnrolled}</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">TOTAL</td>
            <td style="padding:7px 8px; border:1px solid #000; text-align:center; font-weight:bold;">${totalWeighted.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <!-- C. SET and SEF Ratings -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">C. SET and SEF Ratings</p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <thead>
          <tr>
            <th style="padding:8px 10px; border:1px solid #000; width:40%;"></th>
            <th style="padding:8px 10px; border:1px solid #000; text-align:center;">SET Rating</th>
            <th style="padding:8px 10px; border:1px solid #000; text-align:center;">SEF Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px; border:1px solid #000; font-weight:bold;">OVERALL RATING</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px;">${overallSET.toFixed(2)}</td>
            <td style="padding:10px; border:1px solid #000; text-align:center; font-weight:bold; font-size:15px;">${sefRating}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:10px; margin-bottom:16px; font-style:italic;">*Note: SEF rating is given by the supervisor using the SEF instrument.</p>

      <!-- Category Breakdown -->
      <p style="font-size:11px; font-weight:bold; margin-bottom:6px;">Category Breakdown</p>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="padding:6px 8px; border:1px solid #000; text-align:left;">Category</th>
            <th style="padding:6px 8px; border:1px solid #000; text-align:center;">Score</th>
            <th style="padding:6px 8px; border:1px solid #000; text-align:center;">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000;">A. Management of Teaching and Learning</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center;">${avgA.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgA)}; font-weight:600;">${getRatingLabel(avgA)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000;">B. Content Knowledge, Pedagogy and Technology</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center;">${avgB.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgB)}; font-weight:600;">${getRatingLabel(avgB)}</td>
          </tr>
          <tr>
            <td style="padding:6px 8px; border:1px solid #000;">C. Commitment and Transparency</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center;">${avgC.toFixed(2)}</td>
            <td style="padding:6px 8px; border:1px solid #000; text-align:center; color:${getRatingColor(avgC)}; font-weight:600;">${getRatingLabel(avgC)}</td>
          </tr>
        </tbody>
      </table>

      <!-- D. Summary of Qualitative Comments and Suggestions -->
      <p style="font-weight:bold; font-size:12px; margin-bottom:4px;">D. Summary of Qualitative Comments and Suggestions</p>
      <p style="font-size:10px; font-style:italic; margin-bottom:8px;">Comments shown exactly as submitted, without student identity, per CMO §6.10.</p>
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center; width:40px;">Seq</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Comments and Suggestions from the Students</th>
          </tr>
        </thead>
        <tbody>
          ${studentComments.length > 0
            ? studentComments.map((c, i) => `
              <tr>
                <td style="padding:14px 8px; border:1px solid #000; text-align:center;">${i + 1}</td>
                <td style="padding:14px 8px; border:1px solid #000;">${escHtml(c)}</td>
              </tr>`).join("")
            : `<tr><td colspan="2" style="padding:14px 8px; border:1px solid #000; text-align:center; font-style:italic;">No student comments submitted for this faculty this semester.</td></tr>`}
        </tbody>
      </table>

      <!-- Supervisor comments -->
      <table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
        <thead>
          <tr>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center; width:40px;">Seq</th>
            <th style="padding:7px 8px; border:1px solid #000; text-align:center;">Comments and Suggestions from the Supervisor</th>
          </tr>
        </thead>
        <tbody>
          ${(() => {
            const lines = supRemarks?.comments
              ? supRemarks.comments.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
              : [];
            if (lines.length === 0) {
              return `<tr><td colspan="2" style="padding:14px 8px; border:1px solid #000; text-align:center; font-style:italic;">No supervisor comments submitted.</td></tr>`;
            }
            return lines.map((line, i) => `
              <tr>
                <td style="padding:14px 8px; border:1px solid #000; text-align:center;">${i + 1}</td>
                <td style="padding:14px 8px; border:1px solid #000;">${escHtml(line)}</td>
              </tr>`).join("");
          })()}
        </tbody>
      </table>

      <!-- ANNEX D — FEDAF (read-only summary; signatures live on the official Admin/Supervisor copy) -->
      <div id="exec-annex-d-section" style="page-break-before:always; padding-top:8px;">
        <h3 style="text-align:center; font-size:12px; font-weight:bold; margin-bottom:16px; text-transform:uppercase; letter-spacing:.02em;">
          Faculty Evaluation and Development Acknowledgment Form
        </h3>

        <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">A. FACULTY MEMBER INFORMATION</p>
        <table style="width:100%; font-size:12px; margin-bottom:16px; border-collapse:collapse;">
          <tr><td style="width:42%; padding:3px 0; border:none;">Name of Faculty</td><td style="padding:3px 0; font-weight:bold; border:none;">: ${escHtml(teacher?.name || teacherName)}</td></tr>
          <tr><td style="padding:3px 0; border:none;">Department/College</td><td style="padding:3px 0; border:none;">: ${escHtml(department)}</td></tr>
          <tr><td style="padding:3px 0; border:none;">Current Faculty Rank</td><td style="padding:3px 0; border:none;">: ${escHtml(teacher?.academic_rank || "—")}</td></tr>
          <tr><td style="padding:3px 0; border:none;">Semester/Term &amp; Academic Year</td><td style="padding:3px 0; border:none;">: ${escHtml(semester.label)}</td></tr>
        </table>

        <p style="font-weight:bold; font-size:12px; margin-bottom:8px;">B. FACULTY EVALUATION SUMMARY</p>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:16px;">
          <thead>
            <tr>
              <th style="padding:7px 10px; border:1px solid #000; text-align:center; width:50%;">Student Evaluation of Teachers (SET)</th>
              <th style="padding:7px 10px; border:1px solid #000; text-align:center; width:50%;">Supervisor's Evaluation of Faculty (SEF)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:14px 10px; border:1px solid #000; text-align:center; font-size:20px; font-weight:bold;">${overallSET.toFixed(2)}</td>
              <td style="padding:14px 10px; border:1px solid #000; text-align:center; font-size:20px; font-weight:bold;">${sefRating}</td>
            </tr>
          </tbody>
        </table>

        <p style="font-weight:bold; font-size:12px; margin-bottom:4px;">
          C. DEVELOPMENT PLAN <span style="font-weight:normal; font-size:11px;">(jointly accomplished by Supervisor and Faculty)</span>
        </p>
        ${fedaf?.supervisor_signed
          ? `<table style="width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px;">
               <tr><td style="border:1px solid #000; padding:8px 10px; width:30%; vertical-align:top; font-weight:bold;">Areas for Improvement</td><td style="border:1px solid #000; padding:8px 10px; vertical-align:top;">${escHtml(fedaf.areas_improvement || "")}</td></tr>
               <tr><td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold;">Proposed Learning and Development Activities</td><td style="border:1px solid #000; padding:8px 10px; vertical-align:top;">${escHtml(fedaf.proposed_activities || "")}</td></tr>
               <tr><td style="border:1px solid #000; padding:8px 10px; vertical-align:top; font-weight:bold;">Action Plan</td><td style="border:1px solid #000; padding:8px 10px; vertical-align:top;">${escHtml(fedaf.action_plan || "")}</td></tr>
             </table>`
          : `<p style="font-size:12px; font-style:italic; color:#555; margin-bottom:16px;">Not yet accomplished by the Supervisor for this semester.</p>`}
      </div>
    </div>
  `;
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

// ── Program table click → filter faculty table below (event delegation,
//    since the container's innerHTML is replaced on every load) ──
document.getElementById("program-summary-container")?.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-program]");
  if (tr) filterFacultyByProgram(tr.dataset.program);
});
document.getElementById("faculty-filter-clear")?.addEventListener("click", clearFacultyFilter);

// ── Faculty table click → open full report ──
document.getElementById("faculty-report-container")?.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-teacher-id]");
  if (tr) openFacultyReport(tr.dataset.teacherId, tr.dataset.teacherName);
});

document.getElementById("exec-report-close-btn")?.addEventListener("click", () => {
  document.getElementById("exec-report-modal").classList.add("hidden");
});
document.getElementById("exec-report-print-btn")?.addEventListener("click", () => {
  window.print();
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
