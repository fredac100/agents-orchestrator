const Modal = {
  _confirmResolve: null,

  open(modalId) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return;

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('active'));

    const firstInput = overlay.querySelector('input:not([type="hidden"]), textarea, select');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 50);
    }
  },

  close(modalId) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return;

    overlay.classList.remove('active');
    setTimeout(() => { overlay.hidden = true; }, 200);

    const form = overlay.querySelector('form');
    if (form) form.reset();
  },

  closeAll() {
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      if (!overlay.hidden) {
        overlay.classList.remove('active');
        setTimeout(() => { overlay.hidden = true; }, 200);
        const form = overlay.querySelector('form');
        if (form) form.reset();
      }
    });
  },

  confirm(title, message) {
    return new Promise((resolve) => {
      Modal._confirmResolve = resolve;

      const titleEl = document.getElementById('confirm-modal-title');
      const messageEl = document.getElementById('confirm-modal-message');

      if (titleEl) titleEl.textContent = title;
      if (messageEl) messageEl.textContent = message;

      Modal.open('confirm-modal-overlay');
    });
  },

  _resolveConfirm(result) {
    Modal.close('confirm-modal-overlay');
    if (Modal._confirmResolve) {
      Modal._confirmResolve(result);
      Modal._confirmResolve = null;
    }
  },

  _promptResolve: null,

  prompt(title, message, defaultValue = '') {
    return new Promise((resolve) => {
      Modal._promptResolve = resolve;

      const titleEl = document.getElementById('prompt-modal-title');
      const messageEl = document.getElementById('prompt-modal-message');
      const inputEl = document.getElementById('prompt-modal-input');

      if (titleEl) titleEl.textContent = title;
      if (messageEl) messageEl.innerHTML = message;
      if (inputEl) inputEl.value = defaultValue;

      Modal.open('prompt-modal-overlay');
    });
  },

  _resolvePrompt(result) {
    const inputEl = document.getElementById('prompt-modal-input');
    Modal.close('prompt-modal-overlay');
    if (Modal._promptResolve) {
      Modal._promptResolve(result ? (inputEl?.value || '') : null);
      Modal._promptResolve = null;
    }
  },

  _setupListeners() {
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        const modalId = e.target.id;

        if (modalId === 'confirm-modal-overlay') {
          Modal._resolveConfirm(false);
        } else if (modalId === 'prompt-modal-overlay') {
          Modal._resolvePrompt(false);
        } else {
          Modal.close(modalId);
        }
        return;
      }

      const closeBtn = e.target.closest('[data-modal-close]');
      if (closeBtn) {
        const targetId = closeBtn.dataset.modalClose;

        if (targetId === 'confirm-modal-overlay') {
          Modal._resolveConfirm(false);
        } else if (targetId === 'prompt-modal-overlay') {
          Modal._resolvePrompt(false);
        } else {
          Modal.close(targetId);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;

      const activeModal = document.querySelector('.modal-overlay.active');
      if (!activeModal) return;

      if (activeModal.id === 'confirm-modal-overlay') {
        Modal._resolveConfirm(false);
      } else if (activeModal.id === 'prompt-modal-overlay') {
        Modal._resolvePrompt(false);
      } else {
        Modal.close(activeModal.id);
      }
    });

    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', () => Modal._resolveConfirm(true));

    const promptConfirmBtn = document.getElementById('prompt-modal-confirm-btn');
    if (promptConfirmBtn) promptConfirmBtn.addEventListener('click', () => Modal._resolvePrompt(true));

    const promptCancelBtn = document.getElementById('prompt-modal-cancel-btn');
    if (promptCancelBtn) promptCancelBtn.addEventListener('click', () => Modal._resolvePrompt(false));

    const promptInput = document.getElementById('prompt-modal-input');
    if (promptInput) promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Modal._resolvePrompt(true);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => Modal._setupListeners());

window.Modal = Modal;
