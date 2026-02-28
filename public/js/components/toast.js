const Toast = {
  iconMap: {
    success: 'circle-check',
    error: 'circle-x',
    info: 'info',
    warning: 'triangle-alert',
  },

  colorMap: {
    success: 'toast-success',
    error: 'toast-error',
    info: 'toast-info',
    warning: 'toast-warning',
  },

  show(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconName = Toast.iconMap[type] || 'info';

    toast.innerHTML = `
      <span class="toast-icon" data-lucide="${iconName}"></span>
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Fechar notificação">
        <i data-lucide="x"></i>
      </button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => Toast.dismiss(toast));

    container.appendChild(toast);

    Utils.refreshIcons(toast);

    requestAnimationFrame(() => {
      toast.classList.add('toast-show');
    });

    if (duration > 0) {
      setTimeout(() => Toast.dismiss(toast), duration);
    }

    return toast;
  },

  dismiss(toast) {
    toast.classList.remove('toast-show');
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  },

  success(message, duration) { return Toast.show(message, 'success', duration); },
  error(message, duration) { return Toast.show(message, 'error', duration); },
  info(message, duration) { return Toast.show(message, 'info', duration); },
  warning(message, duration) { return Toast.show(message, 'warning', duration); },
};

window.Toast = Toast;
