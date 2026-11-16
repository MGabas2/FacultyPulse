// ============================================================
//  FacultyPulse — Evaluation Reassignment Request (student page)
//
//  A student whose dashboard lists the WRONG teacher / course / section
//  files a request for the QA Office to fix their class assignment.
//
//  Self-contained on purpose: it builds its own card + modal and makes
//  its own RPC calls, and touches nothing in student.js — so it cannot
//  interfere with the evaluation submission flow.
//
//  NOT anonymous (unlike the evaluation itself): the request carries the
//  student's ID and name, which the server reads from the verified
//  session — nothing identity-related is trusted from this page.
// ============================================================

import { supabase } from "./supabase.js";

const userId    = sessionStorage.getItem("userId");
const studentId = sessionStorage.getItem("studentId");
const stuName   = sessionStorage.getItem("name") || "";

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Same label the dashboard shows: the "(… Track)" suffix is admin-only.
function courseLabel(s) {
  const code = String(s.name || "").replace(/\s*\([^)]*\btrack\b[^)]*\)\s*$/i, "").trim() || s.name;
  return s.title ? `${code} (${s.title})` : code;
}

let semesterId = null;
let subjects   = [];      // [{id, name, title, teacher_name, section_name}]
let submitted  = new Set();

const MESSAGES = {
  not_verified: "Your login could not be verified. Please log out and log in again.",
  closed:       "The evaluation period is closed, so requests can't be sent right now.",
  not_enrolled: "That course is no longer on your list. Close this and refresh the page.",
  missing:      "Please fill in the correct faculty member, course and Program/Major/Year.",
  too_long:     "One of your answers is too long. Please shorten it.",
  duplicate:    "You already have a pending request for this course. The QA Office will review it.",
  limit:        "You have reached the maximum number of requests for this semester. Please see the QA Office.",
};

