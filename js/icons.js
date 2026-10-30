// ============================================================
//  FacultyPulse — admin icons
//  Replaces colour emoji with single-colour "silhouette" icons that take the
//  text colour of whatever they sit in (white on a maroon button, slate in a
//  table, and so on). Self-contained: no markup or other script needs to change.
//
//  How it works: every emoji in the page — including ones the other scripts
//  write later (buttons, alerts, table rows) — is swapped for an <i class="ic">
//  element whose shape comes from a CSS mask. Text is only ever turned into
//  DOM nodes (never HTML strings), so this adds no injection risk.
//  Load it BEFORE admin.js:   <script type="module" src="../js/icons.js"></script>
// ============================================================

// 24x24 line icons (stroke-based, Lucide-style shapes).
const SHAPES = {
  chart:    '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pie:      '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clip:     '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
  printer:  '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  cap:      '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  trend:    '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  refresh:  '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  undo:     '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="M12 2 3 7h18z"/>',
  send:     '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  check:    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  hash:     '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  search:   '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  alert:    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  message:  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  save:     '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  archive:  '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  pencil:   '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  doc:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  pause:    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  play:     '<path d="m6 3 14 9-14 9z"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  lock:     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  info:     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  xcircle:  '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
};

// emoji -> shape name (variation selector U+FE0F is matched automatically)
const MAP = {
  "📊": "chart", "🍩": "pie", "👥": "users", "📋": "clip", "🖨": "printer", "🗓": "calendar",
  "🎓": "cap", "📈": "trend", "🔄": "refresh", "↺": "undo", "↻": "refresh", "♻": "undo",
  "🏛": "landmark", "📤": "send", "✅": "check", "🔢": "hash", "🔍": "search", "📥": "download",
  "⬇": "download", "⚠": "alert", "💬": "message", "💾": "save", "📦": "archive", "✏": "pencil",
  "📝": "doc", "⏸": "pause", "▶": "play", "🔗": "link", "🔒": "lock", "ℹ": "info", "❌": "xcircle",
};
const RE = new RegExp("(" + Object.keys(MAP).join("|") + ")\\uFE0F?", "gu");
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TITLE"]);
const PLAIN = new Set(["OPTION", "TEXTAREA"]);   // can't hold elements → just drop the emoji

// ── one-time stylesheet ──
function injectStyles() {
  if (document.getElementById("fp-icons-css")) return;
  const svg = (inner) => "url(\"data:image/svg+xml,"
    + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`)
    + "\")";
  let css = ".ic{display:inline-block;width:1.1em;height:1.1em;vertical-align:-0.18em;flex:none;background-color:currentColor;"
          + "-webkit-mask:var(--ic) center/contain no-repeat;mask:var(--ic) center/contain no-repeat;}"
          + ".ic{margin-right:0.4em}"
          + "@media print{.ic{-webkit-print-color-adjust:exact;print-color-adjust:exact}}";
  for (const [name, inner] of Object.entries(SHAPES)) css += `.ic-${name}{--ic:${svg(inner)}}`;
  const el = document.createElement("style");
  el.id = "fp-icons-css";
  el.textContent = css;
  document.head.appendChild(el);
}

function stripEmoji(s) { return s.replace(RE, "").replace(/^\s+/, ""); }

function swapTextNode(node) {
  const text = node.nodeValue;
  if (!text) return;
  RE.lastIndex = 0;
  if (!RE.test(text)) return;
  const parent = node.parentNode;
  if (!parent || SKIP.has(parent.nodeName)) return;
  if (PLAIN.has(parent.nodeName)) { node.nodeValue = stripEmoji(text); return; }

  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0, m;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const i = document.createElement("i");
    i.className = "ic ic-" + MAP[m[1]];
    i.setAttribute("aria-hidden", "true");
    frag.appendChild(i);
    last = m.index + m[0].length;
  }
  let rest = text.slice(last);
  if (last > 0) rest = rest.replace(/^\s+/, "");     // the icon already carries its own gap
  if (rest) frag.appendChild(document.createTextNode(rest));
  parent.replaceChild(frag, node);
}

function scan(root) {
  if (!root) return;
  if (root.nodeType === 3) { swapTextNode(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1 && SKIP.has(root.nodeName)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(swapTextNode);
  // placeholders can't hold elements either
  const fields = root.nodeType === 1 && root.hasAttribute?.("placeholder") ? [root] : [];
  root.querySelectorAll?.("[placeholder]").forEach(el => fields.push(el));
  fields.forEach(el => {
    const p = el.getAttribute("placeholder");
    RE.lastIndex = 0;
    if (p && RE.test(p)) el.setAttribute("placeholder", stripEmoji(p));
  });
}

injectStyles();
scan(document.body);

let queued = false;
const pending = new Set();
function flush() {
  queued = false;
  const items = [...pending]; pending.clear();
  items.forEach(scan);
}
new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "childList") r.addedNodes.forEach(n => pending.add(n));
    else if (r.type === "characterData") pending.add(r.target);
    else if (r.type === "attributes") pending.add(r.target);
  }
  if (!queued) { queued = true; queueMicrotask(flush); }
}).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
