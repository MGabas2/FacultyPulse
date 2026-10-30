// ============================================================
//  FacultyPulse — Semester Cleanup
//  Archives students who are NOT enrolled in any course in the active
//  semester (graduated / dropped), after an admin reviews the list.
//
//  Safety lives on the SERVER (see sql: admin_cleanup_* functions):
//    • admin-only, re-checked on every call
//    • refuses if the semester is inactive, empty, or if >40% of active
//      students would be archived (a sign of a half-finished import)
//    • students created in the last 7 days are never listed
//    • archive = users.is_active=false (same as the Archive button);
//      nothing is deleted, and the last run can be undone
//  This file only draws the dialog and calls those functions.
// ============================================================
import { supabase } from "./supabase.js";
import { fpAlert, fpConfirm } from "./modal.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let semester = null;      // { id, label }
let preview  = null;      // last preview payload
let busy     = false;

function setError(msg) { const el = $("cleanup-error"); if (el) el.textContent = msg || ""; }
function friendly(err) { return (err && err.message) ? err.message : "Something went wrong."; }

function setBusy(on) {
  busy = on;
  ["cleanup-preview-btn", "cleanup-archive-btn", "cleanup-undo-btn"].forEach(id => { const b = $(id); if (b) b.disabled = on || b.dataset.locked === "1"; });
  updateButtons();
}

function updateButtons() {
  const prev = $("cleanup-preview-btn");
  if (prev) prev.disabled = busy || !$("cleanup-allfiles").checked;
  const arch = $("cleanup-archive-btn");
  if (arch) {
    const ok = !!preview && !preview.blocked && preview.candidates > 0
      && $("cleanup-confirm-input").value.trim() === `ARCHIVE ${preview.candidates}`;
    arch.disabled = busy || !ok;
  }
}

async function loadLastRun() {
  const box = $("cleanup-undo");
  if (!box) return;
  const { data, error } = await supabase.rpc("admin_cleanup_last_run");
  if (error || !data) { box.hidden = true; return; }
  const when = new Date(data.created_at).toLocaleString();
  $("cleanup-undo-text").textContent =
    `Last cleanup: ${data.archived} student(s) archived on ${when} (${data.semester_label}). ` +
    `${data.still_archived} of them are still archived.`;
  $("cleanup-undo-btn").dataset.run = data.run_id;
  $("cleanup-undo-btn").dataset.count = data.still_archived;
  box.hidden = false;
}

function renderPreview(p) {
  preview = p;
  const pct = p.active_students ? Math.round((p.candidates / p.active_students) * 1000) / 10 : 0;
  let html = `
    <div class="cleanup-stats">
      <div><b>${p.enrolled_students}</b><span>enrolled this semester</span></div>
      <div><b>${p.active_students}</b><span>active students</span></div>
      <div><b>${p.candidates}</b><span>would be archived (${pct}%)</span></div>
    </div>`;

  if (p.blocked) {
    html += `<p class="cleanup-blocked">${esc(p.block_reason)}</p>`;
    $("cleanup-confirm-wrap").hidden = true;
  } else if (p.candidates === 0) {
    html += `<p class="cleanup-ok">Everyone active is enrolled this semester. Nothing to archive.</p>`;
    $("cleanup-confirm-wrap").hidden = true;
  } else {
    html += `<p class="cleanup-note">By section</p><div class="cleanup-sections">` +
      p.by_section.map(s => `<span class="cleanup-chip">${esc(s.section)} <b>${s.count}</b></span>`).join("") + `</div>`;
    html += `<p class="cleanup-note" style="margin-top:10px;">${p.candidates > p.sample.length ? `First ${p.sample.length} of ${p.candidates}` : "All"} — please skim these. Anyone who should stay, enrol them first, then preview again.</p>
      <div class="cleanup-list"><table><tbody>` +
      p.sample.map(s => `<tr><td>${esc(s.name || "—")}</td><td>${esc(s.student_id)}</td><td>${esc(s.section)}</td></tr>`).join("") +
      `</tbody></table></div>`;
    $("cleanup-phrase").textContent = `ARCHIVE ${p.candidates}`;
    $("cleanup-confirm-input").value = "";
    $("cleanup-confirm-wrap").hidden = false;
  }
  $("cleanup-result").innerHTML = html;
  updateButtons();
}

async function runPreview() {
  setError(""); $("cleanup-result").innerHTML = ""; $("cleanup-confirm-wrap").hidden = true; preview = null;
  setBusy(true);
  try {
    const { data: sem, error: semErr } = await supabase.from("semesters").select("id, label").eq("is_active", true).maybeSingle();
    if (semErr || !sem) { setError("There is no active semester."); return; }
    semester = sem;
    const { data, error } = await supabase.rpc("admin_cleanup_preview", { p_semester_id: sem.id });
    if (error) { setError(friendly(error)); return; }
    $("cleanup-semester").textContent = sem.label;
    renderPreview(data);
  } finally { setBusy(false); }
}

async function runArchive() {
  if (!preview || !semester) return;
  setError("");
  const ok = await fpConfirm(
    `Archive ${preview.candidates} student(s) who are not enrolled in ${semester.label}? ` +
    `They will no longer be able to log in. Nothing is deleted and you can undo this right afterwards.`,
    { confirmLabel: "Archive", confirmStyle: "fp-btn-danger" });
  if (!ok) return;
  setBusy(true);
  try {
    const { data, error } = await supabase.rpc("admin_cleanup_archive",
      { p_semester_id: semester.id, p_expected: preview.candidates });
    if (error) { setError(friendly(error)); return; }
    $("cleanup-result").innerHTML = ""; $("cleanup-confirm-wrap").hidden = true; preview = null;
    window.dispatchEvent(new CustomEvent("fp:users-changed"));
    await loadLastRun();
    await fpAlert(`${data.archived} student(s) archived. You can undo this from the Semester Cleanup window.`, "success");
  } finally { setBusy(false); }
}

async function runUndo() {
  const btn = $("cleanup-undo-btn");
  const runId = btn.dataset.run;
  if (!runId) return;
  const ok = await fpConfirm(
    `Restore the ${btn.dataset.count} student(s) from the last cleanup? They will be able to log in again.`,
    { confirmLabel: "Restore" });
  if (!ok) return;
  setError(""); setBusy(true);
  try {
    const { data, error } = await supabase.rpc("admin_cleanup_restore", { p_run_id: runId });
    if (error) { setError(friendly(error)); return; }
    window.dispatchEvent(new CustomEvent("fp:users-changed"));
    await loadLastRun();
    await fpAlert(`${data.restored} student(s) restored.`, "success");
  } finally { setBusy(false); }
}

function openModal() {
  setError(""); preview = null;
  $("cleanup-allfiles").checked = false;
  $("cleanup-result").innerHTML = ""; $("cleanup-confirm-wrap").hidden = true;
  $("cleanup-modal").classList.remove("hidden");
  updateButtons();
  loadLastRun();
}
function closeModal() { $("cleanup-modal").classList.add("hidden"); }

$("cleanup-btn")?.addEventListener("click", openModal);
$("cleanup-close-btn")?.addEventListener("click", closeModal);
$("cleanup-allfiles")?.addEventListener("change", updateButtons);
$("cleanup-confirm-input")?.addEventListener("input", updateButtons);
$("cleanup-preview-btn")?.addEventListener("click", runPreview);
$("cleanup-archive-btn")?.addEventListener("click", runArchive);
$("cleanup-undo-btn")?.addEventListener("click", runUndo);
