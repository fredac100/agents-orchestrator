const ImportUI = {
  _currentBrowsePath: '/home',
  _selectedPath: '',
  _importing: false,

  async load() {
    const container = document.getElementById('import-container');
    if (!container) return;

    let repos = [];
    try {
      repos = await API.repos.list();
    } catch {}

    container.innerHTML = `
      <div class="import-layout">
        <div class="card import-card">
          <div class="card-header">
            <h2 class="card-title"><i data-lucide="upload-cloud" style="width:20px;height:20px"></i> Importar Projeto</h2>
          </div>
          <div class="card-body">
            <p class="import-desc">Selecione um diretório do servidor para importar ao Gitea. Os arquivos serão copiados respeitando o <code>.gitignore</code>, sem alterar o projeto original.</p>
            <div class="form-group">
              <label class="form-label">Diretório do projeto</label>
              <div class="import-path-row">
                <input type="text" class="form-input" id="import-path" placeholder="/home/fred/meu-projeto" value="" />
                <button class="btn btn--ghost btn--sm" id="import-browse-btn" type="button"><i data-lucide="folder-search" style="width:16px;height:16px"></i> Navegar</button>
              </div>
            </div>
            <div id="import-browser" class="import-browser" hidden>
              <div class="import-browser-header">
                <nav id="import-browser-breadcrumb" class="files-breadcrumb"></nav>
              </div>
              <div class="import-browser-list" id="import-browser-list"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Nome do repositório no Gitea</label>
              <input type="text" class="form-input" id="import-repo-name" placeholder="meu-projeto" />
              <span class="form-hint">Letras minúsculas, números e hífens. Será criado no Gitea e clonado em /home/projetos/</span>
            </div>
            <button class="btn btn--primary" id="import-submit-btn" type="button">
              <i data-lucide="upload-cloud" style="width:16px;height:16px"></i> Importar para o Gitea
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title"><i data-lucide="git-branch" style="width:20px;height:20px"></i> Repositórios no Gitea</h2>
            <span class="badge badge--accent">${repos.length}</span>
          </div>
          <div class="card-body">
            ${repos.length === 0 ? '<p class="text-muted">Nenhum repositório encontrado</p>' : ''}
            <div class="import-repos-grid">
              ${repos.map(r => ImportUI._renderRepoCard(r)).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    Utils.refreshIcons(container);
    ImportUI._bindEvents();
  },

  _renderRepoCard(repo) {
    const domain = 'nitro-cloud.duckdns.org';
    const repoUrl = `https://git.${domain}/${repo.full_name || repo.name}`;
    const updated = repo.updated_at ? new Date(repo.updated_at).toLocaleDateString('pt-BR') : '';
    const size = repo.size ? ImportUI._formatSize(repo.size * 1024) : '';

    return `
      <div class="import-repo-card">
        <div class="import-repo-header">
          <i data-lucide="git-branch" style="width:16px;height:16px;color:var(--accent)"></i>
          <a href="${Utils.escapeHtml(repoUrl)}" target="_blank" class="import-repo-name">${Utils.escapeHtml(repo.name)}</a>
        </div>
        ${repo.description ? `<p class="import-repo-desc">${Utils.escapeHtml(repo.description)}</p>` : ''}
        <div class="import-repo-meta">
          ${updated ? `<span><i data-lucide="calendar" style="width:12px;height:12px"></i> ${updated}</span>` : ''}
          ${size ? `<span><i data-lucide="hard-drive" style="width:12px;height:12px"></i> ${size}</span>` : ''}
          ${repo.default_branch ? `<span><i data-lucide="git-commit" style="width:12px;height:12px"></i> ${Utils.escapeHtml(repo.default_branch)}</span>` : ''}
        </div>
      </div>
    `;
  },

  _formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  },

  _bindEvents() {
    const browseBtn = document.getElementById('import-browse-btn');
    const submitBtn = document.getElementById('import-submit-btn');
    const pathInput = document.getElementById('import-path');

    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        const browser = document.getElementById('import-browser');
        if (!browser) return;
        const isVisible = !browser.hidden;
        browser.hidden = isVisible;
        if (!isVisible) {
          const currentVal = pathInput?.value.trim();
          ImportUI._browseTo(currentVal || '/home');
        }
      });
    }

    if (pathInput) {
      pathInput.addEventListener('change', () => {
        const val = pathInput.value.trim();
        if (val) {
          ImportUI._autoFillRepoName(val);
        }
      });

      pathInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = pathInput.value.trim();
          if (val) {
            ImportUI._autoFillRepoName(val);
            const browser = document.getElementById('import-browser');
            if (browser && !browser.hidden) {
              ImportUI._browseTo(val);
            }
          }
        }
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => ImportUI._doImport());
    }
  },

  _autoFillRepoName(path) {
    const nameInput = document.getElementById('import-repo-name');
    if (!nameInput || nameInput.value.trim()) return;
    const folderName = path.split('/').filter(Boolean).pop() || '';
    nameInput.value = folderName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  },

  async _browseTo(path) {
    try {
      const data = await API.projects.browse(path);
      ImportUI._currentBrowsePath = data.currentPath;
      ImportUI._renderBrowser(data);
    } catch (err) {
      Toast.error(`Erro ao navegar: ${err.message}`);
    }
  },

  _renderBrowser(data) {
    const breadcrumbEl = document.getElementById('import-browser-breadcrumb');
    const listEl = document.getElementById('import-browser-list');
    if (!breadcrumbEl || !listEl) return;

    const parts = data.currentPath.split('/').filter(Boolean);
    let breadcrumb = `<a href="#" class="files-breadcrumb-link import-browse-link" data-browse-path="/"><i data-lucide="hard-drive" style="width:14px;height:14px"></i> /</a>`;
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      breadcrumb += ` <span class="files-breadcrumb-sep">/</span> <a href="#" class="files-breadcrumb-link import-browse-link" data-browse-path="${Utils.escapeHtml(accumulated)}">${Utils.escapeHtml(part)}</a>`;
    }
    breadcrumbEl.innerHTML = breadcrumb;

    const dirs = data.directories || [];
    if (dirs.length === 0) {
      listEl.innerHTML = '<div class="import-browser-empty">Nenhum subdiretório encontrado</div>';
    } else {
      listEl.innerHTML = dirs.map(d => `
        <div class="import-browser-item">
          <a href="#" class="import-browse-link import-browser-dir" data-browse-path="${Utils.escapeHtml(d.path)}">
            <i data-lucide="folder" style="width:16px;height:16px;color:var(--warning)"></i>
            <span>${Utils.escapeHtml(d.name)}</span>
          </a>
          <button class="btn btn--primary btn--sm import-select-btn" data-select-path="${Utils.escapeHtml(d.path)}" data-select-name="${Utils.escapeHtml(d.name)}" type="button">Selecionar</button>
        </div>
      `).join('');
    }

    Utils.refreshIcons(breadcrumbEl);
    Utils.refreshIcons(listEl);

    breadcrumbEl.querySelectorAll('.import-browse-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        ImportUI._browseTo(link.dataset.browsePath);
      });
    });

    listEl.querySelectorAll('.import-browse-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        ImportUI._browseTo(link.dataset.browsePath);
      });
    });

    listEl.querySelectorAll('.import-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedPath = btn.dataset.selectPath;
        const selectedName = btn.dataset.selectName;
        const pathInput = document.getElementById('import-path');
        const nameInput = document.getElementById('import-repo-name');
        if (pathInput) pathInput.value = selectedPath;
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = selectedName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        }
        document.getElementById('import-browser').hidden = true;
        ImportUI._selectedPath = selectedPath;
      });
    });
  },

  async _doImport() {
    if (ImportUI._importing) return;

    const pathInput = document.getElementById('import-path');
    const nameInput = document.getElementById('import-repo-name');
    const submitBtn = document.getElementById('import-submit-btn');
    const sourcePath = pathInput?.value.trim();
    const repoName = nameInput?.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    if (!sourcePath) { Toast.warning('Informe o caminho do projeto'); return; }
    if (!repoName) { Toast.warning('Informe o nome do repositório'); return; }

    ImportUI._importing = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px" class="spin"></i> Importando...';
      Utils.refreshIcons(submitBtn);
    }

    try {
      Toast.info('Importando projeto... isso pode levar alguns segundos');
      const result = await API.projects.import(sourcePath, repoName);

      Toast.success('Projeto importado com sucesso!');

      const modal = document.getElementById('execution-detail-modal-overlay');
      const title = document.getElementById('execution-detail-title');
      const content = document.getElementById('execution-detail-content');
      if (modal && title && content) {
        title.textContent = 'Projeto Importado';
        content.innerHTML = `
          <div class="publish-result">
            <div class="publish-result-item"><strong>Repositório:</strong> <a href="${Utils.escapeHtml(result.repoUrl)}" target="_blank">${Utils.escapeHtml(result.repoUrl)}</a></div>
            <div class="publish-result-item"><strong>Diretório:</strong> <code>${Utils.escapeHtml(result.projectDir)}</code></div>
            <div class="publish-result-item"><strong>Status:</strong> <span class="badge badge-active">${Utils.escapeHtml(result.status)}</span></div>
            ${result.message ? `<div class="publish-result-item"><em>${Utils.escapeHtml(result.message)}</em></div>` : ''}
            <div class="publish-result-steps">
              <strong>Passos:</strong>
              <ul>${(result.steps || []).map(s => `<li>${Utils.escapeHtml(s)}</li>`).join('')}</ul>
            </div>
          </div>`;
        Modal.open('execution-detail-modal-overlay');
      }

      if (pathInput) pathInput.value = '';
      if (nameInput) nameInput.value = '';
      App._reposCache = null;
      await ImportUI.load();
    } catch (err) {
      Toast.error(`Erro ao importar: ${err.message}`);
    } finally {
      ImportUI._importing = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="upload-cloud" style="width:16px;height:16px"></i> Importar para o Gitea';
        Utils.refreshIcons(submitBtn);
      }
    }
  },
};

window.ImportUI = ImportUI;