function init() {
  const style = document.createElement("style");
  style.textContent = `
    .rr-card { display:flex; flex-wrap:wrap; align-items:center; gap:14px; background:#fff; border:1px solid #e2e8f0;
      border-left:4px solid #94a3b8; border-radius:10px; padding:14px 16px; margin:16px 0; }
    .rr-card-text { flex:1; min-width:220px; }
    .rr-card-title { margin:0 0 3px; font-weight:600; font-size:14px; color:#1e293b; }
    .rr-card-sub { margin:0; font-size:12.5px; color:#64748b; line-height:1.55; }
    .rr-group { border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px 4px; margin:0 0 14px; }
    .rr-group > legend { font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#64748b; padding:0 6px; }
    .rr-row { margin-bottom:12px; }
    .rr-readonly { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; font-size:13.5px; color:#334155; min-height:20px; }
    .rr-notice { background:#fffaf0; border:1px solid #f1d9a6; border-radius:8px; padding:10px 12px; font-size:12.5px; color:#7c4a03; line-height:1.55; margin-bottom:14px; }
    .rr-warn { font-size:12.5px; color:#92400e; margin:6px 0 0; line-height:1.5; }
    .rr-mine { margin-top:16px; border-top:1px solid #e2e8f0; padding-top:12px; }
    .rr-mine h4 { margin:0 0 8px; font-size:13px; color:#475569; }
    .rr-mine-item { font-size:12.5px; color:#334155; padding:6px 0; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; gap:10px; }
    .rr-pill { flex:none; font-size:11px; font-weight:600; padding:2px 9px; border-radius:999px; align-self:flex-start; }
    .rr-pill.pending { background:#fef3c7; color:#92400e; }
    .rr-pill.resolved { background:#d1fae5; color:#065f46; }
    .rr-pill.rejected { background:#fee2e2; color:#991b1b; }
    #rr-modal .modal-box { max-width:480px; width:95vw; max-height:92vh; overflow-y:auto; }
  `;
  document.head.appendChild(style);

  // ── Card on the dashboard ──
  const card = document.createElement("div");
  card.className = "rr-card";
  card.innerHTML = `
    <div class="rr-card-text">
      <p class="rr-card-title">Wrong teacher or course on your list?</p>
      <p class="rr-card-sub">If a course above shows a teacher, course or program/year that isn't yours, send an
        Evaluation Reassignment Request and the QA Office will correct it.</p>
    </div>
    <button type="button" class="btn-secondary" id="rr-open-btn">Request reassignment</button>`;
  const anchor = $("progress-section");
  if (anchor && anchor.parentElement) anchor.insertAdjacentElement("afterend", card);
  else (document.querySelector(".container") || document.body).appendChild(card);

  // ── Modal ──
  const modal = document.createElement("div");
  modal.id = "rr-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-box">
      <h3 style="margin:0 0 12px;">Evaluation Reassignment Request</h3>
      <div class="rr-notice">
        <b>This request is not anonymous.</b> Your Student ID (<b>${esc(studentId)}</b>)${stuName && stuName !== studentId ? ` and name (<b>${esc(stuName)}</b>)` : " and name"}
        are sent to the QA Office with it so they can fix your record. Your evaluation answers stay anonymous.
      </div>

      <div id="rr-form">
        <fieldset class="rr-group">
          <legend>Incorrect evaluation details</legend>
          <div class="rr-row">
            <label class="field-label" for="rr-wrong">Which course on your list is wrong?</label>
            <select id="rr-wrong" class="field-input"><option value="">Loading…</option></select>
            <p class="rr-warn" id="rr-already" style="display:none;">
              You already submitted an evaluation for this course. Send the request anyway — the QA Office
              will review it, but a submitted evaluation cannot always be withdrawn.</p>
          </div>
          <div class="rr-row">
            <label class="field-label">Faculty Member Evaluated</label>
            <div class="rr-readonly" id="rr-wrong-teacher">—</div>
          </div>
          <div class="rr-row">
            <label class="field-label">Course Evaluated</label>
            <div class="rr-readonly" id="rr-wrong-subject">—</div>
          </div>
        </fieldset>

        <fieldset class="rr-group">
          <legend>Correct information</legend>
          <div class="rr-row">
            <label class="field-label" for="rr-teacher">Correct Faculty Member</label>
            <input type="text" id="rr-teacher" class="field-input" maxlength="120" autocomplete="off" placeholder="Full name of your actual teacher" />
          </div>
          <div class="rr-row">
            <label class="field-label" for="rr-subject">Correct Course</label>
            <input type="text" id="rr-subject" class="field-input" maxlength="160" autocomplete="off" placeholder="e.g. Readings in Philippine History" />
          </div>
          <div class="rr-row">
            <label class="field-label" for="rr-code">Course Code <span style="font-weight:400; color:#94a3b8;">(if applicable)</span></label>
            <input type="text" id="rr-code" class="field-input" maxlength="40" autocomplete="off" placeholder="e.g. GE 02" />
          </div>
          <div class="rr-row">
            <label class="field-label" for="rr-section">Program/Major/Year</label>
            <input type="text" id="rr-section" class="field-input" maxlength="80" autocomplete="off" placeholder="e.g. BSIT / Automotive / 3rd Year" />
          </div>
        </fieldset>

        <div class="rr-row">
          <label class="field-label" for="rr-info">Any Additional Info <span style="font-weight:400; color:#94a3b8;">(optional)</span></label>
          <textarea id="rr-info" class="field-input" maxlength="500" rows="3" style="resize:vertical;"
            placeholder="Anything else the QA Office should know"></textarea>
        </div>
      </div>

      <p id="rr-error" class="error" role="alert"></p>
      <div id="rr-success" class="modal-success">Request sent. The QA Office will review it.</div>

      <div style="display:flex; gap:10px;">
        <button id="rr-submit-btn" style="flex:1;">Send request</button>
        <button class="btn-secondary" id="rr-cancel-btn">Close</button>
      </div>

      <div class="rr-mine" id="rr-mine" style="display:none;">
        <h4>Your requests this semester</h4>
        <div id="rr-mine-list"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  $("rr-open-btn").addEventListener("click", openModal);
  $("rr-cancel-btn").addEventListener("click", closeModal);
  $("rr-wrong").addEventListener("change", onWrongChange);
  $("rr-submit-btn").addEventListener("click", submitRequest);
  modal.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}

function closeModal() { $("rr-modal").classList.add("hidden"); }

function setError(msg) { $("rr-error").textContent = msg || ""; }

