// ============================================================
//  FacultyPulse — Custom Modal Utility
//  Replaces native alert() and confirm() with styled modals.
//  Also provides a loading overlay for async operations.
//
//  Usage:
//    import { fpAlert, fpConfirm, fpLoading } from "./modal.js";
//
//    await fpAlert("Something happened.");
//    const yes = await fpConfirm("Are you sure?");
//    if (yes) { ... }
//
//    const loading = fpLoading("Saving...");
//    await doSomethingSlow();
//    loading.close();
// ============================================================

// ── Inject modal HTML once into the DOM ──
function ensureModalDOM() {
  if (document.getElementById("fp-modal-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "fp-modal-overlay";
  overlay.innerHTML = `
    <div id="fp-modal-box">
      <div id="fp-modal-icon"></div>
      <p id="fp-modal-message"></p>
      <div id="fp-modal-buttons"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Styles injected once
  const style = document.createElement("style");
  style.textContent = `
    #fp-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: none;
    }
    #fp-modal-overlay.visible {
      opacity: 1;
      pointer-events: all;
    }
    #fp-modal-box {
      background: white;
      border-radius: 12px;
      padding: 28px 28px 22px;
      max-width: 420px;
      width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      transform: translateY(-8px);
      transition: transform 0.15s;
      text-align: center;
    }
    #fp-modal-overlay.visible #fp-modal-box {
      transform: translateY(0);
    }
    #fp-modal-icon {
      font-size: 36px;
      margin-bottom: 10px;
      line-height: 1;
    }
    #fp-modal-message {
      font-size: 14px;
      color: #1e293b;
      line-height: 1.7;
      margin: 0 0 20px;
      white-space: pre-wrap;
      text-align: left;
    }
    #fp-modal-buttons {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .fp-btn {
      padding: 9px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: Arial, sans-serif;
      transition: opacity 0.15s;
    }
    .fp-btn:hover { opacity: 0.85; }
    .fp-btn-primary   { background: #1a56db; color: white; }
    .fp-btn-success   { background: #16a34a; color: white; }
    .fp-btn-danger    { background: #dc2626; color: white; }
    .fp-btn-secondary {
      background: white;
      color: #374151;
      border: 1px solid #d1d5db;
    }

    /* ── Loading overlay variant ──
       Same box/overlay, but centered message + no button row, and
       a spinner instead of a static icon glyph. Sits on top of
       everything (same z-index as alert/confirm) since its whole
       point is to block interaction while something is in flight. */
    #fp-modal-overlay.fp-modal-loading #fp-modal-message {
      text-align: center;
      margin-bottom: 4px;
    }
    #fp-modal-overlay.fp-modal-loading #fp-modal-buttons {
      display: none;
    }
    .fp-spinner {
      width: 34px;
      height: 34px;
      margin: 0 auto;
      border: 4px solid #e2e8f0;
      border-top-color: #671408;
      border-radius: 50%;
      animation: fp-spin 0.7s linear infinite;
    }
    @keyframes fp-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// ── Show the modal ──
function showModal({ icon, message, buttons }) {
  ensureModalDOM();

  document.getElementById("fp-modal-overlay").classList.remove("fp-modal-loading");
  document.getElementById("fp-modal-icon").textContent    = icon || "";
  document.getElementById("fp-modal-message").textContent = message;

  const btnContainer = document.getElementById("fp-modal-buttons");
  btnContainer.innerHTML = "";

  return new Promise(resolve => {
    buttons.forEach(({ label, style, value }) => {
      const btn = document.createElement("button");
      btn.className   = `fp-btn ${style}`;
      btn.textContent = label;
      btn.onclick = () => {
        closeModal();
        resolve(value);
      };
      btnContainer.appendChild(btn);
    });

    // Show with animation
    requestAnimationFrame(() => {
      document.getElementById("fp-modal-overlay").classList.add("visible");
    });
  });
}

function closeModal() {
  const overlay = document.getElementById("fp-modal-overlay");
  if (overlay) {
    overlay.classList.remove("visible");
    overlay.classList.remove("fp-modal-loading");
  }
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * fpAlert — replaces alert()
 * Shows a message with a single OK button.
 * @param {string} message
 * @param {"info"|"success"|"error"} type  — controls icon
 */
export function fpAlert(message, type = "info") {
  const icons = { info: "ℹ️", success: "✅", error: "❌" };
  return showModal({
    icon: icons[type] || "ℹ️",
    message,
    buttons: [
      { label: "OK", style: "fp-btn-primary", value: true }
    ],
  });
}

/**
 * fpConfirm — replaces confirm()
 * Shows a message with Confirm + Cancel buttons.
 * Returns true if confirmed, false if cancelled.
 * @param {string} message
 * @param {object} options — { confirmLabel, confirmStyle, cancelLabel, extraButton }
 *   extraButton: { label, action } — optional third button that runs action() and resolves false
 */
export function fpConfirm(message, {
  confirmLabel = "Confirm",
  confirmStyle = "fp-btn-primary",
  cancelLabel  = "Cancel",
  extraButton  = null,
} = {}) {
  ensureModalDOM();

  document.getElementById("fp-modal-overlay").classList.remove("fp-modal-loading");
  document.getElementById("fp-modal-icon").textContent    = "⚠️";
  document.getElementById("fp-modal-message").textContent = message;

  const btnContainer = document.getElementById("fp-modal-buttons");
  btnContainer.innerHTML = "";

  return new Promise(resolve => {
    // Cancel
    const cancelBtn = document.createElement("button");
    cancelBtn.className   = "fp-btn fp-btn-secondary";
    cancelBtn.textContent = cancelLabel;
    cancelBtn.onclick = () => { closeModal(); resolve(false); };
    btnContainer.appendChild(cancelBtn);

    // Extra button (e.g. "View in Monitoring →")
    if (extraButton) {
      const extraBtn = document.createElement("button");
      extraBtn.className   = "fp-btn fp-btn-secondary";
      extraBtn.textContent = extraButton.label;
      extraBtn.style.cssText = "border-color:#1a56db; color:#1a56db;";
      extraBtn.onclick = () => {
        closeModal();
        extraButton.action();
        resolve(false);
      };
      btnContainer.appendChild(extraBtn);
    }

    // Confirm
    const confirmBtn = document.createElement("button");
    confirmBtn.className   = `fp-btn ${confirmStyle}`;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.onclick = () => { closeModal(); resolve(true); };
    btnContainer.appendChild(confirmBtn);

    requestAnimationFrame(() => {
      document.getElementById("fp-modal-overlay").classList.add("visible");
    });
  });
}

// ── fpLoading — shows a blocking spinner overlay while something
//    async is in flight. Unlike fpAlert/fpConfirm, this doesn't
//    resolve on a button click — YOU close it, when the operation
//    finishes, via the handle it returns.
//
//    Safe to call more than once while one is already showing (e.g.
//    two overlapping loads): a counter tracks how many callers are
//    still waiting, and the overlay only actually hides once every
//    caller has called .close(). Calling .close() twice on the same
//    handle is a no-op the second time, so it can't over-decrement.
//
//    @param {string} message
//    @returns {{ close: () => void, update: (msg: string) => void }}
let fpLoadingCount = 0;

export function fpLoading(message = "Loading...") {
  ensureModalDOM();

  const overlay = document.getElementById("fp-modal-overlay");
  fpLoadingCount++;

  overlay.classList.add("fp-modal-loading");
  document.getElementById("fp-modal-icon").innerHTML     = `<div class="fp-spinner"></div>`;
  document.getElementById("fp-modal-message").textContent = message;
  document.getElementById("fp-modal-buttons").innerHTML  = "";

  requestAnimationFrame(() => overlay.classList.add("visible"));

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      fpLoadingCount = Math.max(0, fpLoadingCount - 1);
      if (fpLoadingCount === 0) closeModal();
    },
    update(msg) {
      if (closed) return;
      document.getElementById("fp-modal-message").textContent = msg;
    },
  };
}