// ============================================================
//  FacultyPulse — "Change Email" for Faculty / Supervisor dashboards
//  Wires up the #change-email-btn / #change-email-modal found in
//  teacher.html and supervisor.html. The work is done server-side by
//  /api/staff-change-email (it changes the Auth email AND users.email together).
// ============================================================
import { supabase } from "./supabase.js";
import { fpAlert, fpConfirm } from "./modal.js";

(function initChangeEmail() {
  const $ = (id) => document.getElementById(id);
  const modal = $("change-email-modal");
  if (!modal) return;
  const err = $("ce-error");
  const fields = ["ce-new", "ce-confirm", "ce-pw"];

  $("change-email-btn")?.addEventListener("click", async () => {
    const { data } = await supabase.auth.getSession();
    $("ce-current").textContent = data?.session?.user?.email || "—";
    fields.forEach(i => { $(i).value = ""; });
    err.textContent = "";
    modal.classList.remove("hidden");
  });
  $("ce-cancel-btn")?.addEventListener("click", () => modal.classList.add("hidden"));

  $("ce-save-btn")?.addEventListener("click", async () => {
    const btn = $("ce-save-btn");
    const em = $("ce-new").value.trim().toLowerCase();
    const cf = $("ce-confirm").value.trim().toLowerCase();
    const pw = $("ce-pw").value;
    err.textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { err.textContent = "Enter a valid email address."; return; }
    if (em !== cf)  { err.textContent = "The two email entries do not match."; return; }
    if (!pw)        { err.textContent = "Enter your current password."; return; }
    const ok = await fpConfirm(
      `Change your login email to ${em}?\n\nYou will be logged out and must sign in with this address. Make sure you can open its inbox.`,
      { confirmLabel: "Change email" });
    if (!ok) return;

    btn.disabled = true; btn.textContent = "Changing…";
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch("/api/staff-change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s?.session?.access_token || "") },
        body: JSON.stringify({ newEmail: em, currentPassword: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = j.error || "Couldn't change the email."; return; }
      await fpAlert("Email changed. Please log in again with " + em + ".", "success");
      await supabase.auth.signOut();
      sessionStorage.clear();
      window.location.href = "../staff.html";
    } catch (e) {
      err.textContent = "Couldn't reach the server. Please try again.";
    } finally {
      btn.disabled = false; btn.textContent = "Change Email";
    }
  });
})();