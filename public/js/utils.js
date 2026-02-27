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

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  initDropzone(dropzoneId, fileInputId, fileListId) {
    const zone = document.getElementById(dropzoneId);
    const input = document.getElementById(fileInputId);
    const list = document.getElementById(fileListId);
    if (!zone || !input || !list) return null;

    const state = { files: [] };

    function render() {
      list.innerHTML = state.files.map((f, i) => `
        <li class="dropzone-file">
          <span class="dropzone-file-name">${Utils.escapeHtml(f.name)}</span>
          <span class="dropzone-file-size">${Utils.formatFileSize(f.size)}</span>
          <button type="button" class="dropzone-file-remove" data-index="${i}" title="Remover">&times;</button>
        </li>
      `).join('');

      const content = zone.querySelector('.dropzone-content');
      if (content) content.style.display = state.files.length > 0 ? 'none' : '';
    }

    function addFiles(fileList) {
      for (const f of fileList) {
        if (state.files.length >= 20) break;
        if (f.size > 10 * 1024 * 1024) continue;
        const dupe = state.files.some(x => x.name === f.name && x.size === f.size);
        if (!dupe) state.files.push(f);
      }
      render();
    }

    zone.addEventListener('click', (e) => {
      if (e.target.closest('.dropzone-file-remove')) {
        const idx = parseInt(e.target.closest('.dropzone-file-remove').dataset.index);
        state.files.splice(idx, 1);
        render();
        return;
      }
      if (!e.target.closest('.dropzone-file')) input.click();
    });

    input.addEventListener('change', () => {
      if (input.files.length > 0) addFiles(input.files);
      input.value = '';
    });

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    });

    state.reset = () => { state.files = []; render(); };
    state.getFiles = () => state.files;
    return state;
  },
};

window.Utils = Utils;