async function openModal() {
  setError("");
  $("rr-success").style.display = "none";
  $("rr-form").style.display = "";
  $("rr-submit-btn").style.display = "";
  $("rr-submit-btn").disabled = true;
  ["rr-teacher", "rr-subject", "rr-code", "rr-section", "rr-info"].forEach(id => { $(id).value = ""; });
  $("rr-wrong").innerHTML = `<option value="">Loading…</option>`;
  onWrongChange();
  $("rr-modal").classList.remove("hidden");

  try {
    if (!semesterId) {
      const { data: sem } = await supabase.from("semesters").select("id").eq("is_active", true).single();
      semesterId = sem?.id || null;
    }
    if (!semesterId) { setError("There is no active semester."); return; }

    const { data: dash, error } = await supabase.rpc("get_student_dashboard", {
      p_student_id: studentId, p_user_id: userId, p_semester_id: semesterId,
    });
    if (error) throw error;
    subjects  = (dash && dash.subjects) || [];
    submitted = new Set((dash && dash.submitted) || []);

    if (subjects.length === 0) {
      $("rr-wrong").innerHTML = `<option value="">No courses on your list</option>`;
      setError("You have no courses listed this semester. Please see the QA Office.");
      return;
    }
    $("rr-wrong").innerHTML = `<option value="">— choose the course that is wrong —</option>` +
      subjects.map(s =>
        `<option value="${esc(s.id)}">${esc(courseLabel(s))} — ${esc(s.teacher_name || "no teacher")}</option>`).join("");
    $("rr-submit-btn").disabled = false;
    loadMine();
  } catch (err) {
    console.error(err);
    setError("Couldn't load your courses. Check your connection and try again.");
  }
}

function onWrongChange() {
  const s = subjects.find(x => x.id === $("rr-wrong").value);
  $("rr-wrong-teacher").textContent = s ? (s.teacher_name || "—") : "—";
  $("rr-wrong-subject").textContent = s
    ? courseLabel(s) + (s.section_name ? ` · ${s.section_name}` : "") : "—";
  $("rr-already").style.display = s && submitted.has(s.id) ? "" : "none";
}

async function loadMine() {
  try {
    const { data } = await supabase.rpc("get_my_reassignment_requests", {
      p_user_id: userId, p_semester_id: semesterId,
    });
    const list = Array.isArray(data) ? data : [];
    $("rr-mine").style.display = list.length ? "" : "none";
    const LABEL = { pending: "Pending", resolved: "Resolved", rejected: "Not approved" };
    $("rr-mine-list").innerHTML = list.map(r => `
      <div class="rr-mine-item">
        <span>${esc(r.wrong_subject_label)} → ${esc(r.correct_subject)} (${esc(r.correct_teacher)})</span>
        <span class="rr-pill ${esc(r.status)}">${esc(LABEL[r.status] || r.status)}</span>
      </div>`).join("");
  } catch (err) { console.error(err); }
}

async function submitRequest() {
  setError("");
  const wrongId = $("rr-wrong").value;
  const teacher = $("rr-teacher").value.trim();
  const subject = $("rr-subject").value.trim();
  const code    = $("rr-code").value.trim();
  const section = $("rr-section").value.trim();
  const info    = $("rr-info").value.trim();

  if (!wrongId) { setError("Choose which course on your list is wrong."); return; }
  if (!teacher || !subject || !section) { setError(MESSAGES.missing); return; }

  const btn = $("rr-submit-btn");
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const { data, error } = await supabase.rpc("submit_reassignment_request", {
      p_user_id: userId, p_subject_id: wrongId, p_semester_id: semesterId,
      p_correct_teacher: teacher, p_correct_subject: subject,
      p_correct_subject_code: code, p_correct_section: section,
      p_additional_info: info,
    });
    if (error) throw error;
    if (data?.status !== "ok") { setError(MESSAGES[data?.status] || "The request could not be sent. Please try again."); return; }

    $("rr-form").style.display = "none";
    btn.style.display = "none";
    $("rr-success").style.display = "block";
    loadMine();
  } catch (err) {
    console.error(err);
    setError("The request could not be sent. Check your connection and try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Send request";
  }
}

// Last, so every const above is initialised before init() uses it.
// Wrapped: a failure here must never affect the evaluation flow.
try {
  if (sessionStorage.getItem("role") === "student" && userId && studentId) init();
} catch (err) {
  console.error("Reassignment request unavailable:", err);
}
