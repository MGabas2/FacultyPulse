// ============================================================
//  FacultyPulse — Show/Hide password toggle
//  Import once per page: import "./password-toggle.js";
//  Adds an eye button inside every <input type="password"> on the page
//  (and any added later, e.g. inside modals). Display-only: it flips the
//  input between type="password" and type="text" — nothing is stored or sent.
//  Opt out on one input with data-no-toggle.
// ============================================================

const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a19.8 19.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.7 19.7 0 0 1-3.17 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function enhance(input) {
  if (input.dataset.pwToggle || input.hasAttribute("data-no-toggle")) return;
  // The login pages already ship their own Show/Hide button next to the main password field.
  if (input.parentElement?.querySelector("#toggle-password")) return;
  input.dataset.pwToggle = "1";

  const cs   = getComputedStyle(input);
  const wrap = document.createElement("span");
  wrap.style.cssText = "position:relative; display:" + (cs.display === "block" || input.style.width === "100%" ? "block" : "inline-block") + ";";
  if (input.style.width) wrap.style.width = input.style.width;
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.paddingRight = "38px";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Show password");
  btn.setAttribute("title", "Show password");
  btn.innerHTML = EYE;
  btn.style.cssText =
    "position:absolute; right:6px; top:50%; transform:translateY(-50%); width:28px; height:28px;" +
    "display:flex; align-items:center; justify-content:center; padding:0; margin:0; border:0;" +
    "background:transparent; color:#64748b; cursor:pointer; border-radius:6px; box-shadow:none; min-width:0;";
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? EYE_OFF : EYE;
    const label = show ? "Hide password" : "Show password";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    input.focus();
  });
  wrap.appendChild(btn);
}

function scan(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(enhance);
}

scan();
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches?.('input[type="password"]')) enhance(n); else scan(n);
  });
}).observe(document.body, { childList: true, subtree: true });
