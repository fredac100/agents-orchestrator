const Utils = {
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  formatDuration(ms) {
    if (!ms || ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  },

  formatCost(usd) {
    if (!usd || usd === 0) return '$0.0000';
    return `$${Number(usd).toFixed(4)}`;
  },

  truncate(str, max = 80) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  },

  refreshIcons(container) {
    if (!window.lucide) return;
    const target = container || document;
    const pending = target.querySelectorAll('i[data-lucide]');
    if (pending.length === 0) return;
    lucide.createIcons();
  },
};

window.Utils = Utils;
