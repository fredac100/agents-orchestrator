const FilesUI = {
  currentPath: '',

  async load() {
    await FilesUI.navigate('');
  },

  async navigate(path) {
    try {
      const data = await API.files.list(path);
      FilesUI.currentPath = data.path || '';
      FilesUI.render(data);
    } catch (err) {
      Toast.error(`Erro ao carregar arquivos: ${err.message}`);
    }
  },

  render(data) {
    const container = document.getElementById('files-container');
    if (!container) return;

    const breadcrumb = FilesUI._renderBreadcrumb(data.path);
    const entries = data.entries || [];

    if (entries.length === 0) {
      container.innerHTML = `
        ${breadcrumb}
        <div class="files-empty">
          <i data-lucide="folder-open" style="width:48px;height:48px;color:var(--text-muted)"></i>
          <p>Nenhum arquivo encontrado neste diretório</p>
        </div>
      `;
      Utils.refreshIcons(container);
      return;
    }

    const rows = entries.map(entry => FilesUI._renderRow(entry, data.path)).join('');

    container.innerHTML = `
      ${breadcrumb}
      <div class="files-toolbar">
        <span class="files-count">${entries.length} ${entries.length === 1 ? 'item' : 'itens'}</span>
        ${data.path ? `<button class="btn btn--ghost btn--sm" data-action="download-folder" data-path="${Utils.escapeHtml(data.path)}" title="Baixar pasta como .tar.gz"><i data-lucide="archive" style="width:14px;height:14px"></i> Baixar pasta</button>` : ''}
      </div>
      <div class="files-table-wrapper">
        <table class="files-table">
          <thead>
            <tr>
              <th class="files-th-name">Nome</th>
              <th class="files-th-size">Tamanho</th>
              <th class="files-th-date">Modificado</th>
              <th class="files-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    Utils.refreshIcons(container);
  },

  _renderBreadcrumb(currentPath) {
    const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];
    let html = `<nav class="files-breadcrumb"><a href="#" data-action="navigate-files" data-path="" class="files-breadcrumb-link"><i data-lucide="home" style="width:14px;height:14px"></i> projetos</a>`;

    let accumulated = '';
    for (const part of parts) {
      accumulated += (accumulated ? '/' : '') + part;
      html += ` <span class="files-breadcrumb-sep">/</span> <a href="#" data-action="navigate-files" data-path="${Utils.escapeHtml(accumulated)}" class="files-breadcrumb-link">${Utils.escapeHtml(part)}</a>`;
    }

    html += '</nav>';
    return html;
  },

  _renderRow(entry, currentPath) {
    const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const icon = entry.type === 'directory' ? 'folder' : FilesUI._fileIcon(entry.extension);
    const iconColor = entry.type === 'directory' ? 'var(--warning)' : 'var(--text-muted)';
    const size = entry.type === 'directory' ? '—' : FilesUI._formatSize(entry.size);
    const date = FilesUI._formatDate(entry.modified);

    const nameCell = entry.type === 'directory'
      ? `<a href="#" class="files-entry-link files-entry-dir" data-action="navigate-files" data-path="${Utils.escapeHtml(fullPath)}"><i data-lucide="${icon}" style="width:16px;height:16px;color:${iconColor};flex-shrink:0"></i> ${Utils.escapeHtml(entry.name)}</a>`
      : `<span class="files-entry-link files-entry-file"><i data-lucide="${icon}" style="width:16px;height:16px;color:${iconColor};flex-shrink:0"></i> ${Utils.escapeHtml(entry.name)}</span>`;

    const actions = entry.type === 'directory'
      ? `<button class="btn btn--ghost btn--sm" data-action="download-folder" data-path="${Utils.escapeHtml(fullPath)}" title="Baixar pasta"><i data-lucide="archive" style="width:14px;height:14px"></i></button>`
      : `<button class="btn btn--ghost btn--sm" data-action="download-file" data-path="${Utils.escapeHtml(fullPath)}" title="Baixar arquivo"><i data-lucide="download" style="width:14px;height:14px"></i></button>`;

    return `
      <tr class="files-row">
        <td class="files-td-name">${nameCell}</td>
        <td class="files-td-size">${size}</td>
        <td class="files-td-date">${date}</td>
        <td class="files-td-actions">${actions}</td>
      </tr>
    `;
  },

  _fileIcon(ext) {
    const map = {
      js: 'file-code-2', ts: 'file-code-2', jsx: 'file-code-2', tsx: 'file-code-2',
      py: 'file-code-2', rb: 'file-code-2', go: 'file-code-2', rs: 'file-code-2',
      java: 'file-code-2', c: 'file-code-2', cpp: 'file-code-2', h: 'file-code-2',
      html: 'file-code-2', css: 'file-code-2', scss: 'file-code-2', vue: 'file-code-2',
      json: 'file-json', xml: 'file-json', yaml: 'file-json', yml: 'file-json',
      md: 'file-text', txt: 'file-text', log: 'file-text', csv: 'file-text',
      pdf: 'file-text',
      png: 'file-image', jpg: 'file-image', jpeg: 'file-image', gif: 'file-image',
      svg: 'file-image', webp: 'file-image', ico: 'file-image',
      zip: 'file-archive', tar: 'file-archive', gz: 'file-archive', rar: 'file-archive',
      sh: 'file-terminal', bash: 'file-terminal',
      sql: 'database',
      env: 'file-lock',
    };
    return map[ext] || 'file';
  },

  _formatSize(bytes) {
    if (bytes == null) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  },

  _formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  downloadFile(path) {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(path)}`;
    a.download = '';
    a.click();
  },

  downloadFolder(path) {
    const a = document.createElement('a');
    a.href = `/api/files/download-folder?path=${encodeURIComponent(path)}`;
    a.download = '';
    a.click();
  },
};

window.FilesUI = FilesUI;
