// ============================================================
//  FacultyPulse — Custom Modal Utility
//  Replaces native alert() and confirm() with styled modals.
//
//  Usage:
//    import { fpAlert, fpConfirm } from "./modal.js";
//
//    await fpAlert("Something happened.");
//    const yes = await fpConfirm("Are you sure?");
//    if (yes) { ... }
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
    `;
    document.head.appendChild(style);
  }
  
  // ── Show the modal ──
  function showModal({ icon, message, buttons }) {
    ensureModalDOM();
  
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
    if (overlay) overlay.classList.remove("visible");
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