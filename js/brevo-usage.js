// ============================================================
//  FacultyPulse — "Email codes today" card for the admin dashboard.
//  Self-contained: it inserts itself under the stat row, so admin.js is untouched.
//  Add ONE line to pages/admin.html, right after the admin.js script tag:
//      <script type="module" src="../js/brevo-usage.js"></script>
// ============================================================
import { supabase } from "./supabase.js";

const REFRESH_MS = 60 * 1000;
let card = null, timer = null;

function ensureCard() {
  if (card && document.body.contains(card)) return card;
  const wrap = document.querySelector("#panel-dashboard .dash-wrap");
  if (!wrap) return null;
  card = document.createElement("div");
  card.id = "brevo-usage-card";
  card.style.cssText = "margin:14px 0 18px;padding:14px 16px;border:1px solid var(--hairline,#e5e7eb);border-radius:10px;background:var(--panel,#fff);";
  const row = wrap.querySelector(".icon-stats-row");
  if (row && row.nextSibling) wrap.insertBefore(card, row.nextSibling); else wrap.appendChild(card);
  return card;
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function paint(html) { const c = ensureCard(); if (c) c.innerHTML = html; }

function render(d) {
  const hasLimit = d.limit != null;
  const pct = hasLimit && d.limit > 0 ? Math.min(100, Math.round((d.sent / d.limit) * 100)) : 0;
  const color = !hasLimit ? "#16a34a" : pct >= 90 ? "#dc2626" : pct >= 65 ? "#f59e0b" : "#16a34a";
  const headline = hasLimit
    ? `<b style="font-size:22px">${d.sent}</b> / ${d.limit} emails sent today`
    : `<b style="font-size:22px">${d.sent}</b> emails sent today <span style="color:#64748b">(paid plan — no daily cap)</span>`;
  const warn = hasLimit && pct >= 90
    ? `<div style="margin-top:8px;font-size:12.5px;color:#dc2626"><b>Nearly out.</b> Students without a login code can't log in until Brevo's daily limit resets. Spread the remaining logins to another day.</div>`
    : "";
  paint(`
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
      <div style="font-weight:600;font-size:13px">Login-code emails (Brevo)</div>
      <div style="font-size:11px;color:#64748b">updated ${esc(new Date(d.updatedAt).toLocaleTimeString())}</div>
    </div>
    <div style="margin:6px 0 8px">${headline}${hasLimit ? ` &nbsp;·&nbsp; <span style="color:${color}">${d.remaining} left</span>` : ""}</div>
    ${hasLimit ? `<div style="height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color}"></div></div>` : ""}
    <div style="margin-top:8px;font-size:11.5px;color:#64748b">Every student login with an email, resend and password reset uses one email. Delivered ${d.delivered}${d.bounced ? ` · problems ${d.bounced}` : ""}. Brevo's day may reset at a different hour than Manila time.</div>
    ${warn}`);
}

async function load() {
  if (document.visibilityState === "hidden") return;
  const panel = document.getElementById("panel-dashboard");
  if (panel && !panel.classList.contains("active")) return;   // only while the dashboard tab is showing
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch("/api/brevo-usage", { headers: { Authorization: "Bearer " + session.access_token } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503) { paint(`<div style="font-size:12.5px;color:#64748b"><b>Login-code emails:</b> not connected yet — add <code>BREVO_API_KEY</code> in Vercel, then redeploy.</div>`); return; }
    if (!r.ok) { paint(`<div style="font-size:12.5px;color:#b45309"><b>Login-code emails:</b> couldn't load usage (${esc(j.message || j.error || r.status)}). Check the Brevo dashboard.</div>`); return; }
    render(j);
  } catch (e) {
    paint(`<div style="font-size:12.5px;color:#b45309"><b>Login-code emails:</b> couldn't load usage. Check the Brevo dashboard.</div>`);
  }
}

if (sessionStorage.getItem("role") === "admin") {
  load();
  timer = setInterval(load, REFRESH_MS);
  document.getElementById("nav-dashboard")?.addEventListener("click", () => setTimeout(load, 100));
  document.getElementById("refresh-btn")?.addEventListener("click", () => setTimeout(load, 100));
}